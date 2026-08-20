import { loadProfilesFromCsv } from './data.js';

export async function main(): Promise<void> {
  const csvPath = process.argv[2];

  if (!csvPath) {
    console.error('Usage: npm start -- <path-to-csv>');
    process.exitCode = 1;
    return;
  }

  const importedData = await loadProfilesFromCsv(csvPath);

  console.log('Import summary:');
  console.table({
    totalRows: importedData.total_rows,
    totalProfiles: importedData.total_profiles,
    duplicatedProfiles: importedData.duplicated_profiles,
  });

  console.log('Profiles:');
  console.table(
    Object.values(importedData.records).map((profile) => ({
      publicId: profile.public_id,
      fullName: profile.fullName,
      headline: profile.headline ?? '',
      location: profile.location ?? '',
      profileUrl: profile.profileUrl,
    })),
  );
}

main().catch((error: unknown) => {
  console.error('Failed to import profiles:', error);
  process.exitCode = 1;
});
