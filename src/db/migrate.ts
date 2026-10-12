import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sql } from "kysely";
import type { Kysely } from "kysely";

import { connectToDb } from "./client.js";
import type { Database } from "./schema.js";

/** Folder holding the numbered SQL files, applied in file-name order. */
const SQL_DIRECTORY = fileURLToPath(new URL("./sql/", import.meta.url));

/** Command-line flag that records every file as applied without running it. */
const BASELINE_FLAG = "--baseline";

/**
 * Apply every SQL file that this database has not run yet, oldest first.
 *
 * Applied file names are kept in `schema_migrations`, so a fresh database gets
 * every table in one command and an existing one only gets what is new. Each
 * file runs in a transaction with its record, so a file that fails leaves
 * nothing half-applied and is retried on the next run.
 *
 * @param baseline Records the files without running them, for a database whose
 * tables were created by hand before this runner existed.
 * @returns the names of the files applied (or recorded) by this call
 */
export async function migrate(
  db: Kysely<Database>,
  baseline = false,
): Promise<string[]> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations(
      name        text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`.execute(db);

  const applied = await appliedFileNames(db);
  const pending = (await sqlFileNames()).filter((name) => !applied.has(name));

  for (const name of pending) {
    const text = await readFile(join(SQL_DIRECTORY, name), "utf8");
    await db.transaction().execute(async (transaction) => {
      if (!baseline) await sql.raw(text).execute(transaction);
      await sql`INSERT INTO schema_migrations (name) VALUES (${name})`.execute(transaction);
    });
  }

  return pending;
}

/** Run from the command line: `npm run db:migrate` (add `-- --baseline` once for a hand-made database). */
async function main(): Promise<void> {
  const db = await connectToDb();
  try {
    const applied = await migrate(db, process.argv.includes(BASELINE_FLAG));
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
  } finally {
    await db.destroy();
  }
}

/** The names already recorded as applied. */
async function appliedFileNames(db: Kysely<Database>): Promise<Set<string>> {
  const result = await sql<{ name: string }>`SELECT name FROM schema_migrations`.execute(db);
  return new Set(result.rows.map((row) => row.name));
}

/** Every SQL file in the folder, sorted so their number prefixes set the order. */
async function sqlFileNames(): Promise<string[]> {
  const names = await readdir(SQL_DIRECTORY);
  return names.filter((name) => name.endsWith(".sql")).sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
