import type { FoundLead } from "../db/leadsDb.js";
import { createFakeLinkedinClient } from "./fake/fake_client.js";
import { createUnipileLinkedinClient } from "./unipile/linkedin_client.js";
import { requireUnipileWorkspace } from "./unipile/config.js";
import { UnipileRequestError } from "./unipile/request.js";

/** Environment variable choosing which LinkedIn the app talks to. */
const LINKEDIN_MODE_KEY = "LINKEDIN_MODE";

/**
 * `fake` answers from generated sample people and never contacts LinkedIn;
 * `unipile` acts on real accounts. Fake is the default so a missing setting
 * can never send real invites by accident.
 */
export const LINKEDIN_MODES = ["fake", "unipile"] as const;
export type LinkedinMode = (typeof LINKEDIN_MODES)[number];

/**
 * The search fields a campaign sets, mirroring LinkedIn's Premium people
 * search. Lists hold LinkedIn's own ids, looked up with `searchParameters`.
 */
export interface PeopleSearch {
  keywords?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: string;
  school?: string;
  locationIds?: string[];
  industryIds?: string[];
  companyIds?: string[];
  pastCompanyIds?: string[];
  schoolIds?: string[];
  networkDistance?: NetworkDistance[];
  /** Two-letter language codes, e.g. `pt`. */
  profileLanguages?: string[];
  /** Display names of the ids above, for showing the search back; never sent to LinkedIn. */
  titles?: Record<string, string>;
}

/** 1st, 2nd or 3rd+ degree connection. */
export type NetworkDistance = 1 | 2 | 3;

/** One page of search results, and where the next page starts. */
export interface SearchPage {
  people: FoundLead[];
  /** Null on the last page. */
  cursor: string | null;
}

/** The lists LinkedIn search filters by id, which the campaign form looks up. */
export const SEARCH_PARAMETER_TYPES = ["LOCATION", "INDUSTRY", "COMPANY", "SCHOOL"] as const;
export type SearchParameterType = (typeof SEARCH_PARAMETER_TYPES)[number];

/** One choice for a search filter, e.g. a city with its LinkedIn id. */
export interface SearchParameter {
  id: string;
  title: string;
}

/**
 * Everything the app does on LinkedIn, behind one interface so the fake and
 * the real Unipile client are interchangeable. `accountId` is always
 * Unipile's id for the account (`linkedin_accounts.unipile_account_id`).
 */
export interface LinkedinClient {
  readonly mode: LinkedinMode;
  searchPeople(accountId: string, search: PeopleSearch, cursor?: string): Promise<SearchPage>;
  searchParameters(
    accountId: string,
    type: SearchParameterType,
    keywords: string,
  ): Promise<SearchParameter[]>;
  /** The full profile exactly as returned, stored raw in `profiles`. */
  getProfile(accountId: string, memberId: string): Promise<Record<string, unknown>>;
  sendInvite(accountId: string, memberId: string, message?: string): Promise<void>;
}

/** HTTP statuses Unipile uses when LinkedIn refuses more actions for now. */
const HTTP_UNPROCESSABLE = 422;
const HTTP_TOO_MANY_REQUESTS = 429;
const LIMIT_STATUSES = new Set([HTTP_UNPROCESSABLE, HTTP_TOO_MANY_REQUESTS]);

/** Unipile error types (on 422) that mean a LinkedIn limit, not a problem with one person. */
const LIMIT_ERROR_TYPES = new Set([
  "errors/limit_exceeded",
  "errors/connection_limit_reached",
  "errors/too_many_requests",
]);

/**
 * Whether an error means LinkedIn wants the account to slow down.
 *
 * The pipeline stops all work for that account until the next pass instead
 * of moving on to the next person, which would keep hitting the same wall.
 */
export function isLinkedinLimitError(error: unknown): boolean {
  if (!(error instanceof UnipileRequestError) || !LIMIT_STATUSES.has(error.status)) return false;
  return error.status === HTTP_TOO_MANY_REQUESTS || LIMIT_ERROR_TYPES.has(error.type ?? "");
}

/** Build the client the environment asks for. */
export function createLinkedinClient(
  environment: NodeJS.ProcessEnv = process.env,
): LinkedinClient {
  return resolveLinkedinMode(environment) === "unipile"
    ? createUnipileLinkedinClient(requireUnipileWorkspace(environment))
    : createFakeLinkedinClient();
}

/**
 * Read the mode, refusing unknown values rather than guessing: a typo must
 * not silently decide whether real accounts are touched.
 *
 * @throws When LINKEDIN_MODE is set to something other than a known mode.
 */
export function resolveLinkedinMode(environment: NodeJS.ProcessEnv = process.env): LinkedinMode {
  const value = environment[LINKEDIN_MODE_KEY]?.trim() || "fake";
  const mode = LINKEDIN_MODES.find((known) => known === value);
  if (!mode) {
    throw new Error(`${LINKEDIN_MODE_KEY} must be one of: ${LINKEDIN_MODES.join(", ")}.`);
  }
  return mode;
}
