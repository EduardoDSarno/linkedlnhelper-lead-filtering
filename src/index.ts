import { readFile } from 'fs/promises';
import { parse } from 'csv-parse/sync';

const TEXT_ENCODING = 'utf-8';

export interface ImportedProfile {
    public_id: string;
    profileUrl: string;
    fullName: string;
    firstName?: string;
    lastName?: string;
    headline?: string;
    avatarUrl?: string;
    location?: string;
    raw: Record<string, string>; // raw row data
}

export interface ImportedData
{
    total_rows: number;
    total_profiles: number;
    duplicated_profiles: number;
    records: Record<string, ImportedProfile>; // Profiles keyed by LinkedIn public ID
}

export function toImportedProfile(
    row: Record<string, string>,
  ): ImportedProfile {
    const public_id = row['public_id']?.trim();
    const firstName = row['first_name']?.trim();
    const lastName = row['last_name']?.trim();
  
    const profile: ImportedProfile = 
    {
      public_id: public_id ?? '',
      profileUrl: row['profile_url']?.trim() ?? '',
      fullName:
        row['full_name']?.trim() ||
        [firstName, lastName].filter(Boolean).join(' '),
      raw: row,
    };
  
    if (firstName) profile.firstName = firstName;
    if (lastName) profile.lastName = lastName;
  
    const headline = row['headline']?.trim();
    const avatarUrl = row['avatar']?.trim();
    const location = row['location_name']?.trim();
  
    if (headline) profile.headline = headline;
    if (avatarUrl) profile.avatarUrl = avatarUrl;
    if (location) profile.location = location;
  
    return profile;
  }

export async function loadProfilesFromCsv(path: string): Promise<ImportedData>
{

    const csvFile = await readFile(path, TEXT_ENCODING);

    const rows: Record<string,string>[] = parse(csvFile,
        {
            columns: true, // Tells the parser to treat the first row as headers
            skip_empty_lines: true, // Ignores blank lines in the CSV
            delimiter: ';',
            bom: true,
        }
    );
    
    let rows_count = 0;
    let dup_count = 0;
    const unique_ids = new Set<string>();
    const records: Record<string, ImportedProfile> = {};

    for (const row of rows)
    {
        rows_count++;

        const profile = toImportedProfile(row);
        const id = profile.public_id;

        // A profile without an ID cannot be safely deduplicated or keyed.
        if (!id) {
            continue;
        }

        if (unique_ids.has(id)) {
            dup_count++;
            continue;
        }

        unique_ids.add(id);
        records[id] = profile;
    }

    return {
        total_rows: rows_count,
        total_profiles: unique_ids.size,
        duplicated_profiles: dup_count,
        records,
    };
}
