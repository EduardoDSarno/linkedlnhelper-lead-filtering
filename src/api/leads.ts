import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";

import { findCampaign } from "../db/campaignsDb.js";
import { countLeadsByStage, findLead, listLeads, nextLeadToReview, queueLeads } from "../db/leadsDb.js";
import { findProfiles } from "../db/profilesDb.js";
import { listReviews, reviewLead } from "../db/reviewsDb.js";
import type { Database, LeadStage, ReviewDecision } from "../db/schema.js";
import { mapUnipileProfile } from "../profiles/sources/unipile/unipile_profile.js";
import { asRecord, asString } from "../shared/helpers/index.js";
import { currentUser } from "./auth.js";
import { HTTP_BAD_REQUEST, HTTP_NOT_FOUND } from "./consts.js";

/** Leads per page in the CRM list. */
const LEADS_PAGE_SIZE = 50;

/** Stages a lead can be filtered by. */
const LEAD_STAGES: readonly LeadStage[] = [
  "found",
  "profiled",
  "approved",
  "manual_review",
  "rejected",
  "queued",
  "invited",
  "accepted",
  "failed",
];

/** Decisions a person can make on a lead. */
const REVIEW_DECISIONS: readonly ReviewDecision[] = ["approved", "rejected"];

/** Stages after which a decision no longer makes sense: the person was already contacted. */
const CONTACTED_STAGES: readonly LeadStage[] = ["invited", "accepted"];

/**
 * CRM routes: the leads list, one lead with its profile and AI verdict, the
 * manual review queue, a person's decision, clearing approved leads for
 * invites, and a campaign's funnel counts.
 * Must be registered behind `requireUser`; all reads are organization-scoped.
 */
export function registerLeadRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  app.get<{ Querystring: { campaignId?: string; stage?: string; q?: string; page?: string } }>(
    "/api/leads",
    async (request) => {
      const { campaignId, stage, q, page } = request.query;
      const pageNumber = Math.max(1, Number(page) || 1);
      const knownStage = LEAD_STAGES.find((known) => known === stage);
      const result = await listLeads(db, currentUser(request).organizationId, {
        ...(campaignId ? { campaignId } : {}),
        ...(knownStage ? { stage: knownStage } : {}),
        ...(q?.trim() ? { query: q.trim() } : {}),
        limit: LEADS_PAGE_SIZE,
        offset: (pageNumber - 1) * LEADS_PAGE_SIZE,
      });
      return { ...result, pageSize: LEADS_PAGE_SIZE };
    },
  );

  app.get<{ Querystring: { campaignId?: string } }>("/api/review/next", async (request) =>
    nextLeadToReview(db, currentUser(request).organizationId, request.query.campaignId || undefined),
  );

  app.get<{ Params: { id: string } }>("/api/leads/:id", async (request, reply) => {
    const { organizationId } = currentUser(request);
    const lead = await findLead(db, organizationId, request.params.id);
    if (!lead) return reply.code(HTTP_NOT_FOUND).send({ error: "Lead not found." });

    const [campaign, profiles, reviews] = await Promise.all([
      findCampaign(db, organizationId, lead.campaignId),
      findProfiles(db, [lead.linkedinMemberId]),
      listReviews(db, lead.id),
    ]);
    const stored = profiles.get(lead.linkedinMemberId);
    const profile = stored ? mapUnipileProfile(lead.linkedinMemberId, stored.data) : null;

    return {
      lead,
      campaignPrompt: campaign?.criteria.systemPrompt ?? null,
      profile: profile && {
        linkedinUrl: profile.linkedinUrl,
        about: (profile.raw as { about?: string }).about ?? null,
        experience: profile.experience,
        education: profile.education,
      },
      reviews,
    };
  });

  app.post<{ Params: { id: string } }>("/api/leads/:id/review", async (request, reply) => {
    const user = currentUser(request);
    const lead = await findLead(db, user.organizationId, request.params.id);
    if (!lead) return reply.code(HTTP_NOT_FOUND).send({ error: "Lead not found." });

    const body = asRecord(request.body);
    const decision = REVIEW_DECISIONS.find((known) => known === asString(body?.["decision"]));
    if (!decision) return reply.code(HTTP_BAD_REQUEST).send({ error: "decision must be approved or rejected." });
    if (CONTACTED_STAGES.includes(lead.stage)) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: "This person was already contacted." });
    }

    const note = asString(body?.["note"])?.trim();
    await reviewLead(db, {
      leadId: lead.id,
      userId: user.id,
      decision,
      ...(note ? { note } : {}),
      evaluation: lead.evaluation,
    });
    return { stage: decision };
  });

  app.post("/api/leads/queue", async (request, reply) => {
    const user = currentUser(request);
    const ids = asRecord(request.body)?.["leadIds"];
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: "leadIds must be a list of ids." });
    }
    return { queued: await queueLeads(db, user.organizationId, ids, user.id) };
  });

  app.get<{ Params: { id: string } }>("/api/campaigns/:id/funnel", async (request, reply) => {
    const campaign = await findCampaign(db, currentUser(request).organizationId, request.params.id);
    if (!campaign) return reply.code(HTTP_NOT_FOUND).send({ error: "Campaign not found." });
    return { counts: await countLeadsByStage(db, campaign.id) };
  });
}
