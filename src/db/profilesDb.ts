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

/** A stored profile fetched at or after `since`, or nothing when there is none that recent. */
export async function findFreshProfile(
  db: Kysely<Database>,
  linkedinMemberId: string,
  since: Date,
): Promise<FetchedProfile | undefined> {
  const row = await db
    .selectFrom("profiles")
    .select(["linkedin_member_id", "source", "data"])
    .where("linkedin_member_id", "=", linkedinMemberId)
    .where("fetched_at", ">=", since)
    .executeTakeFirst();
  return row ? { linkedinMemberId: row.linkedin_member_id, source: row.source, data: row.data } : undefined;
}

/** Stored profiles for several people at once, keyed by member id. */
export async function findProfiles(
  db: Kysely<Database>,
  linkedinMemberIds: readonly string[],
): Promise<Map<string, FetchedProfile>> {
  if (linkedinMemberIds.length === 0) return new Map();
  const rows = await db
    .selectFrom("profiles")
    .select(["linkedin_member_id", "source", "data"])
    .where("linkedin_member_id", "in", linkedinMemberIds)
    .execute();
  return new Map(
    rows.map((row) => [row.linkedin_member_id, { linkedinMemberId: row.linkedin_member_id, source: row.source, data: row.data }]),
  );
}
