// Load local environment variables, such as APIFY_API_KEY, before main runs.
import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';

import {
  getLinkedlnProfileDataFromExternalProvidor,
  loadProfilesFromCsv,
} from './data/csvdata.js';
import { collectApifyProfiles } from './data/apify_api.js';
import type { ImportedCsvData } from './data/csvdata.js';
import type { ImportedCsvProfile } from './profile/index.js';

// A small fixed batch lets us inspect Apify's data without spending credits on
// the entire CSV before we know whether its employment history is complete.
const APIFY_TEST_PROFILE_LIMIT = 20;

/**
 * Command-line entry point for the importer.
 *
 * Example:
 * npm start -- "test_data/profiles.csv"
 * npm run collect -- "test_data/profiles.csv"
 * npm run collect:apify -- "test_data/profiles.csv"
 */
export async function main(): Promise<void> {
  // process.argv[0] is Node and argv[1] is this script. Everything after that
  // is supplied by the user on the command line.
  const commandLineArguments = process.argv.slice(2);
  const shouldCollectWithApify =
    commandLineArguments.includes('--collect') ||
    commandLineArguments.includes('--collect-apify');
  const csvPath = commandLineArguments.find(
    (argument) => argument !== '--collect' && argument !== '--collect-apify',
  );

  // Stop early with a useful message when the caller did not supply a file.
  if (!csvPath) {
    console.error('Usage: npm start -- <path-to-csv>');
    console.error('   or: npm run collect -- <path-to-csv>');
    console.error('   or: npm run collect:apify -- <path-to-csv>');
    process.exitCode = 1;
    return;
  }

  const importedData: ImportedCsvData = await loadProfilesFromCsv(csvPath);

  // records is keyed by public ID. Object.values gives us a simple list to print.
  const profiles: ImportedCsvProfile[] = Object.values(importedData.records);

  // The summary helps us verify row counts and deduplication at a glance.
  console.log('Import summary:');
  console.table({
    totalRows: importedData.total_rows,
    totalProfiles: importedData.total_profiles,
    duplicatedProfiles: importedData.duplicated_profiles,
  });

  // Importing and printing a CSV does not call an external provider. Collection
  // only starts when the command includes one of the explicit collection flags.
  if (!shouldCollectWithApify) {
    console.log('Profiles:');
    console.table(
      // Print only the useful overview fields instead of each profile's large raw row.
      profiles.map((profile) => ({
        publicId: profile.summary.publicId,
        fullName: profile.summary.fullName,
        headline: profile.summary.headline ?? '',
        location: profile.summary.location ?? '',
        profileUrl: profile.summary.profileUrl,
      })),
    );

    return;
  }

  const profileLinks = getLinkedlnProfileDataFromExternalProvidor(
    importedData.records,
  );

  // Use exactly the first 20 unique CSV profiles (or every profile when the
  // file contains fewer than 20) for this provider evaluation.
  const testProfileLinks = profileLinks.slice(0, APIFY_TEST_PROFILE_LIMIT);
  console.log(
    `Collecting Apify data for ${testProfileLinks.length} profiles...`,
  );

  const apifyProfiles = await collectApifyProfiles(testProfileLinks);

  // Preserve the provider response unchanged. The raw file is our evidence
  // when deciding which fields belong in the final normalized profile model.
  await mkdir('output', { recursive: true });
  const outputPath = 'output/apify-profiles.json';
  await writeFile(outputPath, JSON.stringify(apifyProfiles, null, 2), 'utf-8');

  console.log(`Collected ${apifyProfiles.length} Apify profile records.`);
  console.log(`Raw profile data saved to ${outputPath}`);
}

// main() returns a Promise, so handle any file-reading or parsing failure here.
main().catch((error: unknown) => {
  console.error('Application failed:', error);
  process.exitCode = 1;
});
