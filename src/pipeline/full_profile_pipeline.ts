import { collectApifyProfiles } from '../data/apify_profile_collector/index.js';
import type {
  ApifyCollectionResult,
  ApifyCollectionStats,
  ApifyProfileFailure,
} from '../data/apify_profile_collector/index.js';
import { getLinkedlnProfileDataFromExternalProvidor } from '../data/csvdata.js';
import type { ImportedCsvData } from '../data/csvdata.js';
import { extractProfileImages } from '../image_extractor/index.js';
import type {
  GeminiTokenUsage,
  ProfileImageBatchOptions,
  ProfileImageJob,
  ProfileImageJobResult,
} from '../image_extractor/index.js';
import { resolveProfileImageBatchConcurrency } from '../image_extractor/index.js';
import { writeJsonAtomically } from '../helpers/write_json_atomically.js';
import type { Logger } from '../logging/index.js';
import { mapApifyProfile } from '../mapper/index.js';
import { attachProfileImageAnalysis } from '../profile/index.js';
import type { FullProfile, Profile } from '../profile/index.js';

export const MAX_PIPELINE_PROFILES = 1_000;

const RAW_APIFY_OUTPUT_PATH = 'output/apify-profiles.json';
const APIFY_FAILURES_OUTPUT_PATH = 'output/apify-profile-failures.json';
const FULL_PROFILES_OUTPUT_PATH = 'output/full-profiles.json';
const PIPELINE_SUMMARY_OUTPUT_PATH = 'output/pipeline-summary.json';
const IMAGE_CONCURRENCY_ENVIRONMENT_KEY = 'IMAGE_ANALYSIS_CONCURRENCY';

interface ProfileMappingFailure {
  providerRecordIndex: number;
  error: string;
}

interface ImageAnalysisFailure {
  profileId: string;
  error: string;

  /** Tokens Gemini billed before rejecting this image, when it reported any. */
  usage?: GeminiTokenUsage;
}

/** Where one run writes its artifacts. */
export interface FullProfilePipelineOutputPaths {
  rawApifyProfiles: string;
  apifyProfileFailures: string;
  fullProfiles: string;
  summary: string;
}

/**
 * The outside world this pipeline touches.
 *
 * Only genuine boundaries appear here: the paid provider, the paid image
 * analyzer, the filesystem, and the clock. The mapper is deliberately absent
 * because it is pure and has nothing to isolate — running the real one is what
 * lets an integration test catch drift between mapping and the pipeline.
 */
export interface FullProfilePipelineDependencies {
  collectProfiles: (
    profileLinks: readonly string[],
    logger: Logger,
  ) => Promise<ApifyCollectionResult>;

  extractImages: (
    jobs: readonly ProfileImageJob[],
    options: ProfileImageBatchOptions,
  ) => Promise<ProfileImageJobResult[]>;

  writeJson: (path: string, value: unknown) => Promise<void>;

  now: () => Date;
}

/** Runtime settings a caller may override, such as a test writing elsewhere. */
export interface FullProfilePipelineOptions {
  imageConcurrency?: number;
  outputPaths?: FullProfilePipelineOutputPaths;
}

const DEFAULT_OUTPUT_PATHS: FullProfilePipelineOutputPaths = {
  rawApifyProfiles: RAW_APIFY_OUTPUT_PATH,
  apifyProfileFailures: APIFY_FAILURES_OUTPUT_PATH,
  fullProfiles: FULL_PROFILES_OUTPUT_PATH,
  summary: PIPELINE_SUMMARY_OUTPUT_PATH,
};

const DEFAULT_DEPENDENCIES: FullProfilePipelineDependencies = {
  collectProfiles: collectApifyProfiles,
  extractImages: extractProfileImages,
  writeJson: writeJsonAtomically,
  now: () => new Date(),
};

export interface FullProfilePipelineSummary {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  requestedProfiles: number;
  collectedProfiles: number;
  providerCollection: ApifyCollectionStats;
  providerFailures: ApifyProfileFailure[];
  normalizedProfiles: number;
  profilesWithoutPhoto: number;
  successfulImageAnalyses: number;
  failedImageAnalyses: number;
  fullProfilesWritten: number;
  mappingFailures: ProfileMappingFailure[];
  imageAnalysisFailures: ImageAnalysisFailure[];

  /**
   * Tokens Gemini billed across this run, successes and failures together.
   *
   * Failed images are included deliberately: a blocked or truncated response
   * is charged for, so leaving it out would understate what the run cost.
   */
  imageTokenUsage: Required<GeminiTokenUsage>;
  outputs: {
    rawApifyProfiles: string;
    apifyProfileFailures: string;
    fullProfiles: string;
    summary: string;
  };
}

/** Converts an unknown failure into a stable message suitable for artifacts. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Adds up the tokens every image job reported, billed or wasted.
 *
 * Both branches of {@link ProfileImageJobResult} can carry usage: a fulfilled
 * job through its result, a rejected one when Gemini answered and then
 * declined. Missing counts are treated as zero rather than skipped, so the
 * total is always a complete set of numbers.
 */
function totalImageTokenUsage(
  results: readonly ProfileImageJobResult[],
): Required<GeminiTokenUsage> {
  const total: Required<GeminiTokenUsage> = {
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
function imageConcurrencyFromEnvironment(): number {
  return resolveProfileImageBatchConcurrency(
    process.env[IMAGE_CONCURRENCY_ENVIRONMENT_KEY],
  );
}

/** Maps provider records independently so one malformed profile cannot cancel a run. */
async function normalizeProfiles(
  rawProfiles: readonly Record<string, unknown>[],
  logger: Logger,
): Promise<{
  profiles: Profile[];
  failures: ProfileMappingFailure[];
}> {
  const profiles: Profile[] = [];
  const failures: ProfileMappingFailure[] = [];

  // Map profiles independently. One malformed provider record is reported and
  // skipped without preventing the remaining records from being processed.
  for (const [providerRecordIndex, rawProfile] of rawProfiles.entries()) {
    try {
      profiles.push(mapApifyProfile(rawProfile));
    } catch (error: unknown) {
      const failure = {
        providerRecordIndex,
        error: errorMessage(error),
      };
      failures.push(failure);
      logger.error(failure, 'Could not normalize Apify profile.');
    }
  }

  return { profiles, failures };
}

/** Joins successful image assessments to profiles by application-owned ID. */
function attachSuccessfulImageAnalyses(
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
 * Runs the production pipeline against the real provider, analyzer, filesystem,
 * clock, and output paths.
 */
export async function runFullProfilePipeline(
  importedData: ImportedCsvData,
  logger: Logger,
): Promise<FullProfilePipelineSummary> {
  return runFullProfilePipelineWithDependencies(
    importedData,
    logger,
    DEFAULT_DEPENDENCIES,
  );
}

/**
 * Runs the pipeline against injected boundaries.
 *
 * This is the same code production runs; only the provider, image analyzer,
 * filesystem, clock, and output paths are supplied by the caller. A test can
 * therefore exercise the complete run — collection, mapping, image analysis,
 * joining, and artifacts — without a paid request or a real output directory.
 */
export async function runFullProfilePipelineWithDependencies(
  importedData: ImportedCsvData,
  logger: Logger,
  dependencies: FullProfilePipelineDependencies = DEFAULT_DEPENDENCIES,
  options: FullProfilePipelineOptions = {},
): Promise<FullProfilePipelineSummary> {
  const outputPaths = options.outputPaths ?? DEFAULT_OUTPUT_PATHS;

  // Step 1: record the start time and extract the deduplicated LinkedIn URLs
  // that the external profile provider needs from the imported CSV data.
  const startedAt = dependencies.now();
  const profileLinks = getLinkedlnProfileDataFromExternalProvidor(
    importedData.records,
  );

  // Step 2: reject empty and oversized runs before making paid API calls.
  if (profileLinks.length === 0) {
    throw new Error('The imported CSV does not contain any LinkedIn URLs.');
  }

  if (profileLinks.length > MAX_PIPELINE_PROFILES) {
    throw new Error(
      `The pipeline accepts at most ${MAX_PIPELINE_PROFILES} profiles per run; received ${profileLinks.length}.`,
    );
  }

  logger.info(
    {
      requestedProfiles: profileLinks.length,
      maximumProfiles: MAX_PIPELINE_PROFILES,
    },
    'Starting full-profile pipeline.',
  );

  // Step 3: collect complete Apify records. The collector runs bounded batches
  // concurrently. Once a round settles, it pools only transiently failed URLs
  // into the next retry round; successes and permanent failures are not rerun.
  const collection = await dependencies.collectProfiles(profileLinks, logger);
  const rawProfiles = collection.profiles;

  // Step 4: persist successful raw responses and final provider failures as
  // separate artifacts. This keeps raw provider data intact and makes missing
  // or retry-exhausted profiles visible without blocking successful profiles.
  await Promise.all([
    dependencies.writeJson(outputPaths.rawApifyProfiles, rawProfiles),
    dependencies.writeJson(
      outputPaths.apifyProfileFailures,
      collection.failures,
    ),
  ]);
  logger.info(
    {
      collectedProfiles: rawProfiles.length,
      failedProfiles: collection.failures.length,
      retryRounds: collection.stats.retryRounds,
      actorRuns: collection.stats.actorRuns,
      outputPath: outputPaths.rawApifyProfiles,
      failuresOutputPath: outputPaths.apifyProfileFailures,
    },
    'Saved Apify collection results.',
  );

  // A count mismatch is not automatically fatal, but it is important evidence
  // that a requested profile may be unavailable or duplicated by the provider.
  if (rawProfiles.length !== profileLinks.length) {
    logger.warn(
      {
        requestedProfiles: profileLinks.length,
        collectedProfiles: rawProfiles.length,
        providerFailures: collection.failures.length,
      },
      'Apify result count differs from requested profile count.',
    );
  }

  // Step 5: map each raw Apify object into the small application Profile model
  // used for identity, employment, education, location, and manual review.
  const normalized = await normalizeProfiles(rawProfiles, logger);
  logger.info(
    {
      normalizedProfiles: normalized.profiles.length,
      mappingFailures: normalized.failures.length,
    },
    'Normalized Apify profiles.',
  );

  // Step 6: separate profiles that have a photo URL. Only those profiles need
  // a Gemini request; profiles without photos still continue through the run.
  const profilesWithPhoto = normalized.profiles.filter(
    (profile): profile is Profile & { photo: string } =>
      typeof profile.photo === 'string' && profile.photo.length > 0,
  );
  const profilesWithoutPhoto =
    normalized.profiles.length - profilesWithPhoto.length;
  const imageConcurrency = resolveProfileImageBatchConcurrency(
    options.imageConcurrency ?? imageConcurrencyFromEnvironment(),
  );

  logger.info(
    {
      profilesWithPhoto: profilesWithPhoto.length,
      profilesWithoutPhoto,
      concurrency: imageConcurrency,
    },
    'Starting profile image analysis.',
  );

  // Step 7: analyze profile photos concurrently using the configured limit.
  // The batch extractor returns one fulfilled or rejected result per photo.
  const imageResults = await dependencies.extractImages(
    profilesWithPhoto.map((profile) => ({
      id: profile.id,
      source: { kind: 'url', url: profile.photo },
    })),
    {
      concurrency: imageConcurrency,
      resolution: 'medium',
    },
  );
  // Convert rejected image jobs into a compact, serializable failure list for
  // logs and the final pipeline summary.
  const imageAnalysisFailures = imageResults
    .filter((result) => result.status === 'rejected')
    .map((result) => ({
      profileId: result.id,
      error: result.error,
      ...(result.usage ? { usage: result.usage } : {}),
    }));

  for (const failure of imageAnalysisFailures) {
    logger.warn(failure, 'Profile image analysis failed.');
  }

  const successfulImageAnalyses =
    imageResults.length - imageAnalysisFailures.length;
  logger.info(
    {
      requestedImageAnalyses: imageResults.length,
      successfulImageAnalyses,
      failedImageAnalyses: imageAnalysisFailures.length,
    },
    'Completed profile image analysis.',
  );

  // Step 8: join successful image results back to normalized profiles by ID,
  // forming the final FullProfile records without mutating the base profiles.
  const fullProfiles = attachSuccessfulImageAnalyses(
    normalized.profiles,
    imageResults,
  );
  await dependencies.writeJson(outputPaths.fullProfiles, fullProfiles);

  // Step 9: build operational totals and failure details for this exact run.
  const completedAt = dependencies.now();
  const summary: FullProfilePipelineSummary = {
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    requestedProfiles: profileLinks.length,
    collectedProfiles: rawProfiles.length,
    providerCollection: collection.stats,
    providerFailures: collection.failures,
    normalizedProfiles: normalized.profiles.length,
    profilesWithoutPhoto,
    successfulImageAnalyses,
    failedImageAnalyses: imageAnalysisFailures.length,
    fullProfilesWritten: fullProfiles.length,
    mappingFailures: normalized.failures,
    imageAnalysisFailures,
    imageTokenUsage: totalImageTokenUsage(imageResults),
    outputs: { ...outputPaths },
  };

  // Step 10: persist the summary last. Its presence signals that the run made
  // it through provider collection, normalization, image analysis, and output.
  await dependencies.writeJson(outputPaths.summary, summary);
  logger.info(
    {
      durationMs: summary.durationMs,
      fullProfilesWritten: summary.fullProfilesWritten,
      fullProfilesOutputPath: outputPaths.fullProfiles,
      summaryOutputPath: outputPaths.summary,
    },
    'Completed full-profile pipeline.',
  );

  return summary;
}
