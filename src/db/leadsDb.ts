import type { Kysely } from "kysely";

import type { Database, LeadPosition } from "./schema.js";

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
