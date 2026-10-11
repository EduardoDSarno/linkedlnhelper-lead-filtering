import type { Generated, GeneratedAlways, JSONColumnType } from 'kysely';

import type { FullEvaluationCriteria } from '../evaluation/criterias/user_criteria.js';
import type { ProfileModelEvaluation } from '../evaluation/index.js';

/**
 * Every table as TypeScript sees it, so Kysely can check column names and
 * value types before a query runs.
 *
 * It repeats the SQL migrations by hand: a column added in SQL must be added
 * here too, or TypeScript will not know it exists.
 */
export interface Database {
  linkedin_accounts: {
    /** A bigint in Postgres, which pg returns as a string to avoid precision loss. */
    id: GeneratedAlways<string>;
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
    search_url: string;
    /**
     * Stored as jsonb. Reads come back as the parsed object; writes take a
     * JSON string, so the caller decides exactly what text is saved.
     */
    criteria: JSONColumnType<FullEvaluationCriteria>;
    status: Generated<CampaignStatus>;
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
}

/** The values the SQL `CHECK` on `profiles.source` allows. */
export type ProfileSource = 'unipile' | 'harvest';

/** The values the SQL `CHECK` on `campaigns.status` allows. */
export type CampaignStatus = 'active' | 'paused';

/** The funnel stages the SQL `CHECK` on `leads.stage` allows. */
export type LeadStage = 'found' | 'profiled' | 'qualified' | 'rejected' | 'invited';

/** One current job as a search card lists it. */
export interface LeadPosition {
  company: string;
  role: string;
  location: string | null;
  description: string | null;
}
