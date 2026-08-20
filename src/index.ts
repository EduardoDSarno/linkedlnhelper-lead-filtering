// Load local environment variables, such as BRIGHTDATA_API_KEY, before main runs.
import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';

import {
  getLinkedlnProfileDataFromExternalProvidor,
  loadProfilesFromCsv,
} from './data/csvdata.js';
import { collectBrightDataProfiles } from './data/bright_data_api.js';
import type { ImportedCsvData } from './data/csvdata.js';
import type { ImportedProfile } from './profile.js';

/**
 * Command-line entry point for the importer.
 *
 * Example:
 * npm start -- "test_data/profiles.csv"
 * npm run collect -- "test_data/profiles.csv"
 */
export async function main(): Promise<void> {
  // process.argv[0] is Node and argv[1] is this script. Everything after that
  // is supplied by the user on the command line.
  const commandLineArguments = process.argv.slice(2);
  const shouldCollectWithBrightData = commandLineArguments.includes('--collect');
  const csvPath = commandLineArguments.find(
    (argument) => argument !== '--collect',
  );

  // Stop early with a useful message when the caller did not supply a file.
  if (!csvPath) {
    console.error('Usage: npm start -- <path-to-csv>');
    console.error('   or: npm run collect -- <path-to-csv>');
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

  // Importing and printing a CSV does not call Bright Data. Collection only
  // starts when the command includes the explicit --collect flag.
  if (!shouldCollectWithBrightData) {
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

    return;
  }

  const profileLinks = getLinkedlnProfileDataFromExternalProvidor(
    importedData.records,
  );

  console.log(`Collecting Bright Data for ${profileLinks.length} profiles...`);

  // This single function hides the internal snapshot workflow: it starts the
  // job, waits until it is ready, downloads it, and returns the actual profiles.
  const brightDataProfiles = await collectBrightDataProfiles(profileLinks);

  // Keep the first real response unchanged. We will inspect this sample before
  // deciding which Bright Data fields belong in our final profile interfaces.
  await mkdir('output', { recursive: true });
  const outputPath = 'output/bright-data-profiles.json';
  await writeFile(
    outputPath,
    JSON.stringify(brightDataProfiles, null, 2),
    'utf-8',
  );

  console.log(`Collected ${brightDataProfiles.length} Bright Data profiles.`);
  console.log(`Raw profile data saved to ${outputPath}`);
}

// main() returns a Promise, so handle any file-reading or parsing failure here.
main().catch((error: unknown) => {
  console.error('Application failed:', error);
  process.exitCode = 1;
});
