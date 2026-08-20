import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';

import { toImportedProfile } from '../profile.js';
import type { ImportedProfile } from '../profile.js';

const TEXT_ENCODING = 'utf-8';

/** The complete result of importing and deduplicating one CSV file. */
export interface ImportedCsvData {
  // Number of data rows read before validation or deduplication.
  total_rows: number;

  // Number of unique profiles that have a public_id.
  total_profiles: number;

  // Number of later rows skipped because their public_id was already seen.
  duplicated_profiles: number;

  // Keying by public ID makes looking up one profile inexpensive.
  records: Record<string, ImportedProfile>;
}

/** Reads a Linked Helper CSV and converts it into normalized profile records. */
export async function loadProfilesFromCsv(path: string): Promise<ImportedCsvData> {
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

  let rowsCount = 0;
  let duplicateCount = 0;

  // Set.has() lets us detect a repeated ID without scanning all earlier profiles.
  const uniqueIds = new Set<string>();

  // This object becomes ImportedCsvData.records, with one profile per ID.
  const records: Record<string, ImportedProfile> = {};

  for (const row of rows) {
    rowsCount++;

    const profile = toImportedProfile(row);
    const id = profile.public_id;

    // A profile without an ID cannot be safely deduplicated or keyed.
    if (!id) {
      continue;
    }

    if (uniqueIds.has(id)) {
      duplicateCount++;
      continue;
    }

    // Only the first row for each ID reaches the final records object.
    uniqueIds.add(id);
    records[id] = profile;
  }

  return {
    total_rows: rowsCount,
    total_profiles: uniqueIds.size,
    duplicated_profiles: duplicateCount,
    records,
  };
}

/**
 * Extracts the LinkedIn URLs that an external enrichment provider needs.
 * The raw CSV fields and other profile details are deliberately excluded.
 */
export function getLinkedlnProfileDataFromExternalProvidor(profiles: Record<string, ImportedProfile>): Array<string>
{
  let profile_url_list = new Array<string>;

  for (const profile of Object.values(profiles))
  {
      profile_url_list.push(profile.profileUrl);
  }

  return profile_url_list;
}
