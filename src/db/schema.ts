import type { Generated, GeneratedAlways } from 'kysely';

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
}
