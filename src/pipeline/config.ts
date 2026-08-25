import { collectApifyProfiles } from '../data/apify_profile_collector/index.js';
import { dbInsertProfile, openDatabase } from '../database/index.js';
import {
  CONFIG_NUMBER_MINIMUMS,
  resolveConfigNumber,
  writeJsonAtomically,
} from '../helpers/index.js';
import { extractProfileImages } from '../image_extractor/index.js';

/** Environment variables understood by the full-profile pipeline. */
export const PIPELINE_ENVIRONMENT_KEYS = {
  maximumProfiles: 'MAX_PIPELINE_PROFILES',
  imageConcurrency: 'IMAGE_ANALYSIS_CONCURRENCY',
  imageResolution: 'IMAGE_ANALYSIS_RESOLUTION',
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

/** Default artifact destinations for a completed pipeline run. */
export const DEFAULT_PIPELINE_OUTPUT_PATHS = {
  rawApifyProfiles: 'output/apify-profiles.json',
  apifyProfileFailures: 'output/apify-profile-failures.json',
  fullProfiles: 'output/full-profiles.json',
  summary: 'output/pipeline-summary.json',
} as const;

/** Production image analyzer used when the pipeline caller injects nothing. */
export const DEFAULT_PROFILE_IMAGE_ANALYZER = extractProfileImages;

/** Returns the current wall-clock time through the production clock boundary. */
function currentPipelineTime(): Date {
  return new Date();
}

/** Production implementations for every external boundary used by the pipeline. */
export const DEFAULT_PIPELINE_DEPENDENCIES = {
  collectProfiles: collectApifyProfiles,
  extractImages: DEFAULT_PROFILE_IMAGE_ANALYZER,
  writeJson: writeJsonAtomically,
  openDatabase,
  insertProfile: dbInsertProfile,
  now: currentPipelineTime,
};
