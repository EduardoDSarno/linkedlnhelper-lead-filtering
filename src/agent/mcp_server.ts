import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { countActionsSince } from "../db/actionsDb.js";
import { listAgentNotes, saveAgentNote } from "../db/agentDb.js";
import { reloadCampaign, setCampaignStatus, setInviteApproval, updateCampaign } from "../db/campaignsDb.js";
import type { CampaignChanges, CampaignView } from "../db/campaignsDb.js";
import { countLeadsByStage, leadsAtStage } from "../db/leadsDb.js";
import { recentAccountReviews } from "../db/reviewsDb.js";
import type { LeadStage } from "../db/schema.js";
import { DECISION_POLICY_MODE, parseFullEvaluationCriteria } from "../evaluation/criterias/index.js";
import { campaignInsights, PROMPT_TEST_SAMPLE, testCriteria } from "../learning/insights.js";
import { isWorkingTime } from "../pipeline/config.js";
import { completeIfDone, evaluateStep, fetchProfilesStep, inviteStep, searchStep } from "../pipeline/steps.js";
import type { PipelineContext, StepResult } from "../pipeline/steps.js";
import { ACCOUNT_CAPS, accountCap, remainingRoom } from "../scheduler/limits.js";
import type { LimitedAction } from "../scheduler/limits.js";

/** Most leads or reviews one tool call returns, to keep the model's context small. */
const MAX_LIST_ITEMS = 20;
/** Notes read back per call; older ones stay stored. */
const NOTES_READ_LIMIT = 30;
/** Longest note the agent may save, so memory stays a list of lessons, not transcripts. */
const MAX_NOTE_LENGTH = 1_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const LEAD_STAGES = [
  "found",
  "profiled",
  "approved",
  "manual_review",
  "rejected",
  "queued",
  "invited",
  "accepted",
  "failed",
] as const satisfies readonly LeadStage[];

/** The account an MCP server instance is bound to; every tool acts on it alone. */
export interface AgentAccount {
  id: string;
  label: string;
}

/**
 * Build the MCP server through which one account's agent does everything.
 *
 * The tools call the same pipeline steps as the fixed worker, so every safety
 * rule (weekly caps, daily share, invite gaps, working time, human approval)
 * is enforced in code inside the tool: the agent decides what to try, never
 * whether a limit applies. Each server is bound to one account, so a tool can
 * only ever see or touch that account's campaigns.
 */
export function createAccountMcpServer(context: PipelineContext, account: AgentAccount): McpServer {
  const { db } = context;
  const server = new McpServer({ name: `linkedin-account-${account.id}`, version: "1.0.0" });
  // Models send ids and numbers as text or as numbers interchangeably, so
  // both are accepted rather than refusing a call over its JSON type.
  const campaignId = z.coerce.string().describe("Id of one of this account's campaigns.");
  const wholeNumber = (minimum: number) => z.coerce.number().int().min(minimum);
  const clearableNumber = (minimum: number) => z.union([z.null(), wholeNumber(minimum)]).optional();

  /** The campaign if it belongs to this account, else nothing. */
  const ownCampaign = async (id: string): Promise<CampaignView | undefined> => {
    const campaign = await reloadCampaign(db, id);
    return campaign?.linkedinAccountId === account.id ? campaign : undefined;
  };

  /**
   * Run a LinkedIn step on an active campaign, refusing outside working time.
   * Returns the step's outcome together with the campaign's funnel after it.
   */
  const linkedinStep = async (id: string, step: (campaign: CampaignView) => Promise<StepResult | void>) => {
    const campaign = await ownCampaign(id);
    if (!campaign) return refuse("No such campaign on this account.");
    if (campaign.status !== "active") return refuse(`Campaign is ${campaign.status}; only active campaigns collect.`);
    if (context.linkedin.mode !== "fake" && !isWorkingTime(context.now(), context.config)) {
      return refuse(outsideWorkingTime(context));
    }
    const outcome = await step(campaign);
    return reply({
      outcome: outcome === "account_limited" ? "LinkedIn asked this account to slow down; stop LinkedIn actions until a later run." : "done",
      funnel: await countLeadsByStage(db, campaign.id),
    });
  };

  server.registerTool(
    "get_account_status",
    {
      description:
        "Start here. The account's limits and how much room is left, whether it is working time, and every campaign with its funnel counts.",
    },
    async () => reply(await accountStatus(context, account)),
  );

  server.registerTool(
    "get_campaign",
    { description: "One campaign's settings: who it looks for (prompt), search, decision thresholds, target, budgets, funnel.", inputSchema: { campaign_id: campaignId } },
    async ({ campaign_id }) => {
      const campaign = await ownCampaign(campaign_id);
      if (!campaign) return refuse("No such campaign on this account.");
      return reply({ ...campaignSummary(campaign), funnel: await countLeadsByStage(db, campaign.id) });
    },
  );

  server.registerTool(
    "search_more_leads",
    {
      description:
        "Search the campaign's next LinkedIn result pages and save new people as `found` leads. Stops by itself when enough leads are waiting or the search ran out. Counts as LinkedIn activity.",
      inputSchema: { campaign_id: campaignId },
    },
    async ({ campaign_id }) => linkedinStep(campaign_id, (campaign) => searchStep(context, campaign)),
  );

  server.registerTool(
    "fetch_profiles",
    {
      description:
        "Fetch full LinkedIn profiles for the campaign's `found` leads, within the daily profile allowance. Recently fetched profiles are reused for free.",
      inputSchema: { campaign_id: campaignId },
    },
    async ({ campaign_id }) => linkedinStep(campaign_id, (campaign) => fetchProfilesStep(context, campaign)),
  );

  server.registerTool(
    "evaluate_profiles",
    {
      description:
        "Send a batch of `profiled` leads to the AI evaluation, which marks each approved, manual_review or rejected. Waits for a full batch unless the search has run out. Does not touch LinkedIn.",
      inputSchema: { campaign_id: campaignId },
    },
    async ({ campaign_id }) => {
      const campaign = await ownCampaign(campaign_id);
      if (!campaign) return refuse("No such campaign on this account.");
      if (campaign.status !== "active") return refuse(`Campaign is ${campaign.status}.`);
      await evaluateStep(context, campaign);
      const completed = await completeIfDone(context, (await ownCampaign(campaign_id)) ?? campaign);
      return reply({ funnel: await countLeadsByStage(db, campaign.id), campaignCompleted: completed });
    },
  );

  server.registerTool(
    "send_invite",
    {
      description:
        "Send at most one connection request for the campaign: a lead the user queued, or an approved lead when the campaign does not require approval. Refuses when the weekly cap, daily share or the gap since the last invite says to wait.",
      inputSchema: { campaign_id: campaignId },
    },
    async ({ campaign_id }) => {
      const campaign = await ownCampaign(campaign_id);
      if (!campaign) return refuse("No such campaign on this account.");
      if (campaign.status === "paused") return refuse("Campaign is paused.");
      if (context.linkedin.mode !== "fake" && !isWorkingTime(context.now(), context.config)) {
        return refuse(outsideWorkingTime(context));
      }
      const before = (await countLeadsByStage(db, campaign.id)).invited ?? 0;
      const outcome = await inviteStep(context, campaign);
      const after = await countLeadsByStage(db, campaign.id);
      const sent = (after.invited ?? 0) > before;
      return reply({
        sent,
        ...(outcome === "account_limited" ? { note: "LinkedIn asked this account to slow down." } : {}),
        ...(!sent && outcome !== "account_limited"
          ? { note: "Nothing sent: no lead is ready, or a limit or the gap since the last invite says to wait." }
          : {}),
        funnel: after,
      });
    },
  );

  server.registerTool(
    "list_leads",
    {
      description: "The campaign's leads at one stage (oldest first), with the AI's score and summary.",
      inputSchema: { campaign_id: campaignId, stage: z.enum(LEAD_STAGES) },
    },
    async ({ campaign_id, stage }) => {
      const campaign = await ownCampaign(campaign_id);
      if (!campaign) return refuse("No such campaign on this account.");
      const leads = await leadsAtStage(db, campaign.id, stage, MAX_LIST_ITEMS);
      return reply(
        leads.map((lead) => ({
          name: lead.name,
          headline: lead.headline,
          location: lead.location,
          score: lead.evaluation?.matchPercent ?? null,
          summary: lead.evaluation?.summary ?? null,
        })),
      );
    },
  );

  server.registerTool(
    "get_review_feedback",
    {
      description:
        "Recent decisions the user made on leads, next to what the AI had said. Disagreements show where the campaign prompt or thresholds should change.",
      inputSchema: { campaign_id: campaignId.optional() },
    },
    async ({ campaign_id }) => reply(await recentAccountReviews(db, account.id, MAX_LIST_ITEMS, campaign_id)),
  );

  server.registerTool(
    "set_campaign_status",
    {
      description: "Pause or resume a campaign. Paused campaigns neither collect nor invite.",
      inputSchema: { campaign_id: campaignId, status: z.enum(["active", "paused"]) },
    },
    async ({ campaign_id, status }) => {
      const campaign = await ownCampaign(campaign_id);
      if (!campaign) return refuse("No such campaign on this account.");
      if (campaign.status === "completed") return refuse("A completed campaign cannot be restarted.");
      await setCampaignStatus(db, campaign.id, status);
      return reply({ status });
    },
  );

  server.registerTool(
    "update_campaign",
    {
      description:
        "Change a campaign's settings when the user asks: name, who it looks for (prompt), approval/review score thresholds, approved-leads target, weekly invite or daily profile budget, or whether invites need the user's approval. Only pass what changes. The prompt is the ONLY thing the AI evaluation reads, so any preference about who qualifies (include, exclude, prefer) must be written into it: pass the full new prompt. Budgets can only stay within the account's caps, which are enforced regardless.",
      inputSchema: {
        campaign_id: campaignId,
        name: z.string().min(1).optional(),
        prompt: z.string().min(1).optional(),
        approval_threshold: wholeNumber(0).max(100).optional(),
        review_threshold: wholeNumber(0).max(100).optional(),
        approved_target: clearableNumber(1).describe("null removes the target."),
        weekly_invite_budget: clearableNumber(0).describe("null removes the campaign budget; the account cap still applies."),
        daily_profile_budget: clearableNumber(0).describe("null removes the campaign budget; the account cap still applies."),
        require_invite_approval: z.boolean().optional(),
      },
    },
    async (input) => {
      const campaign = await ownCampaign(input.campaign_id);
      if (!campaign) return refuse("No such campaign on this account.");

      const changes: CampaignChanges = {};
      if (input.name) changes.name = input.name;
      if (input.approved_target !== undefined) changes.approvedTarget = input.approved_target;
      if (input.weekly_invite_budget !== undefined) changes.weeklyInviteLimit = input.weekly_invite_budget;
      if (input.daily_profile_budget !== undefined) changes.dailyProfileLimit = input.daily_profile_budget;
      if (input.prompt || input.approval_threshold !== undefined || input.review_threshold !== undefined) {
        try {
          changes.criteria = withCriteriaChanges(campaign, input);
        } catch (error) {
          return refuse((error as Error).message);
        }
      }

      await updateCampaign(db, campaign.id, changes);
      if (input.require_invite_approval !== undefined) {
        await setInviteApproval(db, campaign.id, input.require_invite_approval);
      }
      const updated = await ownCampaign(campaign.id);
      return reply(updated ? campaignSummary(updated) : { updated: true });
    },
  );

  server.registerTool(
    "get_campaign_insights",
    {
      description:
        "What the campaign has taught so far, free: how often the user agrees with the AI, whether the AI is too loose (approves people the user rejects) or too strict, approval rate, and invite acceptance rate.",
      inputSchema: { campaign_id: campaignId },
    },
    async ({ campaign_id }) => {
      const campaign = await ownCampaign(campaign_id);
      if (!campaign) return refuse("No such campaign on this account.");
      return reply(await campaignInsights(db, campaign.id));
    },
  );

  server.registerTool(
    "test_prompt_change",
    {
      description:
        "Measure a proposed prompt or threshold change before suggesting it: re-scores up to " +
        `${PROMPT_TEST_SAMPLE} leads the user already decided, with the current and the proposed criteria, and reports how well each agrees with the user. Costs a little model usage; changes nothing.`,
      inputSchema: {
        campaign_id: campaignId,
        prompt: z.string().min(1).optional(),
        approval_threshold: z.coerce.number().int().min(0).max(100).optional(),
        review_threshold: z.coerce.number().int().min(0).max(100).optional(),
      },
    },
    async (input) => {
      const campaign = await ownCampaign(input.campaign_id);
      if (!campaign) return refuse("No such campaign on this account.");
      let proposed;
      try {
        proposed = withCriteriaChanges(campaign, input);
      } catch (error) {
        return refuse((error as Error).message);
      }
      return reply(await testCriteria(context, campaign, proposed));
    },
  );

  server.registerTool(
    "read_notes",
    { description: "What you saved about this account in earlier runs: lessons, the user's instructions, plans." },
    async () => reply(await listAgentNotes(db, account.id, NOTES_READ_LIMIT)),
  );

  server.registerTool(
    "save_note",
    {
      description:
        "Remember something for future runs: a lesson from review feedback or acceptance, or an instruction from the user. One short fact per note.",
      inputSchema: { content: z.string().min(1).max(MAX_NOTE_LENGTH) },
    },
    async ({ content }) => {
      await saveAgentNote(db, account.id, content);
      return reply({ saved: true });
    },
  );

  return server;
}

/**
 * The campaign's criteria with a new prompt and/or thresholds, validated by
 * the evaluation's own parser so only criteria it accepts are saved or tested.
 *
 * @throws With the parser's message when the result is invalid.
 */
function withCriteriaChanges(
  campaign: CampaignView,
  input: { prompt?: string | undefined; approval_threshold?: number | undefined; review_threshold?: number | undefined },
) {
  const policy = campaign.criteria.decisionPolicy;
  const current = policy?.mode === DECISION_POLICY_MODE.automatic ? policy : undefined;
  return parseFullEvaluationCriteria({
    ...campaign.criteria,
    systemPrompt: input.prompt ?? campaign.criteria.systemPrompt,
    decisionPolicy: {
      mode: DECISION_POLICY_MODE.automatic,
      minimumApprovalPercent: input.approval_threshold ?? current?.minimumApprovalPercent,
      minimumManualReviewPercent: input.review_threshold ?? current?.minimumManualReviewPercent,
    },
  });
}

/** Limits, working time and every campaign of the account, for `get_account_status`. */
async function accountStatus(context: PipelineContext, account: AgentAccount) {
  const { db } = context;
  const now = context.now();
  const campaigns = await db
    .selectFrom("campaigns")
    .select("id")
    .where("linkedin_account_id", "=", account.id)
    .orderBy("id")
    .execute();
  const views = (await Promise.all(campaigns.map((row) => reloadCampaign(db, row.id)))).filter(
    (view): view is CampaignView => view !== undefined,
  );

  /** Used and remaining allowance of one limited action for the whole account. */
  const usage = async (type: LimitedAction) => {
    const used = await countActionsSince(
      db,
      { linkedinAccountId: account.id },
      type,
      new Date(now.getTime() - ACCOUNT_CAPS[type].windowMs),
    );
    return { cap: accountCap(type), used, window: type === "invite" ? "rolling 7 days" : "rolling 24 hours" };
  };

  return {
    account: account.label,
    linkedinMode: context.linkedin.mode,
    now: now.toISOString(),
    workingTimeNow: context.linkedin.mode === "fake" || isWorkingTime(now, context.config),
    workingTime: workingTimeText(context),
    limits: {
      invites: await usage("invite"),
      invitesLast24h: await countActionsSince(db, { linkedinAccountId: account.id }, "invite", new Date(now.getTime() - MS_PER_DAY)),
      dailyInviteShare: Math.ceil(accountCap("invite") / context.config.workDays.length),
      profileFetches: await usage("profile_fetch"),
    },
    campaigns: await Promise.all(
      views.map(async (campaign) => ({
        ...campaignSummary(campaign),
        profileRoomNow: campaign.status === "active" ? await remainingRoom(db, campaign, "profile_fetch", now) : 0,
        funnel: await countLeadsByStage(db, campaign.id),
      })),
    ),
  };
}

/** The settings of a campaign the agent needs, in plain names. */
function campaignSummary(campaign: CampaignView) {
  const policy = campaign.criteria.decisionPolicy;
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    prompt: campaign.criteria.systemPrompt,
    approvalThreshold: policy?.mode === DECISION_POLICY_MODE.automatic ? policy.minimumApprovalPercent : null,
    reviewThreshold: policy?.mode === DECISION_POLICY_MODE.automatic ? policy.minimumManualReviewPercent : null,
    approvedTarget: campaign.approvedTarget,
    requireInviteApproval: campaign.requireInviteApproval,
    weeklyInviteBudget: campaign.weeklyInviteLimit,
    dailyProfileBudget: campaign.dailyProfileLimit,
    searchExhausted: campaign.searchExhausted,
    search: campaign.search,
  };
}

/** "Mon–Fri 9–18 America/Sao_Paulo"-style description of working time. */
function workingTimeText(context: PipelineContext): string {
  const { workDays, workStartHour, workEndHour, workTimezone } = context.config;
  return `ISO weekdays ${workDays.join(",")}, ${workStartHour}:00–${workEndHour}:00 ${workTimezone}`;
}

/** The refusal for a LinkedIn action attempted outside working time. */
function outsideWorkingTime(context: PipelineContext): string {
  return `Outside working time (${workingTimeText(context)}). LinkedIn actions wait until then.`;
}

/** A successful tool answer, as JSON text the model can read. */
function reply(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

/** A refused tool call, marked as an error so the model knows nothing happened. */
function refuse(reason: string): CallToolResult {
  return { content: [{ type: "text", text: reason }], isError: true };
}
