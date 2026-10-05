import type { DatabaseSync } from 'node:sqlite';

import type { StoredEvaluationRun } from '../database/types.js';
import type { ModelEvaluationOptions } from '../evaluation/index.js';
import type { FullProfile } from '../profile/index.js';

/** Profiles built from one CSV, and the rows that could not become one. */
export interface CsvProfileImport {
  profiles: FullProfile[];
  failures: Array<{ publicId: string; error: string }>;
}

/** Where imported profiles are saved, injectable so tests stay in memory. */
export interface ProfileStoreDependencies {
  openDatabase: () => DatabaseSync;
  /** Upserts by LinkedIn identity, restoring a returning person's stable ID. */
  insertProfile: (profile: FullProfile, db: DatabaseSync) => FullProfile;
}

/** Optional overrides for one review run. */
export interface ReviewPipelineOptions {
  modelEvaluation?: ModelEvaluationOptions;
}

/** Every external boundary the review pipeline touches. */
export interface ReviewPipelineDependencies extends ProfileStoreDependencies {
  insertEvaluationRun: (
    run: StoredEvaluationRun,
    db: DatabaseSync,
  ) => StoredEvaluationRun;
  createRunId: () => string;
  now: () => Date;
}

/** The evaluated profiles and the stored run that scored them. */
export interface ReviewPipelineResult {
  profiles: FullProfile[];
  evaluationRun: StoredEvaluationRun;
}
