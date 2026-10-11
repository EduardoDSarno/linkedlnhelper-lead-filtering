import type { Generated, GeneratedAlways, JSONColumnType } from 'kysely';

import type { FullEvaluationCriteria } from '../evaluation/criterias/user_criteria.js';

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
}

/** The values the SQL `CHECK` on `campaigns.status` allows. */
export type CampaignStatus = 'active' | 'paused';
