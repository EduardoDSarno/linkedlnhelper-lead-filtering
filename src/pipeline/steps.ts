import { setTimeout as sleep } from "node:timers/promises";

import type { Kysely } from "kysely";

import { countActionsSince, lastActionAt, recordAction } from "../db/actionsDb.js";
import { saveSearchProgress, setCampaignStatus } from "../db/campaignsDb.js";
import type { CampaignView } from "../db/campaignsDb.js";
import {
  alreadyInvitedByAccount,
  countLeadsByStage,
  insertFoundLeads,
  leadsAtStage,
  markAccepted,
  markInvited,
  recordFetchFailure,
  setLeadStage,
} from "../db/leadsDb.js";
import { findFreshProfile, findProfiles, saveProfile } from "../db/profilesDb.js";
import type { Database, LeadStage } from "../db/schema.js";
import { createEvaluationBatchContext, evaluateProfiles } from "../evaluation/index.js";
import type {
  FullEvaluationCriteria,
  ModelEvaluationOptions,
  ModelEvaluationOutcome,
  ProfileModelEvaluation,
} from "../evaluation/index.js";
import { isLinkedinLimitError } from "../linkedin/client.js";
import type { LinkedinClient } from "../linkedin/client.js";
import { UnipileRequestError } from "../linkedin/unipile/request.js";
import { mapUnipileProfile } from "../profiles/sources/unipile/unipile_profile.js";
import { accountCap, remainingRoom } from "../scheduler/limits.js";
import type { Logger } from "../shared/logging/index.js";
import { inviteGapMs, loadPipelineConfig, randomActionDelayMs } from "./config.js";
import type { PipelineConfig } from "./config.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Everything a step needs, passed in so tests and the future agent can supply their own. */
export interface PipelineContext {
  db: Kysely<Database>;
  linkedin: LinkedinClient;
  config: PipelineConfig;
  logger: Logger;
  /** Waits before a LinkedIn action, like a person between clicks; instant in tests. */
  pause(): Promise<void>;
  now(): Date;
  /** Passed to the evaluation, e.g. a fake model client in tests. */
  evaluationOptions?: ModelEvaluationOptions;
}

/**
 * The context the worker and the web server's chat both run steps with:
 * real human-like pauses before LinkedIn actions, none in fake mode since
 * nothing reaches LinkedIn.
 */
export function createPipelineContext(
  db: Kysely<Database>,
  linkedin: LinkedinClient,
  logger: Logger,
  environment: NodeJS.ProcessEnv = process.env,
): PipelineContext {
  const config = loadPipelineConfig(environment);
  return {
    db,
    linkedin,
    config,
    logger,
    pause: () => (linkedin.mode === "fake" ? Promise.resolve() : sleep(randomActionDelayMs(config)).then(() => {})),
    now: () => new Date(),
  };
}

/** How a step ended: done, or stopped because LinkedIn asked the account to slow down. */
export type StepResult = "done" | "account_limited";

/**
 * Search the campaign's next pages until enough people are waiting for a
 * profile fetch, the search runs out, or the per-pass page limit is reached.
 *
 * Each page is one LinkedIn request, recorded as a `search` action. The
 * cursor is saved after every page, so a restart continues where it stopped.
 */
export async function searchStep(context: PipelineContext, campaign: CampaignView): Promise<StepResult> {
  const { db, linkedin, config, logger } = context;
  let cursor = campaign.searchCursor;
  if (campaign.searchExhausted) return "done";

  for (let page = 0; page < config.searchPagesPerPass; page++) {
    const counts = await countLeadsByStage(db, campaign.id);
    if (waiting(counts) >= config.evaluationBatchSize) return "done";

    await context.pause();
    let result;
    try {
      result = await linkedin.searchPeople(campaign.unipileAccountId, campaign.search, cursor ?? undefined);
    } catch (error) {
      if (isLinkedinLimitError(error)) return "account_limited";
      throw error;
    }

    const added = await insertFoundLeads(db, campaign.id, result.people);
    await recordAction(db, { linkedinAccountId: campaign.linkedinAccountId, campaignId: campaign.id, type: "search" });
    await saveSearchProgress(db, campaign.id, result.cursor);
    logger.info({ campaign: campaign.id, found: result.people.length, added }, "Search page saved");

    cursor = result.cursor;
    if (cursor === null) return "done";
  }
  return "done";
}

/**
 * Fetch full profiles for the campaign's `found` leads, within the account's
 * and the campaign's daily allowance.
 *
 * A profile fetched recently, by this or any other campaign, is reused and
 * costs nothing. A failed fetch is counted against the lead; a LinkedIn limit
 * stops the step for the whole account.
 */
export async function fetchProfilesStep(context: PipelineContext, campaign: CampaignView): Promise<StepResult> {
  const { db, linkedin, config, logger } = context;
  const freshSince = new Date(context.now().getTime() - config.profileRefreshDays * MS_PER_DAY);
  let room = await remainingRoom(db, campaign, "profile_fetch", context.now());

  for (const lead of await leadsAtStage(db, campaign.id, "found", config.evaluationBatchSize)) {
    if (await findFreshProfile(db, lead.linkedin_member_id, freshSince)) {
      await setLeadStage(db, lead.id, "profiled");
      continue;
    }
    if (room <= 0) break;

    await context.pause();
    try {
      const data = await linkedin.getProfile(campaign.unipileAccountId, lead.linkedin_member_id);
      await saveProfile(db, { linkedinMemberId: lead.linkedin_member_id, source: "unipile", data });
      await recordAction(db, {
        linkedinAccountId: campaign.linkedinAccountId,
        campaignId: campaign.id,
        leadId: lead.id,
        type: "profile_fetch",
      });
      await setLeadStage(db, lead.id, "profiled");
      room -= 1;
    } catch (error) {
      if (isLinkedinLimitError(error)) return "account_limited";
      logger.warn({ campaign: campaign.id, lead: lead.id, error: String(error) }, "Profile fetch failed");
      await recordFetchFailure(db, lead.id, config.maximumFetchAttempts);
    }
  }
  return "done";
}

/**
 * Send a batch of fetched profiles to the evaluation and move each lead to
 * approved, manual review or rejected.
 *
 * It waits for a full batch so each model run is worth its overhead, except
 * when nothing else will arrive: the search ran out and no profiles are left
 * to fetch. A profile the model could not judge goes to manual review rather
 * than being retried at a cost on every pass.
 */
export async function evaluateStep(context: PipelineContext, campaign: CampaignView): Promise<void> {
  const { db, config, logger } = context;
  const counts = await countLeadsByStage(db, campaign.id);
  const profiled = counts.profiled ?? 0;
  const nothingMoreComing = campaign.searchExhausted && (counts.found ?? 0) === 0;
  if (profiled === 0 || (profiled < config.evaluationBatchSize && !nothingMoreComing)) return;

  const leads = await leadsAtStage(db, campaign.id, "profiled", config.evaluationBatchSize);
  logger.info({ campaign: campaign.id, profiles: leads.length }, "Evaluating batch");
  const scored = await scoreMembers(context, campaign.criteria, leads.map((lead) => lead.linkedin_member_id));

  for (const lead of leads) {
    const evaluation = scored.evaluations.get(lead.linkedin_member_id);
    if (evaluation) {
      await setLeadStage(db, lead.id, DECISION_STAGES[evaluation.decision], evaluation);
    } else if (scored.withProfile.has(lead.linkedin_member_id)) {
      await setLeadStage(db, lead.id, "manual_review");
    } else {
      // The profile row is gone (deleted by hand); fetch it again.
      await setLeadStage(db, lead.id, "found");
    }
  }
  logger.info({ campaign: campaign.id, evaluated: scored.evaluations.size, tokens: scored.tokens }, "Batch evaluated");
}

/**
 * Score stored profiles against criteria, without changing any lead.
 *
 * The evaluate step uses it to decide leads; the learning tools use it to
 * re-score already-reviewed leads under a proposed prompt and compare.
 */
export async function scoreMembers(
  context: PipelineContext,
  criteria: FullEvaluationCriteria,
  memberIds: readonly string[],
): Promise<{
  evaluations: Map<string, ProfileModelEvaluation>;
  /** Members whose profile was found and sent; the rest had none stored. */
  withProfile: Set<string>;
  tokens: ModelEvaluationOutcome["tokenUsage"];
}> {
  const stored = await findProfiles(context.db, memberIds);
  const profiles = memberIds.flatMap((id) => {
    const profile = stored.get(id);
    return profile ? [mapUnipileProfile(id, profile.data)] : [];
  });
  const result = await evaluateProfiles(createEvaluationBatchContext(profiles, criteria), {
    ...context.evaluationOptions,
    logger: context.logger,
  });
  return {
    evaluations: new Map(result.modelEvaluation.evaluations.map((evaluation) => [evaluation.profileId, evaluation])),
    withProfile: new Set(stored.keys()),
    tokens: result.modelEvaluation.tokenUsage,
  };
}

/**
 * Mark the campaign completed once it has enough approved leads, or once its
 * search ran out and every lead it found has been decided.
 *
 * @returns whether the campaign is now completed
 */
export async function completeIfDone(context: PipelineContext, campaign: CampaignView): Promise<boolean> {
  const counts = await countLeadsByStage(context.db, campaign.id);
  const reachedTarget = campaign.approvedTarget !== null && (counts.approved ?? 0) >= campaign.approvedTarget;
  const ranOut = campaign.searchExhausted && waiting(counts) === 0;
  if (!reachedTarget && !ranOut) return false;

  await setCampaignStatus(context.db, campaign.id, "completed");
  context.logger.info({ campaign: campaign.id, reachedTarget, ranOut }, "Campaign completed");
  return true;
}

/** The lead stage for each of the evaluation's decisions. */
const DECISION_STAGES = {
  approved: "approved",
  manual_review: "manual_review",
  rejected: "rejected",
} as const satisfies Record<string, LeadStage>;

/** Leads found or profiled but not yet decided. */
function waiting(counts: Partial<Record<LeadStage, number>>): number {
  return (counts.found ?? 0) + (counts.profiled ?? 0);
}

/** Unipile error types meaning the person is already connected or already has our invite. */
const ALREADY_CONNECTED = "errors/already_connected";
const ALREADY_INVITED = "errors/already_invited_recently";

/** HTTP status Unipile uses for a recipient LinkedIn will not accept an invite for. */
const HTTP_UNPROCESSABLE = 422;

/**
 * Send at most one invite for the campaign, if the account may send one now.
 *
 * Leads are taken from `queued` (cleared by a person) and, when the campaign
 * does not require approval, also from `approved`. Three checks pace it like
 * a person: the account's and campaign's weekly allowance, the day's even
 * share of the weekly cap, and a randomized gap since the account's last
 * invite. Fake mode skips the gap, since nothing reaches LinkedIn.
 */
export async function inviteStep(context: PipelineContext, campaign: CampaignView): Promise<StepResult> {
  const { db, linkedin, config, logger } = context;
  const now = context.now();

  if ((await remainingRoom(db, campaign, "invite", now)) <= 0) return "done";

  const dailyShare = Math.ceil(accountCap("invite") / config.workDays.length);
  const sentToday = await countActionsSince(
    db,
    { linkedinAccountId: campaign.linkedinAccountId },
    "invite",
    new Date(now.getTime() - MS_PER_DAY),
  );
  if (sentToday >= dailyShare) return "done";

  const last = await lastActionAt(db, campaign.linkedinAccountId, "invite");
  if (linkedin.mode !== "fake" && last && now.getTime() - last.getTime() < inviteGapMs(config, dailyShare)) {
    return "done";
  }

  const [lead] = [
    ...(await leadsAtStage(db, campaign.id, "queued", 1)),
    ...(campaign.requireInviteApproval ? [] : await leadsAtStage(db, campaign.id, "approved", 1)),
  ];
  if (!lead) return "done";

  // Another campaign of this account already invited the person: don't ask twice.
  if (await alreadyInvitedByAccount(db, campaign.linkedinAccountId, lead.linkedin_member_id)) {
    await markInvited(db, lead.id);
    return "done";
  }

  await context.pause();
  try {
    await linkedin.sendInvite(campaign.unipileAccountId, lead.linkedin_member_id);
  } catch (error) {
    if (isLinkedinLimitError(error)) return "account_limited";
    if (!(error instanceof UnipileRequestError) || error.status !== HTTP_UNPROCESSABLE) throw error;

    if (error.type === ALREADY_CONNECTED) await markInvited(db, lead.id, true);
    else if (error.type === ALREADY_INVITED) await markInvited(db, lead.id);
    else await setLeadStage(db, lead.id, "failed");
    logger.warn({ campaign: campaign.id, lead: lead.id, type: error.type }, "Invite refused for this person");
    return "done";
  }

  await recordAction(db, {
    linkedinAccountId: campaign.linkedinAccountId,
    campaignId: campaign.id,
    leadId: lead.id,
    type: "invite",
  });
  await markInvited(db, lead.id);
  logger.info({ campaign: campaign.id, lead: lead.id }, "Invite sent");
  return "done";
}

/** Share of invited fake people who accept, in tenths, chosen by lead id so runs repeat. */
const FAKE_ACCEPTING_TENTHS = 3;
const TENTHS = 10;

/** How long a fake invite waits before it may be accepted. */
const FAKE_ACCEPT_AFTER_MS = 2 * 60 * 1000;

/**
 * Fake mode only: accept some invites after a short wait, standing in for
 * Unipile's `new_relation` webhook so the funnel can be seen end to end.
 */
export async function simulateAcceptances(context: PipelineContext, campaign: CampaignView): Promise<void> {
  if (context.linkedin.mode !== "fake") return;
  const cutoff = context.now().getTime() - FAKE_ACCEPT_AFTER_MS;

  for (const lead of await leadsAtStage(context.db, campaign.id, "invited", context.config.evaluationBatchSize)) {
    const waitedEnough = lead.invited_at !== null && lead.invited_at.getTime() <= cutoff;
    if (waitedEnough && Number(lead.id) % TENTHS < FAKE_ACCEPTING_TENTHS) {
      await markAccepted(context.db, campaign.unipileAccountId, lead.linkedin_member_id);
    }
  }
}
