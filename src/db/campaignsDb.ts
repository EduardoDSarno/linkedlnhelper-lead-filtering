import { sql } from "kysely";
import type { Kysely } from "kysely";

import type { FullEvaluationCriteria } from "../evaluation/criterias/user_criteria.js";
import type { PeopleSearch } from "../linkedin/client.js";
import type { CampaignStatus, Database } from "./schema.js";

/** What a caller provides to start a campaign; the database fills the rest. */
export interface NewCampaign {
  linkedinAccountId: string;
  name: string;
  search: PeopleSearch;
  criteria: FullEvaluationCriteria;
  /** Left out to run until the search has no more results. */
  approvedTarget?: number;
  /** Left out when the campaign should only be held to the account caps. */
  weeklyInviteLimit?: number;
  dailyProfileLimit?: number;
}

/** A campaign as the app shows it, with the account that runs it. */
export interface CampaignView {
  id: string;
  name: string;
  status: CampaignStatus;
  linkedinAccountId: string;
  accountLabel: string;
  /** Unipile's id for the account, which every LinkedIn call needs. */
  unipileAccountId: string;
  search: PeopleSearch;
  criteria: FullEvaluationCriteria;
  approvedTarget: number | null;
  searchCursor: string | null;
  searchExhausted: boolean;
  requireInviteApproval: boolean;
  weeklyInviteLimit: number | null;
  dailyProfileLimit: number | null;
  createdAt: Date;
}

/**
 * Save a new campaign for an account.
 *
 * The criteria arrive already validated and are saved as JSON text; the
 * account must already be checked to belong to the caller's organization.
 *
 * @returns the new campaign's id
 */
export async function insertCampaign(
  db: Kysely<Database>,
  campaign: NewCampaign,
): Promise<string> {
  const result = await db
    .insertInto("campaigns")
    .values({
      linkedin_account_id: campaign.linkedinAccountId,
      name: campaign.name,
      search: JSON.stringify(campaign.search),
      criteria: JSON.stringify(campaign.criteria),
      approved_target: campaign.approvedTarget ?? null,
      weekly_invite_limit: campaign.weeklyInviteLimit ?? null,
      daily_profile_limit: campaign.dailyProfileLimit ?? null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return result.id;
}

/** Every campaign of an organization, newest first. */
export async function listCampaigns(
  db: Kysely<Database>,
  organizationId: string,
): Promise<CampaignView[]> {
  return campaignViews(db).where("linkedin_accounts.organization_id", "=", organizationId)
    .orderBy("campaigns.created_at", "desc")
    .execute();
}

/** One campaign, only if it belongs to the organization asking for it. */
export async function findCampaign(
  db: Kysely<Database>,
  organizationId: string,
  campaignId: string,
): Promise<CampaignView | undefined> {
  return campaignViews(db)
    .where("linkedin_accounts.organization_id", "=", organizationId)
    .where("campaigns.id", "=", campaignId)
    .executeTakeFirst();
}

/**
 * Every campaign the worker has something to do for, across organizations:
 * active ones collect and invite; completed ones finished collecting but
 * still invite their approved leads. Paused ones do nothing.
 */
export async function listRunningCampaigns(db: Kysely<Database>): Promise<CampaignView[]> {
  return campaignViews(db).where("campaigns.status", "in", ["active", "completed"]).execute();
}

/** Pause, resume or complete a campaign. */
export async function setCampaignStatus(
  db: Kysely<Database>,
  campaignId: string,
  status: CampaignStatus,
): Promise<void> {
  await db
    .updateTable("campaigns")
    .set({ status, updated_at: sql<Date>`now()` })
    .where("id", "=", campaignId)
    .execute();
}

/** The shared select behind every campaign read: campaign fields plus its account's label. */
function campaignViews(db: Kysely<Database>) {
  return db
    .selectFrom("campaigns")
    .innerJoin("linkedin_accounts", "linkedin_accounts.id", "campaigns.linkedin_account_id")
    .select([
      "campaigns.id as id",
      "campaigns.name as name",
      "campaigns.status as status",
      "campaigns.linkedin_account_id as linkedinAccountId",
      "linkedin_accounts.label as accountLabel",
      "linkedin_accounts.unipile_account_id as unipileAccountId",
      "campaigns.search as search",
      "campaigns.criteria as criteria",
      "campaigns.approved_target as approvedTarget",
      "campaigns.search_cursor as searchCursor",
      "campaigns.search_exhausted as searchExhausted",
      "campaigns.require_invite_approval as requireInviteApproval",
      "campaigns.weekly_invite_limit as weeklyInviteLimit",
      "campaigns.daily_profile_limit as dailyProfileLimit",
      "campaigns.created_at as createdAt",
    ]);
}

/** Remember where the campaign's search continues, or that it has no more results. */
export async function saveSearchProgress(
  db: Kysely<Database>,
  campaignId: string,
  cursor: string | null,
): Promise<void> {
  await db
    .updateTable("campaigns")
    .set({ search_cursor: cursor, search_exhausted: cursor === null, updated_at: sql<Date>`now()` })
    .where("id", "=", campaignId)
    .execute();
}

/**
 * A campaign by id regardless of organization, for background work only:
 * routes must use `findCampaign` so users only see their own.
 */
export async function reloadCampaign(
  db: Kysely<Database>,
  campaignId: string,
): Promise<CampaignView | undefined> {
  return campaignViews(db).where("campaigns.id", "=", campaignId).executeTakeFirst();
}

/** Turn the "a person approves invites first" switch on or off. */
export async function setInviteApproval(
  db: Kysely<Database>,
  campaignId: string,
  required: boolean,
): Promise<void> {
  await db
    .updateTable("campaigns")
    .set({ require_invite_approval: required, updated_at: sql<Date>`now()` })
    .where("id", "=", campaignId)
    .execute();
}

/** Campaign settings that can be changed after it started; absent fields stay as they are. */
export interface CampaignChanges {
  name?: string;
  criteria?: FullEvaluationCriteria;
  approvedTarget?: number | null;
  weeklyInviteLimit?: number | null;
  dailyProfileLimit?: number | null;
}

/** Apply changes to a campaign's settings. */
export async function updateCampaign(
  db: Kysely<Database>,
  campaignId: string,
  changes: CampaignChanges,
): Promise<void> {
  await db
    .updateTable("campaigns")
    .set({
      ...(changes.name !== undefined ? { name: changes.name } : {}),
      ...(changes.criteria !== undefined ? { criteria: JSON.stringify(changes.criteria) } : {}),
      ...(changes.approvedTarget !== undefined ? { approved_target: changes.approvedTarget } : {}),
      ...(changes.weeklyInviteLimit !== undefined ? { weekly_invite_limit: changes.weeklyInviteLimit } : {}),
      ...(changes.dailyProfileLimit !== undefined ? { daily_profile_limit: changes.dailyProfileLimit } : {}),
      updated_at: sql<Date>`now()`,
    })
    .where("id", "=", campaignId)
    .execute();
}
