import type {
  ApifyCollectionResult,
  RawApifyProfile,
} from '../dataCollector/apify_profile_collector/index.js';
import type { ImportedCsvData } from '../dataCollector/csvdata.js';
import type {
  ProfileImageExtractionResult,
  ProfileImageJob,
  ProfileImageJobResult,
} from '../imageExtractor/index.js';
import type { Logger } from '../logging/index.js';
import type { ImportedCsvProfile } from '../profile/index.js';
import { validImageAssessment } from './image_assessment_fixtures.js';

/**
 * Fake boundaries for full-pipeline tests.
 *
 * Every fake records what it was asked to do, so a test can assert on the calls
 * as well as the result. Nothing here reaches a network, a real clock, or the
 * filesystem.
 */

/** A logger that discards output but keeps counts for assertions. */
export interface RecordingLogger extends Logger {
  entries: { level: string; payload: unknown; message: string }[];
}

/** Builds a logger that records instead of writing anywhere. */
export function recordingLogger(): RecordingLogger {
  const entries: RecordingLogger['entries'] = [];
  const record =
    (level: string) =>
    (payload: unknown, message?: string): void => {
      entries.push({ level, payload, message: message ?? '' });
    };

  const logger = {
    entries,
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    debug: record('debug'),
    fatal: record('fatal'),
    trace: record('trace'),
  };

  return logger as unknown as RecordingLogger;
}

/** Builds imported CSV data from LinkedIn URLs alone. */
export function importedCsvDataFor(
  profileUrls: readonly string[],
): ImportedCsvData {
  const records: Record<string, ImportedCsvProfile> = {};

  for (const [index, profileUrl] of profileUrls.entries()) {
    const publicId = `imported-${index}`;
    records[publicId] = {
      summary: {
        publicId,
        profileUrl,
        linkedHelperId: `lh-${index}`,
        fullName: `Imported Person ${index}`,
        openToWork: false,
        hiring: false,
        premium: false,
        influencer: false,
      },
      raw: { public_id: publicId, profile_url: profileUrl },
    };
  }

  return {
    total_rows: profileUrls.length,
    total_profiles: profileUrls.length,
    duplicated_profiles: 0,
    records,
  };
}

/** Builds a collection result with the supplied records and failures. */
export function apifyCollectionResult(
  profiles: readonly RawApifyProfile[],
  failures: ApifyCollectionResult['failures'] = [],
  statsOverrides: Partial<ApifyCollectionResult['stats']> = {},
): ApifyCollectionResult {
  return {
    profiles: [...profiles],
    failures: [...failures],
    stats: {
      requestedProfiles: profiles.length + failures.length,
      collectedProfiles: profiles.length,
      failedProfiles: failures.length,
      permanentFailures: failures.length,
      exhaustedTransientFailures: 0,
      retriedProfiles: 0,
      totalProfileAttempts: profiles.length + failures.length,
      roundsCompleted: 1,
      retryRounds: 0,
      actorRuns: 1,
      batchSize: 10,
      batchConcurrency: 10,
      unexpectedProviderRecords: 0,
      ...statsOverrides,
    },
  };
}

/** Builds a successful image extraction result. */
export function imageExtractionResult(
  overrides: Partial<ProfileImageExtractionResult> = {},
): ProfileImageExtractionResult {
  return {
    assessment: validImageAssessment(),
    model: 'test-model',
    resolution: 'medium',
    ...overrides,
  };
}

/** Records every artifact a run writes, in the order it wrote them. */
export interface RecordingWriter {
  writeJson: (path: string, value: unknown) => Promise<void>;
  writes: { path: string; value: unknown }[];
  paths: () => string[];
  valueAt: (path: string) => unknown;
}

/** Builds a writer that keeps artifacts in memory instead of on disk. */
export function recordingWriter(
  failOn?: { path: string; error: Error },
): RecordingWriter {
  const writes: RecordingWriter['writes'] = [];

  return {
    writes,
    writeJson: async (path, value) => {
      if (failOn && path === failOn.path) throw failOn.error;
      writes.push({ path, value });
    },
    paths: () => writes.map((write) => write.path),
    valueAt: (path) =>
      writes.find((write) => write.path === path)?.value,
  };
}

/** Builds a clock that advances a fixed amount on every reading. */
export function steppingClock(
  startIso = '2026-01-01T00:00:00.000Z',
  stepMs = 1_000,
): () => Date {
  let current = new Date(startIso).getTime();

  return () => {
    const reading = new Date(current);
    current += stepMs;
    return reading;
  };
}

/**
 * Builds an image extractor that resolves each job from a lookup by profile ID.
 *
 * Jobs whose ID is absent from the map are rejected, which is how a test
 * distinguishes an intended failure from an unexpected one.
 */
export function fakeImageExtractor(
  resultsById: Record<string, ProfileImageJobResult>,
): (jobs: readonly ProfileImageJob[]) => Promise<ProfileImageJobResult[]> {
  return async (jobs) =>
    jobs.map(
      (job) =>
        resultsById[job.id] ?? {
          id: job.id,
          status: 'rejected' as const,
          error: `No fake result was configured for ${job.id}.`,
        },
    );
}
