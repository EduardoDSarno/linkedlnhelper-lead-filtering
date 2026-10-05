import type { ImportedCsvData } from '../dataCollector/csv/csvdata.js';
import type { Logger } from '../logging/index.js';
import type { ImportedCsvProfile } from '../profile/index.js';

/**
 * Fake boundaries for full-pipeline tests.
 *
 * Nothing here reaches a network or the filesystem.
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

/** One imported person: their LinkedIn URL and, optionally, a photo. */
export interface ImportedPersonFixture {
  profileUrl: string;
  avatarUrl?: string;
}

/**
 * Builds imported CSV data shaped like the "Perfis baixados" export.
 *
 * Each row carries one job and one school, so the import accepts it as a
 * career export and the evaluation has something to read.
 */
export function importedCsvDataFor(
  people: readonly ImportedPersonFixture[],
): ImportedCsvData {
  const records: Record<string, ImportedCsvProfile> = {};

  for (const [index, { profileUrl, avatarUrl }] of people.entries()) {
    const publicId = `imported-${index}`;
    records[publicId] = {
      summary: {
        publicId,
        profileUrl,
        linkedHelperId: `lh-${index}`,
        fullName: `Imported Person ${index}`,
        firstName: `Person ${index}`,
        ...(avatarUrl ? { avatarUrl } : {}),
        openToWork: false,
        hiring: false,
        premium: false,
        influencer: false,
      },
      raw: {
        public_id: publicId,
        profile_url: profileUrl,
        organization_1: 'Example Company',
        organization_title_1: 'Account Executive',
        organization_start_1: '2022.01',
        education_1: 'Example University',
        education_degree_1: 'Bachelor',
      },
    };
  }

  return {
    total_rows: people.length,
    total_profiles: people.length,
    duplicated_profiles: 0,
    records,
  };
}
