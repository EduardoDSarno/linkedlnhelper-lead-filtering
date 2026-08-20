import { loadProfilesFromCsv } from './data/csvdata.js';
import type { ImportedCsvData } from './data/csvdata.js';
import type { ImportedProfile } from './profile.js';

/**
 * Command-line entry point for the importer.
 *
 * Example:
 * npm start -- "test_data/profiles.csv"
 */
export async function main(): Promise<void> {
  // process.argv[0] is Node, argv[1] is this script, and argv[2] is the CSV path.
  const csvPath = process.argv[2];

  // Stop early with a useful message when the caller did not supply a file.
  if (!csvPath) {
    console.error('Usage: npm start -- <path-to-csv>');
    process.exitCode = 1;
    return;
  }

  const importedData: ImportedCsvData = await loadProfilesFromCsv(csvPath);

  // records is keyed by public ID. Object.values gives us a simple list to print.
  const profiles: ImportedProfile[] = Object.values(importedData.records);

  // The summary helps us verify row counts and deduplication at a glance.
  console.log('Import summary:');
  console.table({
    totalRows: importedData.total_rows,
    totalProfiles: importedData.total_profiles,
    duplicatedProfiles: importedData.duplicated_profiles,
  });

  console.log('Profiles:');
  console.table(
    // Print only the useful overview fields instead of each profile's large raw row.
    profiles.map((profile) => ({
      publicId: profile.public_id,
      fullName: profile.fullName,
      headline: profile.headline ?? '',
      location: profile.location ?? '',
      profileUrl: profile.profileUrl,
    })),
  );
}

// main() returns a Promise, so handle any file-reading or parsing failure here.
main().catch((error: unknown) => {
  console.error('Failed to import profiles:', error);
  process.exitCode = 1;
});
