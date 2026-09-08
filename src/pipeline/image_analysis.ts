import {
  PIPELINE_PROGRESS_MESSAGE,
  type Logger,
} from '../logging/index.js';
import type { Profile } from '../profile/index.js';
import type { ProfileImageAnalysisOutcome } from './types.js';

export type {
  ImageAnalysisFailure,
  ImageTokenUsageTotal,
  ProfileImageAnalysisOutcome,
} from './types.js';

/** Zeroed usage, kept so the run summary always reports a complete set. */
const NO_IMAGE_TOKEN_USAGE = {
  promptTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
  totalTokens: 0,
} as const;

/**
 * Reports photo coverage and passes every profile through unchanged.
 *
 * Profile photos used to be assessed here by a separate vision call, whose
 * structured output was then handed to the evaluation model as text. The
 * evaluation request now carries the image itself, so assessing it here would
 * bill twice for the same picture and give the model a lossy summary instead
 * of the photo. What survives is the coverage count the run summary reports;
 * the bytes are loaded later, once the broad filter has decided which profiles
 * are worth evaluating at all.
 *
 * @param profiles - Normalized profiles, with or without photos.
 * @param logger - Structured logger for stage progress.
 * @returns Every profile plus the photo-coverage totals for the summary.
 */
export async function analyzeProfileImages(
  profiles: readonly Profile[],
  logger: Logger,
): Promise<ProfileImageAnalysisOutcome> {
  const profilesWithoutPhoto = profiles.filter(
    (profile) => !profile.photo,
  ).length;

  logger.info(
    { profiles: profiles.length, profilesWithoutPhoto },
    PIPELINE_PROGRESS_MESSAGE.imageSkipped,
  );

  return {
    fullProfiles: profiles.map((profile) => ({ ...profile })),
    profilesWithoutPhoto,
    successfulImageAnalyses: 0,
    failedImageAnalyses: 0,
    failures: [],
    tokenUsage: { ...NO_IMAGE_TOKEN_USAGE },
    analysisSkipped: true,
  };
}
