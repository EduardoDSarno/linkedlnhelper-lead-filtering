import {
  extractProfileImages,
  resolveProfileImageBatchConcurrency,
} from '../image_extractor/index.js';
import type {
  GeminiTokenUsage,
  ProfileImageBatchOptions,
  ProfileImageJob,
  ProfileImageJobResult,
} from '../image_extractor/index.js';
import type { Logger } from '../logging/index.js';
import { attachProfileImageAnalysis } from '../profile/index.js';
import type { FullProfile, Profile } from '../profile/index.js';

const IMAGE_CONCURRENCY_ENVIRONMENT_KEY = 'IMAGE_ANALYSIS_CONCURRENCY';
const IMAGE_ANALYSIS_RESOLUTION = 'medium';

/** Tokens billed across a whole run, with every count present. */
export type ImageTokenUsageTotal = Required<GeminiTokenUsage>;

/** One profile photo the analyzer returned an error for. */
export interface ImageAnalysisFailure {
  profileId: string;
  error: string;

  /** Tokens Gemini billed before rejecting this image, when it reported any. */
  usage?: GeminiTokenUsage;
}

/**
 * The image analyzer the pipeline depends on.
 *
 * Production supplies {@link extractProfileImages}; a test supplies a stand-in
 * so a run makes no paid Gemini request.
 */
export type ProfileImageAnalyzer = (
  jobs: readonly ProfileImageJob[],
  options: ProfileImageBatchOptions,
) => Promise<ProfileImageJobResult[]>;

/** The production analyzer, used when a caller injects nothing. */
export const DEFAULT_PROFILE_IMAGE_ANALYZER: ProfileImageAnalyzer =
  extractProfileImages;

/** Everything one image-analysis stage produces for the run summary. */
export interface ProfileImageAnalysisOutcome {
  /** Every supplied profile, with an assessment attached where one succeeded. */
  fullProfiles: FullProfile[];

  profilesWithoutPhoto: number;
  successfulImageAnalyses: number;
  failedImageAnalyses: number;
  failures: ImageAnalysisFailure[];
  tokenUsage: ImageTokenUsageTotal;
}

/**
 * Adds up the tokens every image job reported, billed or wasted.
 *
 * Both branches of {@link ProfileImageJobResult} can carry usage: a fulfilled
 * job through its result, a rejected one when Gemini answered and then
 * declined. Missing counts are treated as zero rather than skipped, so the
 * total is always a complete set of numbers.
 */
export function totalImageTokenUsage(
  results: readonly ProfileImageJobResult[],
): ImageTokenUsageTotal {
  const total: ImageTokenUsageTotal = {
    promptTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
  };

  for (const result of results) {
    const usage =
      result.status === 'fulfilled' ? result.result.usage : result.usage;
    if (!usage) continue;

    total.promptTokens += usage.promptTokens ?? 0;
    total.outputTokens += usage.outputTokens ?? 0;
    total.thinkingTokens += usage.thinkingTokens ?? 0;
    total.totalTokens += usage.totalTokens ?? 0;
  }

  return total;
}

/** Resolves the environment override through the image module's shared limits. */
export function imageConcurrencyFromEnvironment(): number {
  return resolveProfileImageBatchConcurrency(
    process.env[IMAGE_CONCURRENCY_ENVIRONMENT_KEY],
  );
}

/** Joins successful image assessments to profiles by application-owned ID. */
export function attachSuccessfulImageAnalyses(
  profiles: readonly Profile[],
  imageResults: readonly ProfileImageJobResult[],
): FullProfile[] {
  // Index only successful Gemini results by our application-owned profile ID.
  // Rejected jobs remain visible in the pipeline summary instead.
  const successfulResults = new Map(
    imageResults
      .filter((result) => result.status === 'fulfilled')
      .map((result) => [result.id, result.result] as const),
  );

  // Preserve every normalized profile. Profiles without a usable image result
  // simply omit the optional `imageAnalysis` property.
  return profiles.map((profile) => {
    const imageAnalysis = successfulResults.get(profile.id);
    return imageAnalysis
      ? attachProfileImageAnalysis(profile, imageAnalysis)
      : profile;
  });
}

/**
 * Analyzes the photos of every profile that has one, then joins the successful
 * assessments back onto the profiles.
 *
 * Only profiles carrying a photo URL create a job, so a missing photo costs
 * nothing. A rejected job never removes its profile from the output: the
 * profile continues without an assessment and the failure is reported instead.
 *
 * @param profiles - Normalized profiles, with or without photos.
 * @param analyze - Injected batch analyzer.
 * @param logger - Structured logger for stage progress and failures.
 * @param concurrencyOverride - Explicit limit; the environment is read when
 * this is omitted.
 * @returns Full profiles plus the totals the run summary reports.
 */
export async function analyzeProfileImages(
  profiles: readonly Profile[],
  analyze: ProfileImageAnalyzer,
  logger: Logger,
  concurrencyOverride?: number,
): Promise<ProfileImageAnalysisOutcome> {
  // Only profiles that have a photo URL need a Gemini request; profiles
  // without photos still continue through the run.
  const profilesWithPhoto = profiles.filter(
    (profile): profile is Profile & { photo: string } =>
      typeof profile.photo === 'string' && profile.photo.length > 0,
  );
  const profilesWithoutPhoto = profiles.length - profilesWithPhoto.length;
  const concurrency = resolveProfileImageBatchConcurrency(
    concurrencyOverride ?? imageConcurrencyFromEnvironment(),
  );

  logger.info(
    {
      profilesWithPhoto: profilesWithPhoto.length,
      profilesWithoutPhoto,
      concurrency,
    },
    'Starting profile image analysis.',
  );

  // The batch analyzer returns one fulfilled or rejected result per photo.
  const imageResults = await analyze(
    profilesWithPhoto.map((profile) => ({
      id: profile.id,
      source: { kind: 'url', url: profile.photo },
    })),
    {
      concurrency,
      resolution: IMAGE_ANALYSIS_RESOLUTION,
    },
  );

  // Convert rejected image jobs into a compact, serializable failure list for
  // logs and the final pipeline summary.
  const failures = imageResults
    .filter((result) => result.status === 'rejected')
    .map((result) => ({
      profileId: result.id,
      error: result.error,
      ...(result.usage ? { usage: result.usage } : {}),
    }));

  for (const failure of failures) {
    logger.warn(failure, 'Profile image analysis failed.');
  }

  const successfulImageAnalyses = imageResults.length - failures.length;
  logger.info(
    {
      requestedImageAnalyses: imageResults.length,
      successfulImageAnalyses,
      failedImageAnalyses: failures.length,
    },
    'Completed profile image analysis.',
  );

  return {
    fullProfiles: attachSuccessfulImageAnalyses(profiles, imageResults),
    profilesWithoutPhoto,
    successfulImageAnalyses,
    failedImageAnalyses: failures.length,
    failures,
    tokenUsage: totalImageTokenUsage(imageResults),
  };
}
