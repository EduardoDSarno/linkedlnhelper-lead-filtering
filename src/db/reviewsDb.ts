import type { Kysely } from "kysely";

import type { ProfileModelEvaluation } from "../evaluation/index.js";
import { setLeadStage } from "./leadsDb.js";
import type { Database, ReviewDecision } from "./schema.js";

/** A past decision on a lead, as the lead page shows it. */
export interface ReviewRow {
  decision: ReviewDecision;
  modelDecision: string | null;
  modelScore: number | null;
  note: string | null;
  reviewer: string;
  createdAt: Date;
}

/**
 * Record a person's decision on a lead and move the lead to it.
 *
 * The AI's verdict at that moment is copied into the review, so later
 * re-evaluations cannot rewrite what the person actually disagreed with.
 */
export async function reviewLead(
  db: Kysely<Database>,
  review: {
    leadId: string;
    userId: string;
    decision: ReviewDecision;
    note?: string;
    evaluation: ProfileModelEvaluation | null;
  },
): Promise<void> {
  await db.transaction().execute(async (transaction) => {
    await transaction
      .insertInto("reviews")
      .values({
        lead_id: review.leadId,
        user_id: review.userId,
        model_decision: review.evaluation?.decision ?? null,
        model_score: review.evaluation?.matchPercent ?? null,
        decision: review.decision,
        note: review.note ?? null,
      })
      .execute();
    await setLeadStage(transaction, review.leadId, review.decision);
  });
}

/** Every decision made on a lead, newest first, with who made it. */
export async function listReviews(db: Kysely<Database>, leadId: string): Promise<ReviewRow[]> {
  return db
    .selectFrom("reviews")
    .innerJoin("users", "users.id", "reviews.user_id")
    .select([
      "reviews.decision as decision",
      "reviews.model_decision as modelDecision",
      "reviews.model_score as modelScore",
      "reviews.note as note",
      "users.email as reviewer",
      "reviews.created_at as createdAt",
    ])
    .where("reviews.lead_id", "=", leadId)
    .orderBy("reviews.created_at", "desc")
    .execute();
}

/** Recent human decisions on an account's leads, with the AI's verdict and the lead's headline. */
export async function recentAccountReviews(
  db: Kysely<Database>,
  linkedinAccountId: string,
  limit: number,
  campaignId?: string,
): Promise<
  {
    campaignId: string;
    leadName: string;
    headline: string | null;
    modelDecision: string | null;
    modelScore: number | null;
    decision: ReviewDecision;
    note: string | null;
    createdAt: Date;
  }[]
> {
  let query = db
    .selectFrom("reviews")
    .innerJoin("leads", "leads.id", "reviews.lead_id")
    .innerJoin("campaigns", "campaigns.id", "leads.campaign_id")
    .select([
      "leads.campaign_id as campaignId",
      "leads.name as leadName",
      "leads.headline as headline",
      "reviews.model_decision as modelDecision",
      "reviews.model_score as modelScore",
      "reviews.decision as decision",
      "reviews.note as note",
      "reviews.created_at as createdAt",
    ])
    .where("campaigns.linkedin_account_id", "=", linkedinAccountId);
  if (campaignId) query = query.where("leads.campaign_id", "=", campaignId);
  return query.orderBy("reviews.id", "desc").limit(limit).execute();
}
