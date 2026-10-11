import type { Kysely } from "kysely";

import type { FullEvaluationCriteria } from "../evaluation/criterias/user_criteria.js";
import type { Database } from "./schema.js";

/** What a caller provides to start a campaign; the database fills the rest. */
export interface NewCampaign {
  linkedinAccountId: string;
  name: string;
  searchUrl: string;
  criteria: FullEvaluationCriteria;
}

/**
 * Save a new campaign for an account.
 *
 * The criteria arrive already typed and are saved as JSON text. Checking that
 * they make sense is left to whoever receives them from the user, since the
 * criteria format is still being decided.
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
      search_url: campaign.searchUrl,
      criteria: JSON.stringify(campaign.criteria),
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return result.id;
}
