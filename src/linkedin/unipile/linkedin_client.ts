import type { FoundLead } from "../../db/leadsDb.js";
import type { LeadPosition } from "../../db/schema.js";
import { asRecord, asString } from "../../shared/helpers/index.js";
import type {
  LinkedinClient,
  PeopleSearch,
  SearchPage,
  SearchParameter,
} from "../client.js";
import type { UnipileConfig } from "./config.js";
import { sendUnipileRequest } from "./request.js";
import type { FetchFunction } from "./request.js";

/** Profile sections requested: everything, since evaluation reads the whole profile. */
const ALL_PROFILE_SECTIONS = "*";

/** Choices returned per filter lookup, enough to fill a dropdown. */
const SEARCH_PARAMETER_LOOKUP_LIMIT = "20";

/**
 * The real LinkedIn, through Unipile's API.
 *
 * Every reply is read field by field instead of cast, so a change on
 * Unipile's side surfaces as a missing value rather than a wrong one.
 */
export function createUnipileLinkedinClient(
  workspace: UnipileConfig,
  fetchFunction: FetchFunction = fetch,
): LinkedinClient {
  return {
    mode: "unipile",

    async searchPeople(accountId, search, cursor) {
      const reply = await sendUnipileRequest(
        workspace,
        {
          method: "POST",
          path: "/linkedin/search",
          query: { account_id: accountId, ...(cursor ? { cursor } : {}) },
          body: searchBody(search),
        },
        fetchFunction,
      );
      return searchPage(reply);
    },

    async searchParameters(accountId, type, keywords) {
      const reply = await sendUnipileRequest(
        workspace,
        {
          method: "GET",
          path: "/linkedin/search/parameters",
          query: { account_id: accountId, type, keywords, limit: SEARCH_PARAMETER_LOOKUP_LIMIT },
        },
        fetchFunction,
      );
      return records(asRecord(reply)?.["items"]).flatMap((item): SearchParameter[] => {
        const id = asString(item["id"]);
        const title = asString(item["title"]);
        return id && title ? [{ id, title }] : [];
      });
    },

    async getProfile(accountId, memberId) {
      const reply = await sendUnipileRequest(
        workspace,
        {
          method: "GET",
          path: `/users/${encodeURIComponent(memberId)}`,
          query: { account_id: accountId, linkedin_sections: ALL_PROFILE_SECTIONS },
        },
        fetchFunction,
      );
      const profile = asRecord(reply);
      if (!profile) throw new Error(`Unipile returned no profile for ${memberId}.`);
      return profile;
    },

    async sendInvite(accountId, memberId, message) {
      await sendUnipileRequest(
        workspace,
        {
          method: "POST",
          path: "/users/invite",
          body: { provider_id: memberId, account_id: accountId, ...(message ? { message } : {}) },
        },
        fetchFunction,
      );
    },
  };
}

/**
 * Translate a campaign's search into Unipile's classic people-search body.
 *
 * Empty lists are left out because Unipile rejects a filter with no items.
 */
export function searchBody(search: PeopleSearch): Record<string, unknown> {
  const advanced = {
    first_name: search.firstName,
    last_name: search.lastName,
    title: search.title,
    company: search.company,
    school: search.school,
  };
  const advancedSet = Object.fromEntries(Object.entries(advanced).filter(([, value]) => value));

  return {
    api: "classic",
    category: "people",
    ...(search.keywords ? { keywords: search.keywords } : {}),
    ...nonEmpty("location", search.locationIds),
    ...nonEmpty("industry", search.industryIds),
    ...nonEmpty("company", search.companyIds),
    ...nonEmpty("past_company", search.pastCompanyIds),
    ...nonEmpty("school", search.schoolIds),
    ...nonEmpty("network_distance", search.networkDistance),
    ...nonEmpty("profile_language", search.profileLanguages),
    ...(Object.keys(advancedSet).length ? { advanced_keywords: advancedSet } : {}),
  };
}

/** Read one page of search results; items that are not people are skipped. */
export function searchPage(reply: unknown): SearchPage {
  const record = asRecord(reply);
  return {
    people: records(record?.["items"]).flatMap((item) => {
      const person = foundLead(item);
      return person ? [person] : [];
    }),
    cursor: asString(record?.["cursor"]) ?? null,
  };
}

/** One search card as a lead, or nothing when it lacks an id or a name. */
function foundLead(item: Record<string, unknown>): FoundLead | undefined {
  const linkedinMemberId = asString(item["id"]);
  const name = asString(item["name"]);
  if (!linkedinMemberId || !name) return undefined;

  const headline = asString(item["headline"]);
  const location = asString(item["location"]);
  const industry = asString(item["industry"]);
  const premium = item["premium"];
  const openProfile = item["open_profile"];
  const positions = records(item["current_positions"]).flatMap(leadPosition);

  return {
    linkedinMemberId,
    name,
    ...(headline ? { headline } : {}),
    ...(location ? { location } : {}),
    ...(industry ? { industry } : {}),
    ...(positions.length ? { currentPositions: positions } : {}),
    ...(typeof premium === "boolean" ? { premium } : {}),
    ...(typeof openProfile === "boolean" ? { openProfile } : {}),
  };
}

/** One current job from a search card, or nothing when company or role is missing. */
function leadPosition(item: Record<string, unknown>): LeadPosition[] {
  const company = asString(item["company"]);
  const role = asString(item["role"]);
  if (!company || !role) return [];
  return [
    {
      company,
      role,
      location: asString(item["location"]) ?? null,
      description: asString(item["description"]) ?? null,
    },
  ];
}

/** The object entries of a value that should be a list, ignoring anything else. */
function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}

/** `{ key: list }` when the list has items, otherwise nothing. */
function nonEmpty(key: string, list: readonly unknown[] | undefined): Record<string, unknown> {
  return list?.length ? { [key]: list } : {};
}
