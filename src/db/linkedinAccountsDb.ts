import { sql } from "kysely";
import type { Kysely, Selectable } from "kysely";

import type { Database } from "./schema.js";

/** An account as the app shows it. */
export type LinkedinAccount = Selectable<Database["linkedin_accounts"]>;

/** Save an account, updating its label if it already exists.
 * @returns the id back
*/
export async function insertLinkedinAccount(
  db: Kysely<Database>,
  account: { organizationId: string; label: string; unipileId: string },
): Promise<string> {
  const result = await db
    .insertInto("linkedin_accounts")
    .values({
      organization_id: account.organizationId,
      label: account.label,
      unipile_account_id: account.unipileId,
    })
    .onConflict((conflict) =>
      conflict.column("unipile_account_id").doUpdateSet({
        label: account.label,
        updated_at: sql<Date>`now()`,
      }),
    )
    .returning("id")
    .executeTakeFirstOrThrow();

  return result.id;
}

/** Every LinkedIn account an organization has connected, newest first. */
export async function listLinkedinAccounts(
  db: Kysely<Database>,
  organizationId: string,
): Promise<LinkedinAccount[]> {
  return db
    .selectFrom("linkedin_accounts")
    .selectAll()
    .where("organization_id", "=", organizationId)
    .orderBy("connected_at", "desc")
    .execute();
}

/** One account, only if it belongs to the organization asking for it. */
export async function findLinkedinAccount(
  db: Kysely<Database>,
  organizationId: string,
  accountId: string,
): Promise<LinkedinAccount | undefined> {
  return db
    .selectFrom("linkedin_accounts")
    .selectAll()
    .where("organization_id", "=", organizationId)
    .where("id", "=", accountId)
    .executeTakeFirst();
}
