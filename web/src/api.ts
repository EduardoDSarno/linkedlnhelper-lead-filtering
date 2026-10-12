/** An API answer outside the 2xx range, carrying the server's error message. */
export class ApiError extends Error {
  readonly status: number;

  /** Builds the error from the status and the server's `{ error }` message. */
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Call the app's API and return its JSON.
 *
 * Every page goes through here, so the session cookie, JSON headers and error
 * handling are written once. A 401 is surfaced like any other error; the auth
 * provider decides what to do with it.
 */
export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: options.body === undefined ? {} : { "content-type": "application/json" },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { error?: string }).error ?? `Request failed (${response.status}).`;
    throw new ApiError(response.status, message);
  }
  return data as T;
}

/** The logged-in user, as `/api/auth/me` returns it. */
export interface User {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
}

/** LinkedIn's people-search fields, as the server stores them. */
export interface PeopleSearch {
  keywords?: string;
  title?: string;
  company?: string;
  school?: string;
  locationIds?: string[];
  industryIds?: string[];
  companyIds?: string[];
  pastCompanyIds?: string[];
  schoolIds?: string[];
  networkDistance?: number[];
  profileLanguages?: string[];
  /** Display names of the ids above. */
  titles?: Record<string, string>;
}

/** One choice for a search filter, e.g. a city with its LinkedIn id. */
export interface SearchParameter {
  id: string;
  title: string;
}

/** A campaign as the server returns it. */
export interface Campaign {
  id: string;
  name: string;
  status: "active" | "paused" | "completed";
  linkedinAccountId: string;
  accountLabel: string;
  search: PeopleSearch;
  criteria: {
    systemPrompt: string;
    decisionPolicy?: { minimumApprovalPercent?: number; minimumManualReviewPercent?: number };
  };
  approvedTarget: number | null;
  requireInviteApproval: boolean;
  weeklyInviteLimit: number | null;
  dailyProfileLimit: number | null;
  createdAt: string;
}

/** A connected LinkedIn account. */
export interface LinkedinAccount {
  id: string;
  label: string;
  unipile_account_id: string;
  connected_at: string;
}

/** Where a lead is in the funnel. */
export type LeadStage =
  | "found"
  | "profiled"
  | "approved"
  | "manual_review"
  | "rejected"
  | "queued"
  | "invited"
  | "accepted"
  | "failed";

/** The AI's verdict on one profile. */
export interface Evaluation {
  matchPercent: number;
  decision: "approved" | "manual_review" | "rejected";
  summary: string;
  positives: string[];
  negatives: string[];
}

/** A lead in the CRM list. */
export interface Lead {
  id: string;
  campaignId: string;
  campaignName: string;
  name: string;
  headline: string | null;
  location: string | null;
  stage: LeadStage;
  evaluation: Evaluation | null;
  updatedAt: string;
}

/** A date with only the precision LinkedIn gives. */
export interface ProfileDate {
  year?: number;
  month?: number;
  text?: string;
}

/** Everything the lead page shows. */
export interface LeadDetail {
  lead: Lead;
  campaignPrompt: string | null;
  profile: {
    linkedinUrl: string;
    about: string | null;
    experience: { position: string; companyName: string; location?: string; startDate?: ProfileDate; endDate?: ProfileDate }[];
    education: { schoolName: string; degree?: string; fieldOfStudy?: string; startDate?: ProfileDate; endDate?: ProfileDate }[];
  } | null;
  reviews: {
    decision: "approved" | "rejected";
    modelDecision: string | null;
    modelScore: number | null;
    note: string | null;
    reviewer: string;
    createdAt: string;
  }[];
}

/** One saved line of an account's conversation with its agent. */
export interface AgentMessage {
  id: string;
  runId: string | null;
  role: "user" | "assistant" | "tool";
  content: string | null;
  toolCalls: { id: string; function: { name: string; arguments: string } }[] | null;
  toolCallId: string | null;
  toolName: string | null;
  createdAt: string;
}

/** What a campaign has taught so far: agreement with the user, approval and acceptance rates. */
export interface CampaignInsights {
  approvalRate: number | null;
  acceptanceRate: number | null;
  reviews: {
    total: number;
    agreed: number;
    aiTooLoose: number;
    aiTooStrict: number;
    aiUnsure: number;
    agreementRate: number | null;
  };
}
