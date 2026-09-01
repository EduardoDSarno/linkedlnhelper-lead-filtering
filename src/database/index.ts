import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { linkedinProfileKey } from '../linkedin/index.js';
import type { FullProfile } from '../profile/index.js';
import { PROCESSING_STATUS } from './types.js';
import type {
  ManualOverride,
  ProcessingRun,
  StoredEvaluationRun,
} from './types.js';

export { MANUAL_DECISION, PROCESSING_STATUS } from './types.js';
export type {
  ManualDecision,
  ManualOverride,
  ProcessingRun,
  ProcessingStatus,
  StoredEvaluationRun,
} from './types.js';

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
const PROCESSING_RUN_TABLE_NAME = 'processing_runs';

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

    CREATE TABLE IF NOT EXISTS ${PROCESSING_RUN_TABLE_NAME} (
      id TEXT PRIMARY KEY NOT NULL,
      status TEXT NOT NULL,
      name TEXT,
      original_csv_path TEXT NOT NULL,
      approved_csv_path TEXT,
      evaluation_report_path TEXT,
      evaluation_run_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      manual_overrides_json TEXT CHECK (
        manual_overrides_json IS NULL OR json_valid(manual_overrides_json)
      )
    );
  `);

  addColumnIfMissing(db, 'manual_overrides_json', "TEXT CHECK (manual_overrides_json IS NULL OR json_valid(manual_overrides_json))");
  addColumnIfMissing(db, 'name', 'TEXT');
}

/**
 * Adds one column to the processing-runs table when an older database predates
 * it. CREATE TABLE IF NOT EXISTS never alters an existing table, so each added
 * column needs this one-time migration.
 */
function addColumnIfMissing(
  db: DatabaseSync,
  column: string,
  definition: string,
): void {
  const columns = db
    .prepare(`SELECT name FROM pragma_table_info('${PROCESSING_RUN_TABLE_NAME}')`)
    .all() as Array<{ name: string }>;

  if (!columns.some((existing) => existing.name === column)) {
    db.exec(
      `ALTER TABLE ${PROCESSING_RUN_TABLE_NAME} ADD COLUMN ${column} ${definition}`,
    );
  }
}

/** Converts one database row into the application processing-run shape. */
function processingRunFromRow(row: {
  id: string;
  status: string;
  name: string | null;
  original_csv_path: string;
  approved_csv_path: string | null;
  evaluation_report_path: string | null;
  evaluation_run_id: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  manual_overrides_json: string | null;
}): ProcessingRun {
  return {
    id: row.id,
    status: row.status as ProcessingRun['status'],
    originalCsvPath: row.original_csv_path,
    createdAt: row.created_at,
    ...(row.name ? { name: row.name } : {}),
    ...(row.approved_csv_path ? { approvedCsvPath: row.approved_csv_path } : {}),
    ...(row.evaluation_report_path
      ? { evaluationReportPath: row.evaluation_report_path }
      : {}),
    ...(row.evaluation_run_id
      ? { evaluationRunId: row.evaluation_run_id }
      : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.manual_overrides_json
      ? {
          manualOverrides: JSON.parse(
            row.manual_overrides_json,
          ) as readonly ManualOverride[],
        }
      : {}),
  };
}

/**
 * Inserts one processing run, or refreshes the existing row with the same id.
 *
 * The API inserts the row at import time and the pipeline registers the same
 * id again when it starts (and on a retry after failure), so the conflict
 * branch updates the mutable columns while keeping the original creation time.
 */
export function dbInsertProcessingRun(
  run: ProcessingRun,
  db: DatabaseSync,
): ProcessingRun {
  db.prepare(`
    INSERT INTO ${PROCESSING_RUN_TABLE_NAME} (
      id,
      status,
      name,
      original_csv_path,
      approved_csv_path,
      evaluation_report_path,
      evaluation_run_id,
      error,
      created_at,
      completed_at,
      manual_overrides_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      name = coalesce(excluded.name, ${PROCESSING_RUN_TABLE_NAME}.name),
      original_csv_path = excluded.original_csv_path,
      approved_csv_path = excluded.approved_csv_path,
      evaluation_report_path = excluded.evaluation_report_path,
      evaluation_run_id = excluded.evaluation_run_id,
      error = excluded.error,
      completed_at = excluded.completed_at,
      manual_overrides_json = excluded.manual_overrides_json
  `).run(
    run.id,
    run.status,
    run.name ?? null,
    run.originalCsvPath,
    run.approvedCsvPath ?? null,
    run.evaluationReportPath ?? null,
    run.evaluationRunId ?? null,
    run.error ?? null,
    run.createdAt,
    run.completedAt ?? null,
    run.manualOverrides ? JSON.stringify(run.manualOverrides) : null,
  );

  return run;
}

/**
 * Replaces one processing run's mutable columns after a status change.
 *
 * The full record is rewritten so a completed run records its artifact paths
 * and a failed run records its error in a single call.
 */
export function dbUpdateProcessingRun(
  run: ProcessingRun,
  db: DatabaseSync,
): ProcessingRun {
  db.prepare(`
    UPDATE ${PROCESSING_RUN_TABLE_NAME}
    SET
      status = ?,
      name = coalesce(?, name),
      original_csv_path = ?,
      approved_csv_path = ?,
      evaluation_report_path = ?,
      evaluation_run_id = ?,
      error = ?,
      completed_at = ?,
      manual_overrides_json = ?
    WHERE id = ?
  `).run(
    run.status,
    run.name ?? null,
    run.originalCsvPath,
    run.approvedCsvPath ?? null,
    run.evaluationReportPath ?? null,
    run.evaluationRunId ?? null,
    run.error ?? null,
    run.completedAt ?? null,
    run.manualOverrides ? JSON.stringify(run.manualOverrides) : null,
    run.id,
  );

  return run;
}

/** Retrieves one processing run by its application-owned ID. */
export function dbGetProcessingRunById(
  id: string,
  db: DatabaseSync,
): ProcessingRun | undefined {
  const row = db
    .prepare(`
      SELECT
        id,
        status,
        name,
        original_csv_path,
        approved_csv_path,
        evaluation_report_path,
        evaluation_run_id,
        error,
        created_at,
        completed_at,
        manual_overrides_json
      FROM ${PROCESSING_RUN_TABLE_NAME}
      WHERE id = ?
    `)
    .get(id) as
    | Parameters<typeof processingRunFromRow>[0]
    | undefined;

  return row ? processingRunFromRow(row) : undefined;
}

/** Lists every processing run, newest first. */
export function dbListProcessingRuns(db: DatabaseSync): ProcessingRun[] {
  const rows = db
    .prepare(`
      SELECT
        id,
        status,
        name,
        original_csv_path,
        approved_csv_path,
        evaluation_report_path,
        evaluation_run_id,
        error,
        created_at,
        completed_at,
        manual_overrides_json
      FROM ${PROCESSING_RUN_TABLE_NAME}
      ORDER BY created_at DESC, rowid DESC
    `)
    .all() as Array<Parameters<typeof processingRunFromRow>[0]>;

  return rows.map(processingRunFromRow);
}

/**
 * Deletes one processing run by id.
 *
 * Returns true when a row was removed. The caller deletes the run's files
 * separately, since the database does not own the filesystem.
 */
export function dbDeleteProcessingRun(id: string, db: DatabaseSync): boolean {
  const result = db
    .prepare(`DELETE FROM ${PROCESSING_RUN_TABLE_NAME} WHERE id = ?`)
    .run(id);

  return result.changes > 0;
}

/**
 * Marks every run still recorded as running as failed.
 *
 * Only one process executes pipelines, so a running row observed at process
 * startup belongs to a run the previous process never finished. The original
 * CSV is kept on failure, so these runs stay retryable.
 */
export function dbFailInterruptedRuns(db: DatabaseSync): number {
  const result = db
    .prepare(`
      UPDATE ${PROCESSING_RUN_TABLE_NAME}
      SET
        status = ?,
        error = 'Interrupted by an application restart',
        completed_at = ?
      WHERE status = ?
    `)
    .run(
      PROCESSING_STATUS.failed,
      new Date().toISOString(),
      PROCESSING_STATUS.running,
    );

  return Number(result.changes);
}

/** Lists finished (completed or failed) runs whose completion is older than the cutoff. */
export function dbListFinishedRunsBefore(
  cutoffIso: string,
  db: DatabaseSync,
): ProcessingRun[] {
  const rows = db
    .prepare(`
      SELECT
        id,
        status,
        name,
        original_csv_path,
        approved_csv_path,
        evaluation_report_path,
        evaluation_run_id,
        error,
        created_at,
        completed_at,
        manual_overrides_json
      FROM ${PROCESSING_RUN_TABLE_NAME}
      WHERE status IN (?, ?)
        AND completed_at IS NOT NULL
        AND completed_at < ?
    `)
    .all(
      PROCESSING_STATUS.completed,
      PROCESSING_STATUS.failed,
      cutoffIso,
    ) as Array<Parameters<typeof processingRunFromRow>[0]>;

  return rows.map(processingRunFromRow);
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
