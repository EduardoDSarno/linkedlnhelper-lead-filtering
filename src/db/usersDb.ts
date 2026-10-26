import type { Kysely } from "kysely";

import type { Database } from "./schema.js";

/** A user as the login check needs it. */
export interface UserRow {
  id: string;
  organizationId: string;
  email: string;
  passwordHash: string;
}

/**
 * Save a new user and return its id.
 *
 * The email is saved in lowercase, so the same address typed with different
 * capitals is still one login. A second user with the same email is refused
 * by the table's `UNIQUE` rule.
 */
export async function createUser(
  db: Kysely<Database>,
  user: { organizationId: string; email: string; passwordHash: string },
): Promise<string> {
  const result = await db
    .insertInto("users")
    .values({
      organization_id: user.organizationId,
      email: normalizeEmail(user.email),
      password_hash: user.passwordHash,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return result.id;
}

/** Find the user who logs in with this email, or nothing when there is none. */
export async function findUserByEmail(
  db: Kysely<Database>,
  email: string,
): Promise<UserRow | undefined> {
  return db
    .selectFrom("users")
    .select([
      "id",
      "organization_id as organizationId",
      "email",
      "password_hash as passwordHash",
    ])
    .where("email", "=", normalizeEmail(email))
    .executeTakeFirst();
}

/**
 * Find a user by id, or nothing when there is none.
 *
 * Used once someone is already logged in (their session points at this id),
 * so it leaves the password hash out: nothing after login needs it.
 */
export async function findUserById(
  db: Kysely<Database>,
  id: string,
): Promise<Omit<UserRow, "passwordHash"> | undefined> {
  return db
    .selectFrom("users")
    .select(["id", "organization_id as organizationId", "email"])
    .where("id", "=", id)
    .executeTakeFirst();
}

/** Save a new organization and return its id. */
export async function createOrganization(
  db: Kysely<Database>,
  name: string,
): Promise<string> {
  const result = await db
    .insertInto("organizations")
    .values({ name })
    .returning("id")
    .executeTakeFirstOrThrow();

  return result.id;
}

/** The id of the organization with exactly this name, or nothing when there is none. */
export async function findOrganizationIdByName(
  db: Kysely<Database>,
  name: string,
): Promise<string | undefined> {
  const row = await db
    .selectFrom("organizations")
    .select("id")
    .where("name", "=", name)
    .executeTakeFirst();
  return row?.id;
}

/** The form an email is stored and searched in: no outer spaces, lowercase. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
