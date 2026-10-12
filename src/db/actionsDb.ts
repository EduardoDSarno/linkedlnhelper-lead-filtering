import type { Kysely } from "kysely";

import type { ActionType, Database } from "./schema.js";

/** One thing an account did on LinkedIn, on behalf of a campaign. */
export interface NewAction {
  linkedinAccountId: string;
  campaignId: string;
  leadId?: string;
  type: ActionType;
}

/**
 * Record an action an account just performed on LinkedIn.
 *
 * Every limit is a count over these rows, so an action that is not recorded
 * is invisible to the caps and could push an account over them.
 */
export async function recordAction(
  db: Kysely<Database>,
  action: NewAction,
): Promise<void> {
  await db
    .insertInto("actions")
    .values({
      linkedin_account_id: action.linkedinAccountId,
      campaign_id: action.campaignId,
      lead_id: action.leadId ?? null,
      type: action.type,
    })
    .execute();
}

/** Whose actions to count: one account (for its cap) or one campaign (for its budget). */
export type ActionOwner = { linkedinAccountId: string } | { campaignId: string };

/** Count how many actions of one type an account or campaign performed since a moment. */
export async function countActionsSince(
  db: Kysely<Database>,
  owner: ActionOwner,
  type: ActionType,
  since: Date,
): Promise<number> {
  const [column, id] =
    "linkedinAccountId" in owner
      ? (["linkedin_account_id", owner.linkedinAccountId] as const)
      : (["campaign_id", owner.campaignId] as const);

  const result = await db
    .selectFrom("actions")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where(column, "=", id)
    .where("type", "=", type)
    .where("created_at", ">=", since)
    .executeTakeFirstOrThrow();

  // Postgres counts are bigints, which pg returns as strings.
  return Number(result.count);
}

/** When the account last performed an action of this type, or nothing if never. */
export async function lastActionAt(
  db: Kysely<Database>,
  linkedinAccountId: string,
  type: ActionType,
): Promise<Date | undefined> {
  const row = await db
    .selectFrom("actions")
    .select((eb) => eb.fn.max("created_at").as("last"))
    .where("linkedin_account_id", "=", linkedinAccountId)
    .where("type", "=", type)
    .executeTakeFirst();
  return row?.last ?? undefined;
}
