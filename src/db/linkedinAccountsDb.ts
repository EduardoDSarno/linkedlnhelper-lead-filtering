import { sql } from "kysely";
import type { Kysely } from "kysely";

import type { Database } from "./schema.js";

/** Save an account, updating its label if it already exists. */
export async function insertLinkedinAccount(
  db: Kysely<Database>,
  account: { label: string; unipileId: string },
): Promise<string> {
  const result = await db
    .insertInto("linkedin_accounts")
    .values({
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