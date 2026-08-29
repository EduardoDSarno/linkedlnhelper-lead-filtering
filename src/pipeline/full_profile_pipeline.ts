import { getLinkedlnProfileDataFromExternalProvidor } from '../dataCollector/csv/csvdata.js';
import type { ImportedCsvData } from '../dataCollector/csv/csvdata.js';
import { linkedinProfileKey } from '../linkedin/index.js';
import type { Logger } from '../logging/index.js';
import { mapApifyProfile } from '../mapper/index.js';
import { attachLinkedHelperPublicId } from '../profile/index.js';
import type { FullProfile } from '../profile/index.js';
import { analyzeProfileImages } from './image_analysis.js';
import {
  DEFAULT_PIPELINE_DEPENDENCIES,
  DEFAULT_PIPELINE_OUTPUT_PATHS,
  maxPipelineProfilesFromEnvironment,
} from './config.js';
import { logProfileImageOutcomes } from './profile_decision_logging.js';
import type {
  FullProfilePipelineDependencies,
  FullProfilePipelineOptions,
  FullProfilePipelineResult,
  FullProfilePipelineSummary,
  FullProfilePipelineSummaryInput,
  ProfileMappingFailure,
  ProfileNormalizationOutcome,
} from './types.js';

export {
  MAX_PIPELINE_PROFILES,
  maxPipelineProfilesFromEnvironment,
} from './config.js';
export type {
  FullProfilePipelineDependencies,
  FullProfilePipelineOptions,
  FullProfilePipelineOutputPaths,
  FullProfilePipelineResult,
  FullProfilePipelineSummary,
} from './types.js';

/** Converts an unknown failure into a stable message suitable for artifacts. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Maps provider records independently so one malformed profile cannot cancel a run. */
async function normalizeProfiles(
  rawProfiles: readonly Record<string, unknown>[],
  linkedHelperPublicIds: ReadonlyMap<string, string>,
  logger: Logger,
): Promise<ProfileNormalizationOutcome> {
  const profiles: FullProfile[] = [];
  const failures: ProfileMappingFailure[] = [];

  // Map profiles independently. One malformed provider record is reported and
  // skipped without preventing the remaining records from being processed.
  for (const [providerRecordIndex, rawProfile] of rawProfiles.entries()) {
    try {
      const profile = mapApifyProfile(rawProfile);
      const profileKey = linkedinProfileKey(profile.linkedinUrl);
      const linkedHelperPublicId = profileKey
        ? linkedHelperPublicIds.get(profileKey)
        : undefined;

      if (!linkedHelperPublicId) {
        throw new Error(
          `Could not correlate ${profile.linkedinUrl} with a Linked Helper public_id.`,
        );
      }

      profiles.push(
        attachLinkedHelperPublicId(profile, linkedHelperPublicId),
      );
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

/** Indexes exact CSV public IDs by normalized LinkedIn profile identity. */
function linkedHelperPublicIdsByProfileKey(
  importedData: ImportedCsvData,
): ReadonlyMap<string, string> {
  const publicIds = new Map<string, string>();

  for (const importedProfile of Object.values(importedData.records)) {
    const profileKey = linkedinProfileKey(importedProfile.summary.profileUrl);
    if (!profileKey || publicIds.has(profileKey)) continue;

    publicIds.set(profileKey, importedProfile.summary.publicId);
  }

  return publicIds;
}

/** Builds the serializable totals and failure details for one completed run. */
export function createFullProfilePipelineSummary({
  startedAt,
  completedAt,
  requestedProfiles,
  collection,
  normalization,
  imageAnalysis,
  outputPaths,
}: FullProfilePipelineSummaryInput): FullProfilePipelineSummary {
  return {
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    requestedProfiles,
    collectedProfiles: collection.profiles.length,
    providerCollection: collection.stats,
    providerFailures: collection.failures,
    normalizedProfiles: normalization.profiles.length,
    profilesWithoutPhoto: imageAnalysis.profilesWithoutPhoto,
    successfulImageAnalyses: imageAnalysis.successfulImageAnalyses,
    failedImageAnalyses: imageAnalysis.failedImageAnalyses,
    fullProfilesWritten: imageAnalysis.fullProfiles.length,
    mappingFailures: normalization.failures,
    imageAnalysisFailures: imageAnalysis.failures,
    imageTokenUsage: imageAnalysis.tokenUsage,
    outputs: { ...outputPaths },
  };
}

/**
 * Runs the production pipeline against the real provider, analyzer, filesystem,
 * clock, and output paths.
 */
export async function runFullProfilePipeline(
  importedData: ImportedCsvData,
  logger: Logger,
): Promise<FullProfilePipelineResult> {
  return runFullProfilePipelineWithDependencies(
    importedData,
    logger,
    DEFAULT_PIPELINE_DEPENDENCIES,
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
  dependencies: FullProfilePipelineDependencies = DEFAULT_PIPELINE_DEPENDENCIES,
  options: FullProfilePipelineOptions = {},
): Promise<FullProfilePipelineResult> {
  const outputPaths = options.outputPaths ?? DEFAULT_PIPELINE_OUTPUT_PATHS;

  // Step 1: record the start time and extract the deduplicated LinkedIn URLs
  // that the external profile provider needs from the imported CSV data.
  const startedAt = dependencies.now();
  const profileLinks = getLinkedlnProfileDataFromExternalProvidor(
    importedData.records,
  );
  const linkedHelperPublicIds =
    linkedHelperPublicIdsByProfileKey(importedData);

  // Step 2: reject empty and oversized runs before making paid API calls.
  if (profileLinks.length === 0) {
    throw new Error('The imported CSV does not contain any LinkedIn URLs.');
  }

  const maximumProfiles = maxPipelineProfilesFromEnvironment();
  if (profileLinks.length > maximumProfiles) {
    throw new Error(
      `The pipeline accepts at most ${maximumProfiles} profiles per run; received ${profileLinks.length}.`,
    );
  }

  const db = dependencies.openDatabase();

  try {
    logger.info(
      {
        requestedProfiles: profileLinks.length,
        maximumProfiles,
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
    const normalized = await normalizeProfiles(
      rawProfiles,
      linkedHelperPublicIds,
      logger,
    );
    logger.info(
      {
        normalizedProfiles: normalized.profiles.length,
        mappingFailures: normalized.failures.length,
      },
      'Normalized Apify profiles.',
    );

    // Steps 6 to 8: analyze the photos that exist and join the successful
    // assessments back onto their profiles. Profiles without a photo, and
    // profiles whose analysis failed, both survive into the output.
    const imageAnalysis = await analyzeProfileImages(
      normalized.profiles,
      dependencies.extractImages,
      logger,
      options.imageConcurrency,
    );

    // Step 9: persist completed profiles before writing them. An existing
    // LinkedIn identity restores its stable database ID in every later artifact.
    const fullProfiles = imageAnalysis.fullProfiles.map((profile) =>
      dependencies.insertProfile(profile, db),
    );
    logProfileImageOutcomes(logger, fullProfiles, imageAnalysis);
    await dependencies.writeJson(outputPaths.fullProfiles, fullProfiles);

    // Step 10: build operational totals and failure details for this exact run.
    const completedAt = dependencies.now();
    const summary = createFullProfilePipelineSummary({
      startedAt,
      completedAt,
      requestedProfiles: profileLinks.length,
      collection,
      normalization: normalized,
      imageAnalysis: { ...imageAnalysis, fullProfiles },
      outputPaths,
    });

    // Step 11: persist the summary last. Its presence signals that the run made
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

    return { summary, profiles: fullProfiles };
  } finally {
    db.close();
  }
}
