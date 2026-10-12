import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import pino from "pino";

import { runAgent } from "../agent/agent.js";
import { lastScheduledRunAt } from "../db/agentDb.js";
import { connectToDb } from "../db/client.js";
import { listRunningCampaigns, reloadCampaign } from "../db/campaignsDb.js";
import type { CampaignView } from "../db/campaignsDb.js";
import { createLinkedinClient } from "../linkedin/client.js";
import { isWorkingTime } from "./config.js";
import {
  completeIfDone,
  createPipelineContext,
  evaluateStep,
  fetchProfilesStep,
  inviteStep,
  searchStep,
  simulateAcceptances,
} from "./steps.js";
import type { PipelineContext } from "./steps.js";

/**
 * One pass over every running campaign: search, fetch profiles, evaluate,
 * complete what has collected enough, and send invites.
 *
 * Campaigns run one after another, never in parallel, so one account never
 * performs two LinkedIn actions at once. LinkedIn steps only run in working
 * time (fake mode ignores it, since nothing reaches LinkedIn); evaluation
 * runs any time because it only talks to the model. When LinkedIn asks an
 * account to slow down, its other campaigns are skipped until the next pass.
 */
export async function runPass(context: PipelineContext): Promise<void> {
  const limitedAccounts = new Set<string>();
  const linkedinAllowed = context.linkedin.mode === "fake" || isWorkingTime(context.now(), context.config);

  for (const campaign of await listRunningCampaigns(context.db)) {
    try {
      const allowed = linkedinAllowed && !limitedAccounts.has(campaign.linkedinAccountId);
      if (await runCampaign(context, campaign, allowed)) limitedAccounts.add(campaign.linkedinAccountId);
    } catch (error) {
      context.logger.error({ campaign: campaign.id, error: String(error) }, "Campaign pass failed");
    }
  }
}

/**
 * Wake each account's agent whose last scheduled check-in is older than the
 * wake interval. The agent then decides what to do through its MCP tools.
 *
 * Accounts are woken one after another; a run holding the account's lock
 * (a chat in progress) is skipped and retried next pass. Outside working
 * time nothing is woken, since every LinkedIn tool would refuse anyway.
 */
export async function wakeAgents(context: PipelineContext): Promise<void> {
  if (context.linkedin.mode !== "fake" && !isWorkingTime(context.now(), context.config)) return;

  const accounts = new Map<string, string>();
  for (const campaign of await listRunningCampaigns(context.db)) {
    accounts.set(campaign.linkedinAccountId, campaign.accountLabel);
  }

  for (const [id, label] of accounts) {
    const last = await lastScheduledRunAt(context.db, id);
    if (last && context.now().getTime() - last.getTime() < context.config.agentWakeIntervalMs) continue;
    try {
      const outcome = await runAgent(context, { id, label }, { trigger: "schedule" });
      if (outcome.status === "done") context.logger.info({ account: id, reply: outcome.reply }, "Agent check-in");
    } catch (error) {
      context.logger.error({ account: id, error: String(error) }, "Agent run failed");
    }
  }
}

/** Environment variable choosing who drives the work: the agent, or the fixed sequence. */
const WORKER_MODE_KEY = "WORKER_MODE";

/**
 * Run as `npm run worker`: passes forever, resting between them, until stopped.
 *
 * By default each pass wakes the accounts' agents. `WORKER_MODE=autopilot`
 * runs the fixed search → fetch → evaluate → invite sequence instead, with
 * the same limits, as a fallback that needs no agent model.
 */
async function main(): Promise<void> {
  const logger = pino();
  const db = await connectToDb();
  const linkedin = createLinkedinClient();
  const context = createPipelineContext(db, linkedin, logger);
  const { config } = context;

  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
    logger.info("Stopping after this pass");
  });

  const autopilot = process.env[WORKER_MODE_KEY]?.trim() === "autopilot";
  logger.info({ linkedin: linkedin.mode, driver: autopilot ? "autopilot" : "agent", config }, "Worker started");
  while (!stopping) {
    await (autopilot ? runPass(context) : wakeAgents(context));
    if (!stopping) await sleep(config.passIntervalMs);
  }
  await db.destroy();
}

/**
 * One campaign's share of a pass: collection while it is active, then
 * invites whether it is active or completed.
 *
 * @returns whether LinkedIn limited the account during it
 */
async function runCampaign(
  context: PipelineContext,
  campaign: CampaignView,
  linkedinAllowed: boolean,
): Promise<boolean> {
  let limited = false;

  if (campaign.status === "active" && !(await completeIfDone(context, campaign))) {
    if (linkedinAllowed) {
      limited = (await searchStep(context, campaign)) === "account_limited";
      if (!limited) {
        const current = (await reloadCampaign(context.db, campaign.id)) ?? campaign;
        limited = (await fetchProfilesStep(context, current)) === "account_limited";
      }
    }
    const latest = (await reloadCampaign(context.db, campaign.id)) ?? campaign;
    await evaluateStep(context, latest);
    await completeIfDone(context, latest);
  }

  if (linkedinAllowed && !limited) {
    limited = (await inviteStep(context, campaign)) === "account_limited";
  }
  await simulateAcceptances(context, campaign);
  return limited;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
