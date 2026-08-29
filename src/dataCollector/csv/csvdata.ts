import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';

import { deduplicateBy } from '../../helpers/index.js';
import { toImportedCsvProfile } from '../../profile/index.js';
import type { ImportedCsvProfile } from '../../profile/index.js';

export const TEXT_ENCODING = 'utf-8';

/** The complete result of importing and deduplicating one CSV file. */
export interface ImportedCsvData {
  // Total number of data rows read before validation or deduplication.
  total_rows: number;

  // Number of unique profiles that have a public_id.
  total_profiles: number;

  // Number of later rows skipped because their public_id was already seen.
  duplicated_profiles: number;

  // Keying by public ID makes looking up one profile inexpensive.
  records: Record<string, ImportedCsvProfile>;
}

/** Reads a Linked Helper CSV and converts it into normalized profile records. */
export async function loadProfilesFromCsv(path: string): Promise<ImportedCsvData> 
{
  // readFile is asynchronous, so it does not block Node while the file is opened.
  const csvFile = await readFile(path, TEXT_ENCODING);

  // `columns: true` uses the first CSV row as object keys instead of array indexes.
  const rows: Record<string, string>[] = parse(csvFile, {
    columns: true,
    skip_empty_lines: true,

    // Linked Helper exports this file with semicolons rather than commas.
    delimiter: ';',

    // `bom: true` removes a possible invisible UTF-8 marker from the first header.
    bom: true,
  });

  // Convert every row, then exclude profiles that cannot be keyed by public ID.
  const profiles = rows
    .map(toImportedCsvProfile)
    .filter((profile) => profile.summary.publicId.length > 0);

  // The shared helper keeps the first profile for each public ID.
  const {
    uniqueItems: uniqueProfiles,
    duplicateCount,
  } = deduplicateBy(profiles, (profile) => profile.summary.publicId);

  // This object becomes ImportedCsvData.records, with one profile per ID.
  const records: Record<string, ImportedCsvProfile> = {};

  for (const profile of uniqueProfiles) {
    records[profile.summary.publicId] = profile;
  }

  return {
    total_rows: rows.length,
    total_profiles: uniqueProfiles.length,
    duplicated_profiles: duplicateCount,
    records,
  };
}

/**
 * Extracts the LinkedIn URLs that an external enrichment provider needs.
 * The raw CSV fields and other profile details are deliberately excluded.
 */
export function getLinkedlnProfileDataFromExternalProvidor(profiles: Record<string, ImportedCsvProfile>): Array<string>
{
  let profile_url_list = new Array<string>;

  for (const profile of Object.values(profiles))
  {
      profile_url_list.push(profile.summary.profileUrl);
  }

  return profile_url_list;
}
