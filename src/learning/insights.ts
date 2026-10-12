import type { Kysely } from "kysely";

import type { CampaignView } from "../db/campaignsDb.js";
import { countLeadsByStage } from "../db/leadsDb.js";
import type { Database, ReviewDecision } from "../db/schema.js";
import type { FullEvaluationCriteria, ProfileModelEvaluation } from "../evaluation/index.js";
import { scoreMembers } from "../pipeline/steps.js";
import type { PipelineContext } from "../pipeline/steps.js";

/** How the AI's verdicts compare with a person's decisions on the same leads. */
export interface Agreement {
  /** Leads compared. */
  total: number;
  /** AI said the same as the person. */
  agreed: number;
  /** AI approved, person rejected: the prompt lets in people it shouldn't. */
  aiTooLoose: number;
  /** AI rejected, person approved: the prompt shuts out people it should keep. */
  aiTooStrict: number;
  /** AI sent to manual review: it could not decide. */
  aiUnsure: number;
  /** `agreed / total`, or null with nothing to compare. */
  agreementRate: number | null;
}

/** Stages a lead reaches only after being approved. */
const APPROVED_OR_LATER = ["approved", "queued", "invited", "accepted"] as const;

/**
 * What a campaign has taught so far, at no model cost: how often the person
 * overrides the AI and in which direction, how many evaluated leads are
 * approved, and how many invites are accepted.
 */
export async function campaignInsights(db: Kysely<Database>, campaignId: string) {
  const [funnel, reviews] = await Promise.all([countLeadsByStage(db, campaignId), latestReviews(db, campaignId)]);

  const approved = APPROVED_OR_LATER.reduce((sum, stage) => sum + (funnel[stage] ?? 0), 0);
  const evaluated = approved + (funnel.rejected ?? 0) + (funnel.manual_review ?? 0);
  const invited = (funnel.invited ?? 0) + (funnel.accepted ?? 0);

  return {
    funnel,
    approvalRate: evaluated ? approved / evaluated : null,
    acceptanceRate: invited ? (funnel.accepted ?? 0) / invited : null,
    reviews: agreement(reviews.map((review) => ({ model: review.modelDecision, person: review.decision }))),
  };
}

/** Most reviewed leads re-scored per prompt test, keeping each test to a few cents. */
export const PROMPT_TEST_SAMPLE = 30;

/**
 * Re-score leads the person already decided, with the current criteria and
 * with proposed ones, and report how well each agrees with the person.
 *
 * This is how a prompt change is judged by evidence instead of by feel:
 * the person's decisions are the answer key. Nothing about the leads or the
 * campaign changes.
 */
export async function testCriteria(
  context: PipelineContext,
  campaign: CampaignView,
  proposed: FullEvaluationCriteria,
) {
  const reviews = (await latestReviews(context.db, campaign.id)).slice(0, PROMPT_TEST_SAMPLE);
  if (reviews.length === 0) {
    return { sample: 0, note: "No reviewed leads yet: decide some leads on the Review page first." };
  }

  const members = reviews.map((review) => review.memberId);
  const [current, next] = await Promise.all([
    scoreMembers(context, campaign.criteria, members),
    scoreMembers(context, proposed, members),
  ]);

  /** Agreement of one scoring with the person's decisions. */
  const against = (scores: Map<string, ProfileModelEvaluation>) =>
    agreement(
      reviews.flatMap((review) => {
        const evaluation = scores.get(review.memberId);
        return evaluation ? [{ model: evaluation.decision, person: review.decision }] : [];
      }),
    );

  const changed = reviews.flatMap((review) => {
    const before = current.evaluations.get(review.memberId);
    const after = next.evaluations.get(review.memberId);
    if (!before || !after || before.decision === after.decision) return [];
    return [{ lead: review.leadName, person: review.decision, before: before.decision, after: after.decision, reason: after.summary }];
  });

  return { sample: reviews.length, current: against(current.evaluations), proposed: against(next.evaluations), changed };
}

/** Count agreement between the AI's and the person's decisions. */
export function agreement(pairs: readonly { model: string | null; person: ReviewDecision }[]): Agreement {
  const judged = pairs.filter((pair) => pair.model !== null);
  const agreed = judged.filter((pair) => pair.model === pair.person).length;
  return {
    total: judged.length,
    agreed,
    aiTooLoose: judged.filter((pair) => pair.model === "approved" && pair.person === "rejected").length,
    aiTooStrict: judged.filter((pair) => pair.model === "rejected" && pair.person === "approved").length,
    aiUnsure: judged.filter((pair) => pair.model === "manual_review").length,
    agreementRate: judged.length ? agreed / judged.length : null,
  };
}

/** Each reviewed lead's most recent decision (a re-decision replaces the earlier one), latest leads first. */
async function latestReviews(db: Kysely<Database>, campaignId: string) {
  return db
    .selectFrom("reviews")
    .innerJoin("leads", "leads.id", "reviews.lead_id")
    .distinctOn("reviews.lead_id")
    .select([
      "reviews.lead_id as leadId",
      "leads.linkedin_member_id as memberId",
      "leads.name as leadName",
      "reviews.model_decision as modelDecision",
      "reviews.decision as decision",
    ])
    .where("leads.campaign_id", "=", campaignId)
    .orderBy("reviews.lead_id")
    .orderBy("reviews.id", "desc")
    .execute()
    .then((rows) => rows.reverse());
}
