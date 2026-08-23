import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { collectApifyProfiles } from '../data/apify_profile_collector/index.js';
import type {
  ApifyCollectionStats,
  ApifyProfileFailure,
} from '../data/apify_profile_collector/index.js';
import { getLinkedlnProfileDataFromExternalProvidor } from '../data/csvdata.js';
import type { ImportedCsvData } from '../data/csvdata.js';
import { extractProfileImages } from '../image_extractor/index.js';
import type { ProfileImageJobResult } from '../image_extractor/index.js';
import type { Logger } from '../logging/index.js';
import { mapApifyProfile } from '../mapper/index.js';
import { attachProfileImageAnalysis } from '../profile/index.js';
import type { FullProfile, Profile } from '../profile/index.js';

export const MAX_PIPELINE_PROFILES = 1_000;

const RAW_APIFY_OUTPUT_PATH = 'output/apify-profiles.json';
const APIFY_FAILURES_OUTPUT_PATH = 'output/apify-profile-failures.json';
const FULL_PROFILES_OUTPUT_PATH = 'output/full-profiles.json';
const PIPELINE_SUMMARY_OUTPUT_PATH = 'output/pipeline-summary.json';
const DEFAULT_IMAGE_CONCURRENCY = 25;
const MAX_IMAGE_CONCURRENCY = 50;

interface ProfileMappingFailure {
  providerRecordIndex: number;
  error: string;
}

interface ImageAnalysisFailure {
  profileId: string;
  error: string;
}

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
  outputs: {
    rawApifyProfiles: string;
    apifyProfileFailures: string;
    fullProfiles: string;
    summary: string;
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function imageConcurrencyFromEnvironment(): number {
  // Keep image requests bounded even if an invalid or excessive environment
  // value is supplied. This protects both Gemini quotas and local resources.
  const configured = Number(process.env['IMAGE_ANALYSIS_CONCURRENCY']);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_IMAGE_CONCURRENCY;
  }

  return Math.min(MAX_IMAGE_CONCURRENCY, Math.floor(configured));
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  // Write to a temporary file first, then replace the destination in one move.
  // Readers therefore never observe a partially written JSON document.
  await mkdir(dirname(path), { recursive: true });

  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
  await rename(temporaryPath, path);
}

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

export async function runFullProfilePipeline(
  importedData: ImportedCsvData,
  logger: Logger,
): Promise<FullProfilePipelineSummary> {
  // Step 1: record the start time and extract the deduplicated LinkedIn URLs
  // that the external profile provider needs from the imported CSV data.
  const startedAt = new Date();
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
  const collection = await collectApifyProfiles(profileLinks, logger);
  const rawProfiles = collection.profiles;

  // Step 4: persist successful raw responses and final provider failures as
  // separate artifacts. This keeps raw provider data intact and makes missing
  // or retry-exhausted profiles visible without blocking successful profiles.
  await Promise.all([
    writeJsonAtomically(RAW_APIFY_OUTPUT_PATH, rawProfiles),
    writeJsonAtomically(APIFY_FAILURES_OUTPUT_PATH, collection.failures),
  ]);
  logger.info(
    {
      collectedProfiles: rawProfiles.length,
      failedProfiles: collection.failures.length,
      retryRounds: collection.stats.retryRounds,
      actorRuns: collection.stats.actorRuns,
      outputPath: RAW_APIFY_OUTPUT_PATH,
      failuresOutputPath: APIFY_FAILURES_OUTPUT_PATH,
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
  const imageConcurrency = imageConcurrencyFromEnvironment();

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
  const imageResults = await extractProfileImages(
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
  await writeJsonAtomically(FULL_PROFILES_OUTPUT_PATH, fullProfiles);

  // Step 9: build operational totals and failure details for this exact run.
  const completedAt = new Date();
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
    outputs: {
      rawApifyProfiles: RAW_APIFY_OUTPUT_PATH,
      apifyProfileFailures: APIFY_FAILURES_OUTPUT_PATH,
      fullProfiles: FULL_PROFILES_OUTPUT_PATH,
      summary: PIPELINE_SUMMARY_OUTPUT_PATH,
    },
  };

  // Step 10: persist the summary last. Its presence signals that the run made
  // it through provider collection, normalization, image analysis, and output.
  await writeJsonAtomically(PIPELINE_SUMMARY_OUTPUT_PATH, summary);
  logger.info(
    {
      durationMs: summary.durationMs,
      fullProfilesWritten: summary.fullProfilesWritten,
      fullProfilesOutputPath: FULL_PROFILES_OUTPUT_PATH,
      summaryOutputPath: PIPELINE_SUMMARY_OUTPUT_PATH,
    },
    'Completed full-profile pipeline.',
  );

  return summary;
}
