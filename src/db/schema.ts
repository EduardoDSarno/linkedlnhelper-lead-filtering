import type { Generated, GeneratedAlways, JSONColumnType } from 'kysely';

import type { FullEvaluationCriteria } from '../evaluation/criterias/user_criteria.js';
import type { ProfileModelEvaluation } from '../evaluation/index.js';
import type { PeopleSearch } from '../linkedin/client.js';

/**
 * Every table as TypeScript sees it, so Kysely can check column names and
 * value types before a query runs.
 *
 * It repeats the SQL migrations by hand: a column added in SQL must be added
 * here too, or TypeScript will not know it exists.
 */
export interface Database {
  organizations: {
    id: GeneratedAlways<string>;
    name: string;
    created_at: Generated<Date>;
  };

  users: {
    id: GeneratedAlways<string>;
    organization_id: string;
    /** Always lowercased before it is saved or looked up. */
    email: string;
    password_hash: string;
    created_at: Generated<Date>;
  };

  sessions: {
    /** SHA-256 of the cookie token; the token itself is never stored. */
    token_hash: string;
    user_id: string;
    expires_at: Date;
    created_at: Generated<Date>;
  };

  linkedin_accounts: {
    /** A bigint in Postgres, which pg returns as a string to avoid precision loss. */
    id: GeneratedAlways<string>;
    organization_id: string;
    label: string;
    unipile_account_id: string;
    connected_at: Generated<Date>;
    updated_at: Generated<Date>;
  };

  campaigns: {
    id: GeneratedAlways<string>;
    /** Points at `linkedin_accounts.id`, so also a bigint read as a string. */
    linkedin_account_id: string;
    name: string;
    /** The form's LinkedIn search fields; written as a JSON string like `criteria`. */
    search: JSONColumnType<PeopleSearch>;
    /**
     * Stored as jsonb. Reads come back as the parsed object; writes take a
     * JSON string, so the caller decides exactly what text is saved.
     */
    criteria: JSONColumnType<FullEvaluationCriteria>;
    /** Approved leads that complete the campaign; null runs until the search ends. */
    approved_target: number | null;
    /** Where the search continues next pass; null before the first page. */
    search_cursor: string | null;
    search_exhausted: Generated<boolean>;
    status: Generated<CampaignStatus>;
    /** While true, approved leads wait for a person to queue them before any invite. */
    require_invite_approval: Generated<boolean>;
    /** Optional budgets inside the account caps; null means only the account cap applies. */
    weekly_invite_limit: number | null;
    daily_profile_limit: number | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
  };

  leads: {
    id: GeneratedAlways<string>;
    /** Points at `campaigns.id`, so also a bigint read as a string. */
    campaign_id: string;
    linkedin_member_id: string;
    name: string;
    headline: string | null;
    location: string | null;
    industry: string | null;
    current_positions: JSONColumnType<LeadPosition[] | null, string | null, string | null>;
    premium: boolean | null;
    open_profile: boolean | null;
    stage: Generated<LeadStage>;
    fetch_attempts: Generated<number>;
    /** Who cleared the invite, when approval is required. */
    queued_by: string | null;
    queued_at: Date | null;
    invited_at: Date | null;
    accepted_at: Date | null;
    /** Empty until the lead is evaluated; written as a JSON string like `criteria`. */
    evaluation: JSONColumnType<ProfileModelEvaluation | null, string | null, string | null>;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
  };

  profiles: {
    /** The key itself, not generated: the same id as `leads.linkedin_member_id`. */
    linkedin_member_id: string;
    source: ProfileSource;
    /** The raw response; its shape depends on `source`, so it is mapped when read. */
    data: JSONColumnType<Record<string, unknown>>;
    fetched_at: Generated<Date>;
  };

  reviews: {
    id: GeneratedAlways<string>;
    lead_id: string;
    user_id: string;
    /** The AI's verdict when the person decided; null if it never judged the lead. */
    model_decision: string | null;
    model_score: number | null;
    decision: ReviewDecision;
    note: string | null;
    created_at: Generated<Date>;
  };

  agent_runs: {
    id: GeneratedAlways<string>;
    linkedin_account_id: string;
    trigger: AgentTrigger;
    status: Generated<'running' | 'done' | 'failed'>;
    error: string | null;
    prompt_tokens: Generated<number>;
    completion_tokens: Generated<number>;
    started_at: Generated<Date>;
    finished_at: Date | null;
  };

  agent_messages: {
    id: GeneratedAlways<string>;
    linkedin_account_id: string;
    run_id: string | null;
    role: 'user' | 'assistant' | 'tool';
    content: string | null;
    user_id: string | null;
    /** The model's tool-call list, written as a JSON string. */
    tool_calls: JSONColumnType<AgentToolCall[] | null, string | null, string | null>;
    tool_call_id: string | null;
    tool_name: string | null;
    created_at: Generated<Date>;
  };

  agent_notes: {
    id: GeneratedAlways<string>;
    linkedin_account_id: string;
    content: string;
    created_at: Generated<Date>;
  };

  actions: {
    id: GeneratedAlways<string>;
    linkedin_account_id: string;
    campaign_id: string;
    /** Empty for searches, which are not about one person. */
    lead_id: string | null;
    type: ActionType;
    created_at: Generated<Date>;
  };
}

/** What woke an agent run: the worker's schedule or a person's chat message. */
export type AgentTrigger = 'schedule' | 'chat';

/** One tool call as the model requests it, in OpenAI's chat format. */
export interface AgentToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** The values the SQL `CHECK` on `reviews.decision` allows. */
export type ReviewDecision = 'approved' | 'rejected';

/** The values the SQL `CHECK` on `actions.type` allows. */
export type ActionType = 'search' | 'profile_fetch' | 'invite';

/** The values the SQL `CHECK` on `profiles.source` allows. */
export type ProfileSource = 'unipile' | 'harvest';

/** The values the SQL `CHECK` on `campaigns.status` allows. */
export type CampaignStatus = 'active' | 'paused' | 'completed';

/** The funnel stages the SQL `CHECK` on `leads.stage` allows. */
export type LeadStage =
  | 'found'
  | 'profiled'
  | 'approved'
  | 'manual_review'
  | 'rejected'
  | 'queued'
  | 'invited'
  | 'accepted'
  | 'failed';

/** One current job as a search card lists it. */
export interface LeadPosition {
  company: string;
  role: string;
  location: string | null;
  description: string | null;
}
