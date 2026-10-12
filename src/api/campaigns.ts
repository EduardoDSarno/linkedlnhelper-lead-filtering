import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";

import {
  findCampaign,
  insertCampaign,
  listCampaigns,
  setCampaignStatus,
  setInviteApproval,
} from "../db/campaignsDb.js";
import { findLinkedinAccount } from "../db/linkedinAccountsDb.js";
import type { Database } from "../db/schema.js";
import {
  DECISION_POLICY_MODE,
  EvaluationCriteriaFileError,
  parseFullEvaluationCriteria,
} from "../evaluation/criterias/index.js";
import type { FullEvaluationCriteria } from "../evaluation/criterias/index.js";
import { campaignInsights } from "../learning/insights.js";
import { SEARCH_PARAMETER_TYPES } from "../linkedin/client.js";
import type { LinkedinClient, NetworkDistance, PeopleSearch } from "../linkedin/client.js";
import { asRecord, asString } from "../shared/helpers/index.js";
import { currentUser } from "./auth.js";
import { HTTP_BAD_REQUEST, HTTP_NOT_FOUND } from "./consts.js";

/**
 * Score thresholds a new campaign starts with: at or above `approve` a lead is
 * approved, at or above `review` it goes to manual review, below it is
 * rejected. The form shows them so the user can change them per campaign.
 */
export const DEFAULT_THRESHOLDS = { approve: 70, review: 40 } as const;

/** Statuses a user may set by hand; `completed` is only set by the pipeline. */
const USER_STATUSES = ["active", "paused"] as const;

/** Connection degrees LinkedIn's search accepts. */
const NETWORK_DISTANCES: readonly NetworkDistance[] = [1, 2, 3];

/** Text fields of a search, copied as trimmed strings when present. */
const SEARCH_TEXT_FIELDS = ["keywords", "firstName", "lastName", "title", "company", "school"] as const;

/** Id-list fields of a search, copied as lists of strings when present. */
const SEARCH_LIST_FIELDS = [
  "locationIds",
  "industryIds",
  "companyIds",
  "pastCompanyIds",
  "schoolIds",
  "profileLanguages",
] as const;

/**
 * Campaign routes: list, view, create, pause/resume, plus the search-filter
 * lookup the campaign form uses. Must be registered behind `requireUser`;
 * every query is scoped to the user's organization.
 */
export function registerCampaignRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  linkedin: LinkedinClient,
): void {
  app.get("/api/campaigns", async (request) => ({
    campaigns: await listCampaigns(db, currentUser(request).organizationId),
  }));

  app.get("/api/campaigns/defaults", async () => ({ thresholds: DEFAULT_THRESHOLDS }));

  app.get<{ Params: { id: string } }>("/api/campaigns/:id/insights", async (request, reply) => {
    const campaign = await findCampaign(db, currentUser(request).organizationId, request.params.id);
    if (!campaign) return reply.code(HTTP_NOT_FOUND).send({ error: "Campaign not found." });
    return campaignInsights(db, campaign.id);
  });

  app.get<{ Params: { id: string } }>("/api/campaigns/:id", async (request, reply) => {
    const campaign = await findCampaign(db, currentUser(request).organizationId, request.params.id);
    if (!campaign) return reply.code(HTTP_NOT_FOUND).send({ error: "Campaign not found." });
    return { campaign };
  });

  app.post("/api/campaigns", async (request, reply) => {
    const { organizationId } = currentUser(request);
    const body = asRecord(request.body) ?? {};

    let input: ReturnType<typeof parseNewCampaign>;
    try {
      input = parseNewCampaign(body);
    } catch (error) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: (error as Error).message });
    }

    const account = await findLinkedinAccount(db, organizationId, input.linkedinAccountId);
    if (!account) return reply.code(HTTP_BAD_REQUEST).send({ error: "Choose one of your LinkedIn accounts." });

    const id = await insertCampaign(db, input);
    return { id };
  });

  app.post<{ Params: { id: string } }>("/api/campaigns/:id/status", async (request, reply) => {
    const campaign = await findCampaign(db, currentUser(request).organizationId, request.params.id);
    if (!campaign) return reply.code(HTTP_NOT_FOUND).send({ error: "Campaign not found." });

    const status = USER_STATUSES.find((known) => known === asString(asRecord(request.body)?.["status"]));
    if (!status) return reply.code(HTTP_BAD_REQUEST).send({ error: "status must be active or paused." });
    if (campaign.status === "completed") {
      return reply.code(HTTP_BAD_REQUEST).send({ error: "A completed campaign cannot be restarted." });
    }

    await setCampaignStatus(db, campaign.id, status);
    return { status };
  });

  app.post<{ Params: { id: string } }>("/api/campaigns/:id/invite-approval", async (request, reply) => {
    const campaign = await findCampaign(db, currentUser(request).organizationId, request.params.id);
    if (!campaign) return reply.code(HTTP_NOT_FOUND).send({ error: "Campaign not found." });

    const required = asRecord(request.body)?.["required"];
    if (typeof required !== "boolean") return reply.code(HTTP_BAD_REQUEST).send({ error: "required must be true or false." });

    await setInviteApproval(db, campaign.id, required);
    return { required };
  });

  app.get<{ Querystring: { accountId?: string; type?: string; q?: string } }>(
    "/api/search-parameters",
    async (request, reply) => {
      const { accountId, type, q } = request.query;
      const parameterType = SEARCH_PARAMETER_TYPES.find((known) => known === type);
      if (!accountId || !parameterType) {
        return reply.code(HTTP_BAD_REQUEST).send({ error: "accountId and a valid type are required." });
      }
      const account = await findLinkedinAccount(db, currentUser(request).organizationId, accountId);
      if (!account) return reply.code(HTTP_NOT_FOUND).send({ error: "Account not found." });

      return {
        items: await linkedin.searchParameters(account.unipile_account_id, parameterType, q?.trim() ?? ""),
      };
    },
  );
}

/**
 * Read and check the campaign form.
 *
 * The prompt and thresholds become evaluation criteria, which then go through
 * the evaluation's own validator, so the campaign saved is exactly one the
 * evaluation accepts.
 *
 * @throws With a message for the user when a field is missing or invalid.
 */
export function parseNewCampaign(body: Record<string, unknown>) {
  const linkedinAccountId = asString(body["linkedinAccountId"]);
  const name = asString(body["name"])?.trim();
  const prompt = asString(body["prompt"])?.trim();
  if (!linkedinAccountId) throw new Error("Choose a LinkedIn account.");
  if (!name) throw new Error("Give the campaign a name.");
  if (!prompt) throw new Error("Describe who you are looking for.");

  const search = parsePeopleSearch(body["search"]);
  if (Object.keys(search).length === 0) throw new Error("Set at least one search field.");

  const approve = optionalWholeNumber(body["approvalThreshold"], "Approval threshold") ?? DEFAULT_THRESHOLDS.approve;
  const review = optionalWholeNumber(body["reviewThreshold"], "Review threshold") ?? DEFAULT_THRESHOLDS.review;

  let criteria: FullEvaluationCriteria;
  try {
    criteria = parseFullEvaluationCriteria({
      systemPrompt: prompt,
      decisionPolicy: {
        mode: DECISION_POLICY_MODE.automatic,
        minimumApprovalPercent: approve,
        minimumManualReviewPercent: review,
      },
    });
  } catch (error) {
    if (error instanceof EvaluationCriteriaFileError) throw new Error(error.message);
    throw error;
  }

  const approvedTarget = optionalWholeNumber(body["approvedTarget"], "Approved leads target");
  const weeklyInviteLimit = optionalWholeNumber(body["weeklyInviteLimit"], "Weekly invite budget");
  const dailyProfileLimit = optionalWholeNumber(body["dailyProfileLimit"], "Daily profile budget");

  return {
    linkedinAccountId,
    name,
    search,
    criteria,
    ...(approvedTarget ? { approvedTarget } : {}),
    ...(weeklyInviteLimit !== undefined ? { weeklyInviteLimit } : {}),
    ...(dailyProfileLimit !== undefined ? { dailyProfileLimit } : {}),
  };
}

/** Copy only the known, well-typed search fields, dropping blanks and empty lists. */
export function parsePeopleSearch(value: unknown): PeopleSearch {
  const record = asRecord(value) ?? {};
  const search: PeopleSearch = {};

  for (const field of SEARCH_TEXT_FIELDS) {
    const text = asString(record[field])?.trim();
    if (text) search[field] = text;
  }
  for (const field of SEARCH_LIST_FIELDS) {
    const list = stringList(record[field]);
    if (list.length) search[field] = list;
  }
  const distances = Array.isArray(record["networkDistance"])
    ? NETWORK_DISTANCES.filter((distance) => (record["networkDistance"] as unknown[]).includes(distance))
    : [];
  if (distances.length) search.networkDistance = distances;

  const titles = Object.entries(asRecord(record["titles"]) ?? {}).flatMap(([id, title]) =>
    typeof title === "string" && title.trim() ? [[id, title.trim()] as const] : [],
  );
  if (titles.length && Object.keys(search).length) search.titles = Object.fromEntries(titles);

  return search;
}

/** A list's non-blank strings, or an empty list for anything else. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []));
}

/**
 * A whole, non-negative number from a form field, or nothing when left blank.
 *
 * @throws When the field holds something that is not a whole number.
 */
function optionalWholeNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label} must be a whole number.`);
  return number;
}
