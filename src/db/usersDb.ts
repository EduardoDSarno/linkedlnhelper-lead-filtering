import type { Kysely } from "kysely";

import type { Database } from "./schema.js";

/** Who is logged in, as every authenticated route sees them. */
export interface SessionUser {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
}

/**
 * Create a user in an organization, creating the organization the first time
 * its name is used.
 *
 * @returns the new user's id
 */
export async function createUser(
  db: Kysely<Database>,
  user: { organizationName: string; email: string; passwordHash: string },
): Promise<string> {
  return db.transaction().execute(async (transaction) => {
    const organization = await transaction
      .insertInto("organizations")
      .values({ name: user.organizationName })
      .onConflict((conflict) =>
        conflict.column("name").doUpdateSet({ name: user.organizationName }),
      )
      .returning("id")
      .executeTakeFirstOrThrow();

    const created = await transaction
      .insertInto("users")
      .values({
        organization_id: organization.id,
        email: user.email.toLowerCase(),
        password_hash: user.passwordHash,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return created.id;
  });
}

/** The stored hash for an email, for checking a login attempt. */
export async function findUserForLogin(
  db: Kysely<Database>,
  email: string,
): Promise<{ id: string; passwordHash: string } | undefined> {
  const row = await db
    .selectFrom("users")
    .select(["id", "password_hash"])
    .where("email", "=", email.toLowerCase())
    .executeTakeFirst();
  return row ? { id: row.id, passwordHash: row.password_hash } : undefined;
}

/** Remember a new login until it expires. */
export async function insertSession(
  db: Kysely<Database>,
  session: { tokenHash: string; userId: string; expiresAt: Date },
): Promise<void> {
  await db
    .insertInto("sessions")
    .values({
      token_hash: session.tokenHash,
      user_id: session.userId,
      expires_at: session.expiresAt,
    })
    .execute();
}

/** The user behind a session that has not expired, or nothing. */
export async function findSessionUser(
  db: Kysely<Database>,
  tokenHash: string,
  now: Date = new Date(),
): Promise<SessionUser | undefined> {
  return db
    .selectFrom("sessions")
    .innerJoin("users", "users.id", "sessions.user_id")
    .innerJoin("organizations", "organizations.id", "users.organization_id")
    .select([
      "users.id as id",
      "users.organization_id as organizationId",
      "organizations.name as organizationName",
      "users.email as email",
    ])
    .where("sessions.token_hash", "=", tokenHash)
    .where("sessions.expires_at", ">", now)
    .executeTakeFirst();
}

/** End a login. */
export async function deleteSession(db: Kysely<Database>, tokenHash: string): Promise<void> {
  await db.deleteFrom("sessions").where("token_hash", "=", tokenHash).execute();
}
