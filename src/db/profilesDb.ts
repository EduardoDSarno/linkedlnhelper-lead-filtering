import { sql } from "kysely";
import type { Kysely } from "kysely";

import type { Database, ProfileSource } from "./schema.js";

/** A full profile exactly as a service returned it. */
export interface FetchedProfile {
  linkedinMemberId: string;
  source: ProfileSource;
  data: Record<string, unknown>;
}

/**
 * Save a fetched profile, replacing any older copy of the same person.
 *
 * Replacing resets `fetched_at`, which is what the refresh rule reads to
 * decide when a profile is old enough to fetch again.
 */
export async function saveProfile(
  db: Kysely<Database>,
  profile: FetchedProfile,
): Promise<void> {
  const data = JSON.stringify(profile.data);

  await db
    .insertInto("profiles")
    .values({
      linkedin_member_id: profile.linkedinMemberId,
      source: profile.source,
      data,
    })
    .onConflict((conflict) =>
      conflict.column("linkedin_member_id").doUpdateSet({
        source: profile.source,
        data,
        fetched_at: sql<Date>`now()`,
      }),
    )
    .execute();
}
