import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';

import { toImportedProfile } from '../profile.js';
import type { ImportedProfile } from '../profile.js';

const TEXT_ENCODING = 'utf-8';

export interface ImportedCsvData {
  total_rows: number;
  total_profiles: number;
  duplicated_profiles: number;
  records: Record<string, ImportedProfile>;
}

export async function loadProfilesFromCsv(path: string): Promise<ImportedCsvData> {
  const csvFile = await readFile(path, TEXT_ENCODING);

  const rows: Record<string, string>[] = parse(csvFile, {
    columns: true,
    skip_empty_lines: true,
    delimiter: ';',
    bom: true,
  });

  let rowsCount = 0;
  let duplicateCount = 0;
  const uniqueIds = new Set<string>();
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

/// Returns a list of profile urls, from the profiles
export function getLinkedlnProfileDataFromExternalProvidor(profiles: Record<string, ImportedProfile>): Array<string>
{
  let profile_url_list = new Array<string>;

  for (const profile of Object.values(profiles))
  {
      profile_url_list.push(profile.profileUrl);
  }

  return profile_url_list;
}
