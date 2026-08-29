import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { linkedinProfileKey } from '../linkedin/index.js';
import type { FullProfile } from '../profile/index.js';
import type { StoredEvaluationRun } from './types.js';

export type { StoredEvaluationRun } from './types.js';

const DEFAULT_DATABASE_PATH = 'src/dataStorage/db/application.sqlite';
const DATABASE_PATH_ENVIRONMENT_KEY = 'DATABASE_PATH';

/**
 * Resolves the SQLite file location, allowing an environment override.
 *
 * The path differs legitimately between a laptop, a server, and a test, so it
 * is configuration rather than code. A blank value means absent.
 */
export function defaultDatabasePath(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return (
    environment[DATABASE_PATH_ENVIRONMENT_KEY]?.trim() || DEFAULT_DATABASE_PATH
  );
}
const PROFILE_TABLE_NAME = 'profiles';
const EVALUATION_RUN_TABLE_NAME = 'evaluation_runs';

/** Creates the tables required by the current MVP. */
export function initializeDatabase(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${PROFILE_TABLE_NAME} (
      id TEXT PRIMARY KEY NOT NULL,
      linkedin_key TEXT NOT NULL UNIQUE,
      linkedin_url TEXT NOT NULL,
      profile_json TEXT NOT NULL CHECK (json_valid(profile_json)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ${EVALUATION_RUN_TABLE_NAME} (
      id TEXT PRIMARY KEY NOT NULL,
      criteria_json TEXT NOT NULL CHECK (json_valid(criteria_json)),
      evaluation_json TEXT NOT NULL CHECK (json_valid(evaluation_json)),
      created_at TEXT NOT NULL
    );
  `);
}

/** Opens a SQLite file and ensures the MVP schema exists before returning it. */
export function openDatabase(
  path: string = defaultDatabasePath(),
): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path);
  initializeDatabase(db);
  return db;
}

/**
 * Inserts a new profile or updates the profile with the same LinkedIn identity
 * while preserving its original application ID.
 */
export function dbInsertProfile(
  profile: FullProfile,
  db: DatabaseSync,
): FullProfile {
  const linkedinKey = linkedinProfileKey(profile.linkedinUrl);

  if (!linkedinKey) {
    throw new Error(
      `Cannot save a profile with an invalid LinkedIn URL: ${profile.linkedinUrl}`,
    );
  }

  const existingProfile = db
    .prepare(`
      SELECT id
      FROM ${PROFILE_TABLE_NAME}
      WHERE linkedin_key = ?
    `)
    .get(linkedinKey) as { id: string } | undefined;

  const profileToStore: FullProfile = existingProfile
    ? { ...profile, id: existingProfile.id }
    : profile;

  db.prepare(`
    INSERT INTO ${PROFILE_TABLE_NAME} (
      id,
      linkedin_key,
      linkedin_url,
      profile_json
    )
    VALUES (?, ?, ?, ?)
    ON CONFLICT(linkedin_key) DO UPDATE SET
      linkedin_url = excluded.linkedin_url,
      profile_json = excluded.profile_json,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    profileToStore.id,
    linkedinKey,
    profileToStore.linkedinUrl,
    JSON.stringify(profileToStore),
  );

  return profileToStore;
}

/** Retrieves one stored profile by its application-owned ID. */
export function dbGetProfileById(
  id: string,
  db: DatabaseSync,
): FullProfile | undefined {
  const row = db
    .prepare(`
      SELECT profile_json
      FROM ${PROFILE_TABLE_NAME}
      WHERE id = ?
    `)
    .get(id) as { profile_json: string } | undefined;

  return row ? (JSON.parse(row.profile_json) as FullProfile) : undefined;
}

/** Lists every stored profile in its original insertion order. */
export function dbListProfiles(db: DatabaseSync): FullProfile[] {
  const rows = db
    .prepare(`
      SELECT profile_json
      FROM ${PROFILE_TABLE_NAME}
      ORDER BY rowid ASC
    `)
    .all() as Array<{ profile_json: string }>;

  return rows.map(
    ({ profile_json }) => JSON.parse(profile_json) as FullProfile,
  );
}

/**
 * Deletes one profile by its application-owned ID.
 *
 * Returns `true` when a row was deleted and `false` when it was already absent.
 */
export function dbDeleteProfile(
  profile: Pick<FullProfile, 'id'>,
  db: DatabaseSync,
): boolean {
  const result = db
    .prepare(`
      DELETE FROM ${PROFILE_TABLE_NAME}
      WHERE id = ?
    `)
    .run(profile.id);

  return result.changes > 0;
}

/** Stores one completed evaluation batch without duplicating full profiles. */
export function dbInsertEvaluationRun(
  run: StoredEvaluationRun,
  db: DatabaseSync,
): StoredEvaluationRun {
  db.prepare(`
    INSERT INTO ${EVALUATION_RUN_TABLE_NAME} (
      id,
      criteria_json,
      evaluation_json,
      created_at
    )
    VALUES (?, ?, ?, ?)
  `).run(
    run.id,
    JSON.stringify(run.criteria),
    JSON.stringify(run.evaluation),
    run.createdAt,
  );

  return run;
}

/** Converts one database row into the application evaluation-run shape. */
function evaluationRunFromRow(row: {
  id: string;
  criteria_json: string;
  evaluation_json: string;
  created_at: string;
}): StoredEvaluationRun {
  return {
    id: row.id,
    createdAt: row.created_at,
    criteria: JSON.parse(row.criteria_json) as StoredEvaluationRun['criteria'],
    evaluation: JSON.parse(
      row.evaluation_json,
    ) as StoredEvaluationRun['evaluation'],
  };
}

/** Retrieves one stored evaluation run by its application-owned ID. */
export function dbGetEvaluationRunById(
  id: string,
  db: DatabaseSync,
): StoredEvaluationRun | undefined {
  const row = db
    .prepare(`
      SELECT id, criteria_json, evaluation_json, created_at
      FROM ${EVALUATION_RUN_TABLE_NAME}
      WHERE id = ?
    `)
    .get(id) as
    | {
        id: string;
        criteria_json: string;
        evaluation_json: string;
        created_at: string;
      }
    | undefined;

  return row ? evaluationRunFromRow(row) : undefined;
}

/** Lists stored evaluation runs from newest creation time to oldest. */
export function dbListEvaluationRuns(db: DatabaseSync): StoredEvaluationRun[] {
  const rows = db
    .prepare(`
      SELECT id, criteria_json, evaluation_json, created_at
      FROM ${EVALUATION_RUN_TABLE_NAME}
      ORDER BY created_at DESC, rowid DESC
    `)
    .all() as Array<{
    id: string;
    criteria_json: string;
    evaluation_json: string;
    created_at: string;
  }>;

  return rows.map(evaluationRunFromRow);
}
