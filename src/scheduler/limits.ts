import type { Kysely } from "kysely";

import { countActionsSince } from "../db/actionsDb.js";
import type { CampaignView } from "../db/campaignsDb.js";
import { CONFIG_NUMBER_MINIMUMS, resolveConfigNumber } from "../shared/helpers/index.js";
import type { ActionType, Database } from "../db/schema.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_WEEK = 7;

/** Actions that spend a limited allowance; searches are logged but not capped yet. */
export type LimitedAction = Exclude<ActionType, "search">;

/**
 * Each limited action's safety cap per LinkedIn account, the window it is
 * counted over, which campaign column holds the campaign's own budget, and
 * the environment variable that may override the cap.
 *
 * The caps are the same for every Premium account and the defaults are
 * conservative starting values, meant to be raised in `.env` as accounts
 * prove they can take more. `hardLimit` is Unipile's published maximum for a
 * paid account: a value in `.env` above it is lowered to it, so a typo there
 * can never push an account past what Unipile considers safe. Windows roll back
 * from now rather than resetting
 * at midnight or on Mondays, so a burst just before a reset cannot double an
 * account's real activity.
 */
export const ACCOUNT_CAPS = {
  invite: {
    defaultLimit: 100,
    hardLimit: 200,
    environmentKey: "ACCOUNT_WEEKLY_INVITE_CAP",
    windowMs: DAYS_PER_WEEK * MS_PER_DAY,
    campaignBudget: "weeklyInviteLimit",
  },
  profile_fetch: {
    defaultLimit: 100,
    hardLimit: 100,
    environmentKey: "ACCOUNT_DAILY_PROFILE_CAP",
    windowMs: MS_PER_DAY,
    campaignBudget: "dailyProfileLimit",
  },
} as const;

/**
 * The account cap for one action: from `.env` when set there, else its
 * default, and never above its hard limit whatever `.env` says.
 */
export function accountCap(
  type: LimitedAction,
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const cap = ACCOUNT_CAPS[type];
  return resolveConfigNumber(environment[cap.environmentKey], {
    fallback: cap.defaultLimit,
    minimum: CONFIG_NUMBER_MINIMUMS.nonNegative,
    maximum: cap.hardLimit,
    clampMaximum: true,
    integer: true,
  });
}

/**
 * How many more actions of this type the campaign may perform right now:
 * the smaller of what its account and its own budget have left.
 *
 * The account cap is counted first because it protects the LinkedIn account
 * itself; the campaign's budget only shares out what the account allows.
 */
export async function remainingRoom(
  db: Kysely<Database>,
  campaign: CampaignLimits,
  type: LimitedAction,
  now: Date = new Date(),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const cap = ACCOUNT_CAPS[type];
  const since = new Date(now.getTime() - cap.windowMs);

  const accountUsed = await countActionsSince(
    db,
    { linkedinAccountId: campaign.linkedinAccountId },
    type,
    since,
  );
  const accountLeft = Math.max(0, accountCap(type, environment) - accountUsed);

  const budget = campaign[cap.campaignBudget];
  if (budget === null || accountLeft === 0) return accountLeft;

  const campaignUsed = await countActionsSince(db, { campaignId: campaign.id }, type, since);
  return Math.min(accountLeft, Math.max(0, budget - campaignUsed));
}

/** The campaign fields the limit check needs. */
export type CampaignLimits = Pick<
  CampaignView,
  "id" | "linkedinAccountId" | "weeklyInviteLimit" | "dailyProfileLimit"
>;
