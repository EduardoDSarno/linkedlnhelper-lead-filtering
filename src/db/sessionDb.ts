import { sql } from "kysely";
import type { Kysely } from "kysely";

import type { Database } from "./schema.js";

/** What is saved when someone logs in. */
export interface NewSession {
  userId: string;
  /** The hash of the cookie's token; this file never sees the token itself. */
  tokenHash: string;
  expiresAt: Date;
  /** Where the login came from, when the request tells us. */
  ip?: string;
  userAgent?: string;
}

/** A valid session as a request needs it: whose it is and until when. */
export interface SessionRow {
  id: string;
  userId: string;
  expiresAt: Date;
}

/** Save a new session and return its id. */
export async function insertSession(
  db: Kysely<Database>,
  session: NewSession,
): Promise<string> {
  const result = await db
    .insertInto("sessions")
    .values({
      user_id: session.userId,
      token_hash: session.tokenHash,
      expires_at: session.expiresAt,
      ip: session.ip ?? null,
      user_agent: session.userAgent ?? null,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return result.id;
}

/**
 * Find the session with this token hash, or nothing when there is none or it
 * has expired.
 *
 * The expiry is checked by Postgres's own clock, the same one that stamped
 * `created_at`, so the server's clock can't disagree with it.
 */
export async function findSessionByTokenHash(
  db: Kysely<Database>,
  tokenHash: string,
): Promise<SessionRow | undefined> {
  return db
    .selectFrom("sessions")
    .select(["id", "user_id as userId", "expires_at as expiresAt"])
    .where("token_hash", "=", tokenHash)
    .where("expires_at", ">", sql<Date>`now()`)
    .executeTakeFirst();
}

/** Delete the session with this token hash, which is what logging out does. */
export async function deleteSessionByTokenHash(
  db: Kysely<Database>,
  tokenHash: string,
): Promise<void> {
  await db.deleteFrom("sessions").where("token_hash", "=", tokenHash).execute();
}
