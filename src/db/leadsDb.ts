import { sql } from "kysely";
import type { Kysely, Selectable } from "kysely";

import type { ProfileModelEvaluation } from "../evaluation/index.js";

import type { Database, LeadPosition, LeadStage } from "./schema.js";

/** One person as a search result describes them, before any profile is fetched. */
export interface FoundLead {
  linkedinMemberId: string;
  name: string;
  headline?: string;
  location?: string;
  industry?: string;
  currentPositions?: LeadPosition[];
  premium?: boolean;
  openProfile?: boolean;
}

/**
 * Save the people a campaign's search found, as new `found` leads.
 *
 * People the campaign already has are skipped, so running the same search
 * again only adds who is new.
 *
 * @returns how many leads were new
 */
export async function insertFoundLeads(
  db: Kysely<Database>,
  campaignId: string,
  leads: readonly FoundLead[],
): Promise<number> {
  if (leads.length === 0) return 0;

  const inserted = await db
    .insertInto("leads")
    .values(
      leads.map((lead) => ({
        campaign_id: campaignId,
        linkedin_member_id: lead.linkedinMemberId,
        name: lead.name,
        headline: lead.headline ?? null,
        location: lead.location ?? null,
        industry: lead.industry ?? null,
        current_positions: lead.currentPositions
          ? JSON.stringify(lead.currentPositions)
          : null,
        premium: lead.premium ?? null,
        open_profile: lead.openProfile ?? null,
      })),
    )
    .onConflict((conflict) =>
      conflict.columns(["campaign_id", "linkedin_member_id"]).doNothing(),
    )
    .returning("id")
    .execute();

  return inserted.length;
}

/** A lead as the pipeline and the CRM read it. */
export type Lead = Selectable<Database["leads"]>;

/** The oldest leads of a campaign at one stage, so leads move through in the order found. */
export async function leadsAtStage(
  db: Kysely<Database>,
  campaignId: string,
  stage: LeadStage,
  limit: number,
): Promise<Lead[]> {
  return db
    .selectFrom("leads")
    .selectAll()
    .where("campaign_id", "=", campaignId)
    .where("stage", "=", stage)
    .orderBy("id")
    .limit(limit)
    .execute();
}

/** How many of a campaign's leads sit at each stage; stages with none are absent. */
export async function countLeadsByStage(
  db: Kysely<Database>,
  campaignId: string,
): Promise<Partial<Record<LeadStage, number>>> {
  const rows = await db
    .selectFrom("leads")
    .select(["stage", (eb) => eb.fn.countAll<string>().as("count")])
    .where("campaign_id", "=", campaignId)
    .groupBy("stage")
    .execute();
  // Postgres counts are bigints, which pg returns as strings.
  return Object.fromEntries(rows.map((row) => [row.stage, Number(row.count)]));
}

/** Move a lead to a stage, saving the model's verdict when there is one. */
export async function setLeadStage(
  db: Kysely<Database>,
  leadId: string,
  stage: LeadStage,
  evaluation?: ProfileModelEvaluation,
): Promise<void> {
  await db
    .updateTable("leads")
    .set({
      stage,
      ...(evaluation ? { evaluation: JSON.stringify(evaluation) } : {}),
      updated_at: sql<Date>`now()`,
    })
    .where("id", "=", leadId)
    .execute();
}

/**
 * Count a failed profile fetch, marking the lead failed once it reaches the
 * attempt limit so one broken profile cannot block its campaign forever.
 */
export async function recordFetchFailure(
  db: Kysely<Database>,
  leadId: string,
  maximumAttempts: number,
): Promise<void> {
  await db
    .updateTable("leads")
    .set((eb) => ({
      fetch_attempts: eb("fetch_attempts", "+", 1),
      stage: sql<LeadStage>`CASE WHEN fetch_attempts + 1 >= ${maximumAttempts} THEN 'failed' ELSE stage END`,
      updated_at: sql<Date>`now()`,
    }))
    .where("id", "=", leadId)
    .execute();
}

/** A lead as the CRM lists it, with its campaign's name. */
export interface LeadRow {
  id: string;
  campaignId: string;
  campaignName: string;
  name: string;
  headline: string | null;
  location: string | null;
  stage: LeadStage;
  evaluation: ProfileModelEvaluation | null;
  updatedAt: Date;
}

/** Filters for the leads list; all optional. */
export interface LeadFilters {
  campaignId?: string;
  stage?: LeadStage;
  /** Matched against name and headline, ignoring case. */
  query?: string;
  limit: number;
  offset: number;
}

/** One page of an organization's leads, newest activity first, plus the total that match. */
export async function listLeads(
  db: Kysely<Database>,
  organizationId: string,
  filters: LeadFilters,
): Promise<{ leads: LeadRow[]; total: number }> {
  let query = organizationLeads(db, organizationId);
  if (filters.campaignId) query = query.where("leads.campaign_id", "=", filters.campaignId);
  if (filters.stage) query = query.where("leads.stage", "=", filters.stage);
  if (filters.query) {
    const pattern = `%${filters.query}%`;
    query = query.where((eb) =>
      eb.or([eb("leads.name", "ilike", pattern), eb("leads.headline", "ilike", pattern)]),
    );
  }

  const [leads, total] = await Promise.all([
    query
      .select(LEAD_ROW_COLUMNS)
      .orderBy("leads.updated_at", "desc")
      .limit(filters.limit)
      .offset(filters.offset)
      .execute(),
    query.select((eb) => eb.fn.countAll<string>().as("count")).executeTakeFirstOrThrow(),
  ]);
  // Postgres counts are bigints, which pg returns as strings.
  return { leads, total: Number(total.count) };
}

/** One lead, only if it belongs to the organization asking for it. */
export async function findLead(
  db: Kysely<Database>,
  organizationId: string,
  leadId: string,
): Promise<(LeadRow & { linkedinMemberId: string }) | undefined> {
  return organizationLeads(db, organizationId)
    .select([...LEAD_ROW_COLUMNS, "leads.linkedin_member_id as linkedinMemberId"])
    .where("leads.id", "=", leadId)
    .executeTakeFirst();
}

/** The oldest lead waiting for manual review, optionally within one campaign, and how many wait. */
export async function nextLeadToReview(
  db: Kysely<Database>,
  organizationId: string,
  campaignId?: string,
): Promise<{ leadId: string | undefined; remaining: number }> {
  let query = organizationLeads(db, organizationId).where("leads.stage", "=", "manual_review");
  if (campaignId) query = query.where("leads.campaign_id", "=", campaignId);

  const [next, count] = await Promise.all([
    query.select("leads.id").orderBy("leads.id").limit(1).executeTakeFirst(),
    query.select((eb) => eb.fn.countAll<string>().as("count")).executeTakeFirstOrThrow(),
  ]);
  return { leadId: next?.id, remaining: Number(count.count) };
}

/** Columns every CRM lead read returns. */
const LEAD_ROW_COLUMNS = [
  "leads.id as id",
  "leads.campaign_id as campaignId",
  "campaigns.name as campaignName",
  "leads.name as name",
  "leads.headline as headline",
  "leads.location as location",
  "leads.stage as stage",
  "leads.evaluation as evaluation",
  "leads.updated_at as updatedAt",
] as const;

/** Leads joined up to their organization, so every CRM read is scoped by it. */
function organizationLeads(db: Kysely<Database>, organizationId: string) {
  return db
    .selectFrom("leads")
    .innerJoin("campaigns", "campaigns.id", "leads.campaign_id")
    .innerJoin("linkedin_accounts", "linkedin_accounts.id", "campaigns.linkedin_account_id")
    .where("linkedin_accounts.organization_id", "=", organizationId);
}

/**
 * Clear approved leads for an invite on behalf of a person.
 *
 * Only approved leads of the person's own organization move; anything else
 * in the list is ignored, so a stale page cannot queue a rejected lead.
 *
 * @returns how many leads were queued
 */
export async function queueLeads(
  db: Kysely<Database>,
  organizationId: string,
  leadIds: readonly string[],
  userId: string,
): Promise<number> {
  if (leadIds.length === 0) return 0;
  const updated = await db
    .updateTable("leads")
    .set({ stage: "queued", queued_by: userId, queued_at: sql<Date>`now()`, updated_at: sql<Date>`now()` })
    .where("id", "in", leadIds)
    .where("stage", "=", "approved")
    .where("campaign_id", "in", (eb) =>
      eb
        .selectFrom("campaigns")
        .innerJoin("linkedin_accounts", "linkedin_accounts.id", "campaigns.linkedin_account_id")
        .select("campaigns.id")
        .where("linkedin_accounts.organization_id", "=", organizationId),
    )
    .executeTakeFirst();
  return Number(updated.numUpdatedRows);
}

/** Record that an invite went out, or that LinkedIn says the person already connected. */
export async function markInvited(
  db: Kysely<Database>,
  leadId: string,
  alreadyConnected = false,
): Promise<void> {
  await db
    .updateTable("leads")
    .set({
      stage: alreadyConnected ? "accepted" : "invited",
      invited_at: sql<Date>`now()`,
      ...(alreadyConnected ? { accepted_at: sql<Date>`now()` } : {}),
      updated_at: sql<Date>`now()`,
    })
    .where("id", "=", leadId)
    .execute();
}

/**
 * Mark as accepted every invited lead of this person sent from this account.
 *
 * Unipile reports a new connection by account and member, not by campaign,
 * so every campaign of the account that invited the person is updated.
 *
 * @returns how many leads changed
 */
export async function markAccepted(
  db: Kysely<Database>,
  unipileAccountId: string,
  linkedinMemberId: string,
): Promise<number> {
  const updated = await db
    .updateTable("leads")
    .set({ stage: "accepted", accepted_at: sql<Date>`now()`, updated_at: sql<Date>`now()` })
    .where("linkedin_member_id", "=", linkedinMemberId)
    .where("stage", "=", "invited")
    .where("campaign_id", "in", (eb) =>
      eb
        .selectFrom("campaigns")
        .innerJoin("linkedin_accounts", "linkedin_accounts.id", "campaigns.linkedin_account_id")
        .select("campaigns.id")
        .where("linkedin_accounts.unipile_account_id", "=", unipileAccountId),
    )
    .executeTakeFirst();
  return Number(updated.numUpdatedRows);
}

/** Whether this account already invited this person, in any of its campaigns. */
export async function alreadyInvitedByAccount(
  db: Kysely<Database>,
  linkedinAccountId: string,
  linkedinMemberId: string,
): Promise<boolean> {
  const row = await db
    .selectFrom("leads")
    .innerJoin("campaigns", "campaigns.id", "leads.campaign_id")
    .select("leads.id")
    .where("campaigns.linkedin_account_id", "=", linkedinAccountId)
    .where("leads.linkedin_member_id", "=", linkedinMemberId)
    .where("leads.invited_at", "is not", null)
    .executeTakeFirst();
  return row !== undefined;
}
