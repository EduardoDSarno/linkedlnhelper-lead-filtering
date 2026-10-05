import { randomUUID } from 'node:crypto';

import {
  dbInsertEvaluationRun,
  dbInsertProfile,
  openDatabase,
} from '../database/index.js';
import {
  CONFIG_NUMBER_MINIMUMS,
  resolveConfigNumber,
} from '../helpers/index.js';
import type { ReviewPipelineDependencies } from './types.js';

/** Environment variables understood by the review pipeline. */
export const PIPELINE_ENVIRONMENT_KEYS = {
  maximumProfiles: 'MAX_PIPELINE_PROFILES',
} as const;

/** Default upper bound for profiles accepted by one pipeline run. */
export const MAX_PIPELINE_PROFILES = 1_000;

/**
 * Resolves the per-run profile ceiling, allowing an environment override.
 *
 * The override lets an operator adjust the ceiling without changing code. An
 * unusable value falls back to {@link MAX_PIPELINE_PROFILES}.
 */
export function maxPipelineProfilesFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  return resolveConfigNumber(
    environment[PIPELINE_ENVIRONMENT_KEYS.maximumProfiles],
    {
      fallback: MAX_PIPELINE_PROFILES,
      minimum: CONFIG_NUMBER_MINIMUMS.positive,
      integer: true,
    },
  );
}

/** Returns the current wall-clock time through the production clock boundary. */
function currentPipelineTime(): Date {
  return new Date();
}

/** Creates an application-owned identity for one persisted evaluation run. */
function createReviewRunId(): string {
  return randomUUID();
}

/** Production boundaries used by the complete CSV-to-evaluation workflow. */
export const DEFAULT_REVIEW_PIPELINE_DEPENDENCIES: ReviewPipelineDependencies = {
  openDatabase,
  insertProfile: dbInsertProfile,
  insertEvaluationRun: dbInsertEvaluationRun,
  createRunId: createReviewRunId,
  now: currentPipelineTime,
};
