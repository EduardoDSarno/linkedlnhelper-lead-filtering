import { readFile } from 'node:fs/promises';

import type { ImportedCsvData } from '../dataCollector/csv/csvdata.js';
import { asRecord, asString, errorMessage } from '../helpers/index.js';
import { linkedinProfileKey } from '../linkedin/index.js';
import { attachLinkedHelperPublicId } from '../profile/index.js';
import type { FullProfile } from '../profile/index.js';
import { DEFAULT_PIPELINE_OUTPUT_PATHS } from './config.js';
import type {
  FullProfilePipelineResult,
  FullProfilePipelineSummary,
  ImageTokenUsageTotal,
} from './types.js';

/** Default artifact reused when a review run skips paid collection. */
export const DEFAULT_CACHED_PROFILES_PATH =
  DEFAULT_PIPELINE_OUTPUT_PATHS.fullProfiles;

/** How many missing URLs are named in the incomplete-coverage error. */
const MISSING_CACHED_PROFILE_PREVIEW = 5;

/** Sources a cached review can read full profiles from. */
export interface CachedProfileSource {
  cachedProfiles?: readonly FullProfile[];
  cachedProfilesPath?: string;
  readCachedProfiles: (path: string) => Promise<unknown>;
}

/**
 * Loads cached full profiles and keeps only those that belong to this import.
 *
 * The paid collection artifacts are reused so a later review can score the same
 * people without calling Apify or the image model again.
 */
export async function resolveCachedProfilesForImport(
  importedData: ImportedCsvData,
  source: CachedProfileSource,
): Promise<FullProfile[]> {
  const cachedProfiles = source.cachedProfiles
    ? [...source.cachedProfiles]
    : parseCachedFullProfiles(
        await source.readCachedProfiles(
          source.cachedProfilesPath ?? DEFAULT_CACHED_PROFILES_PATH,
        ),
      );

  return matchCachedProfilesToImport(cachedProfiles, importedData);
}

/**
 * Aligns cached profiles to the current CSV order and Linked Helper identities.
 *
 * Matching uses the normalized LinkedIn key first, then the public id from a
 * previous import of the same file. Every imported row must resolve or the run
 * stops, so a partial cache cannot silently score a subset.
 */
export function matchCachedProfilesToImport(
  cachedProfiles: readonly FullProfile[],
  importedData: ImportedCsvData,
): FullProfile[] {
  const byLinkedinKey = indexCachedProfilesByLinkedinKey(cachedProfiles);
  const byPublicId = indexCachedProfilesByPublicId(cachedProfiles);
  const matched: FullProfile[] = [];
  const missingUrls: string[] = [];

  for (const importedProfile of Object.values(importedData.records)) {
    const { publicId, profileUrl } = importedProfile.summary;
    const cachedProfile =
      lookupCachedProfile(byLinkedinKey, linkedinProfileKey(profileUrl)) ??
      lookupCachedProfile(byPublicId, publicId);

    if (!cachedProfile) {
      missingUrls.push(profileUrl);
      continue;
    }

    matched.push(
      attachLinkedHelperPublicId(
        { ...cachedProfile, linkedinUrl: profileUrl },
        publicId,
      ),
    );
  }

  if (missingUrls.length > 0) {
    throw new Error(
      incompleteCachedCoverageMessage(
        matched.length,
        importedData.total_profiles,
        missingUrls,
      ),
    );
  }

  return matched;
}

/**
 * Narrows parsed JSON into the full-profile records evaluation can compact.
 *
 * The check is structural, not a full schema walk: a usable cached artifact
 * always has an identity, a LinkedIn URL, and the experience/education arrays.
 */
export function parseCachedFullProfiles(value: unknown): FullProfile[] {
  if (!Array.isArray(value)) {
    throw new Error('Cached full profiles must be a JSON array.');
  }

  return value.map((item, index) => {
    if (!isCachedFullProfile(item)) {
      throw new Error(`Invalid full profile at index ${index}.`);
    }

    return item;
  });
}

/**
 * Builds the acquisition result a review run expects when collection is skipped.
 *
 * Counts describe the reused artifact rather than a new provider call, so later
 * logging and report writers keep the same shape without inventing paid work.
 */
export function buildCachedProfilePipelineResult(
  profiles: readonly FullProfile[],
  now: Date,
): FullProfilePipelineResult {
  const completedAt = now.toISOString();
  const profilesWithoutPhoto = profiles.filter(
    (profile) => !asString(profile.photo),
  ).length;
  const successfulImageAnalyses = profiles.filter(
    (profile) => profile.imageAnalysis !== undefined,
  ).length;

  const summary: FullProfilePipelineSummary = {
    startedAt: completedAt,
    completedAt,
    durationMs: 0,
    requestedProfiles: profiles.length,
    collectedProfiles: profiles.length,
    providerCollection: emptyCachedCollectionStats(profiles.length),
    providerFailures: [],
    normalizedProfiles: profiles.length,
    profilesWithoutPhoto,
    successfulImageAnalyses,
    failedImageAnalyses: 0,
    fullProfilesWritten: profiles.length,
    mappingFailures: [],
    imageAnalysisFailures: [],
    imageTokenUsage: emptyCachedImageTokenUsage(),
    outputs: { ...DEFAULT_PIPELINE_OUTPUT_PATHS },
  };

  return { summary, profiles: [...profiles] };
}

/**
 * Reads the on-disk full-profile artifact and fails clearly when it is absent.
 */
export async function readCachedProfilesFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      throw new Error(
        `Cached full profiles were not found at ${path}. Run a full collection first.`,
      );
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Cached full profiles at ${path} are not valid JSON.`);
    }

    throw new Error(
      `Could not read cached full profiles at ${path}: ${errorMessage(error)}`,
    );
  }
}

/** Indexes cached profiles by the stable LinkedIn comparison key. */
function indexCachedProfilesByLinkedinKey(
  cachedProfiles: readonly FullProfile[],
): ReadonlyMap<string, FullProfile> {
  const profiles = new Map<string, FullProfile>();

  for (const profile of cachedProfiles) {
    const profileKey = linkedinProfileKey(profile.linkedinUrl);
    if (profileKey && !profiles.has(profileKey)) {
      profiles.set(profileKey, profile);
    }
  }

  return profiles;
}

/** Indexes cached profiles by the Linked Helper public id stored on them. */
function indexCachedProfilesByPublicId(
  cachedProfiles: readonly FullProfile[],
): ReadonlyMap<string, FullProfile> {
  const profiles = new Map<string, FullProfile>();

  for (const profile of cachedProfiles) {
    const publicId = profile.linkedHelperPublicId;
    if (publicId && !profiles.has(publicId)) {
      profiles.set(publicId, profile);
    }
  }

  return profiles;
}

/** Returns the cached profile for a lookup key, when one was indexed. */
function lookupCachedProfile(
  index: ReadonlyMap<string, FullProfile>,
  key: string | undefined,
): FullProfile | undefined {
  return key ? index.get(key) : undefined;
}

/** Returns whether parsed JSON has the fields a cached full profile must keep. */
function isCachedFullProfile(value: unknown): value is FullProfile {
  const record = asRecord(value);

  return Boolean(
    record &&
      asString(record['id']) &&
      asString(record['linkedinUrl']) &&
      Array.isArray(record['experience']) &&
      Array.isArray(record['education']),
  );
}

/** Explains which imported URLs were absent from the cached artifact. */
function incompleteCachedCoverageMessage(
  matchedCount: number,
  requestedCount: number,
  missingUrls: readonly string[],
): string {
  const preview = missingUrls.slice(0, MISSING_CACHED_PROFILE_PREVIEW);
  const remaining = missingUrls.length - preview.length;
  const remainingSuffix =
    remaining > 0 ? ` and ${remaining} more` : '';

  return (
    `Cached profiles cover ${matchedCount} of ${requestedCount} imported ` +
    `LinkedIn URLs. Missing: ${preview.join(', ')}${remainingSuffix}.`
  );
}

/** Collection totals that report reuse rather than a new provider run. */
function emptyCachedCollectionStats(requestedProfiles: number) {
  return {
    requestedProfiles,
    collectedProfiles: requestedProfiles,
    failedProfiles: 0,
    permanentFailures: 0,
    exhaustedTransientFailures: 0,
    retriedProfiles: 0,
    totalProfileAttempts: 0,
    roundsCompleted: 0,
    retryRounds: 0,
    actorRuns: 0,
    batchSize: 0,
    batchConcurrency: 0,
    unexpectedProviderRecords: 0,
  };
}

/** Image-token totals for a run that did not call the image model. */
function emptyCachedImageTokenUsage(): ImageTokenUsageTotal {
  return {
    promptTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
  };
}

/** Returns whether a filesystem error means the cached artifact is absent. */
function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
