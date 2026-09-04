/** Pipeline stages that emit live N-of-total progress in the terminal. */
export const PIPELINE_STAGE = {
  apify: 'apify',
  images: 'images',
  eval: 'eval',
} as const;

/** Evaluation pass labels so a retry round is not mistaken for the first pass. */
export const EVALUATION_PASS = {
  primary: 'primary',
  retry: 'retry',
} as const;

/**
 * Stable log messages for stage progress and fail-now diagnostics.
 *
 * Keep these exact strings: tests and operators grep them. Existing start and
 * complete lines stay unchanged so older log searches still match.
 */
export const PIPELINE_PROGRESS_MESSAGE = {
  apifyStarted: 'Starting Apify collection.',
  apifyBatchStarted: 'Starting Apify collection batch.',
  apifyBatchCompleted: 'Completed Apify collection batch.',
  apifyBatchFailed: 'Apify collection batch failed.',
  apifyRoundProgress: 'Apify collection progress.',
  apifyProfileFailed: 'Apify profile collection failed.',
  imageStarted: 'Starting profile image analysis.',
  imageSkipped: 'Skipped profile image analysis by campaign criteria.',
  imageCompleted: 'Completed profile image analysis.',
  imageJobProgress: 'Profile image analysis progress.',
  imageJobFailed: 'Profile image analysis failed.',
  evalStarted: 'Starting model evaluation.',
  evalRetryStarted: 'Starting model evaluation retry pass.',
  evalGroupStarted: 'Starting model evaluation group.',
  evalGroupCompleted: 'Completed model evaluation group.',
  evalGroupFailed: 'Model evaluation group failed.',
  evalProfileFailed: 'Model evaluation profile failed.',
} as const;

export type PipelineStage =
  (typeof PIPELINE_STAGE)[keyof typeof PIPELINE_STAGE];

export type EvaluationPass =
  (typeof EVALUATION_PASS)[keyof typeof EVALUATION_PASS];

/**
 * Converts a 0-based index into the 1-based position operators read in logs.
 *
 * Progress lines talk about "profile 3 of 600", not array index 2.
 */
export function displayIndex(zeroBasedIndex: number): number {
  return zeroBasedIndex + 1;
}

/**
 * Inclusive 1-based range covering `count` items that start at `startIndex`.
 *
 * Used for eval groups so a concurrent worker can say it is scoring people
 * 11–15 of the current pass without listing every ID on the start line.
 */
export function displayRange(
  startIndex: number,
  count: number,
): { profileStart: number; profileEnd: number } {
  if (count <= 0) {
    return { profileStart: 0, profileEnd: 0 };
  }

  return {
    profileStart: displayIndex(startIndex),
    profileEnd: startIndex + count,
  };
}

/**
 * Milliseconds since `startedAt`, for complete/fail logs of one structural unit.
 *
 * Callers pass `Date.now()` captured before the batch, image, or eval group.
 */
export function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}
