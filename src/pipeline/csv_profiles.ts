import type { ImportedCsvData } from '../dataCollector/csv/csvdata.js';
import { errorMessage } from '../helpers/index.js';
import type { Logger } from '../logging/index.js';
import {
  hasCareerColumns,
  mapLinkedHelperCsvProfile,
} from '../mapper/linked_helper_csv_profile_mapper.js';
import type { FullProfile } from '../profile/index.js';
import { maxPipelineProfilesFromEnvironment } from './config.js';
import type { CsvProfileImport, ProfileStoreDependencies } from './types.js';

/**
 * Turns an imported Linked Helper CSV into saved, evaluable profiles.
 *
 * This is the whole acquisition step: the export already carries each
 * person's career, so nothing is fetched from outside. A row that cannot be
 * mapped or saved is logged and skipped, so one bad row never costs the rest
 * of the campaign.
 */
export function importCsvProfiles(
  importedData: ImportedCsvData,
  logger: Logger,
  dependencies: ProfileStoreDependencies,
): CsvProfileImport {
  const records = Object.values(importedData.records);
  assertImportable(records.map((record) => record.raw));

  const db = dependencies.openDatabase();
  const profiles: FullProfile[] = [];
  const failures: CsvProfileImport['failures'] = [];

  try {
    for (const record of records) {
      try {
        profiles.push(
          dependencies.insertProfile(mapLinkedHelperCsvProfile(record), db),
        );
      } catch (error: unknown) {
        const failure = { publicId: record.summary.publicId, error: errorMessage(error) };
        failures.push(failure);
        logger.error(failure, 'Could not import a CSV profile.');
      }
    }
  } finally {
    db.close();
  }

  logger.info(
    { importedProfiles: profiles.length, failedProfiles: failures.length },
    'Imported profiles from the CSV.',
  );

  return { profiles, failures };
}

/**
 * Refuses a CSV the evaluation cannot use, before anything is saved.
 *
 * Every row of one export shares a header, so checking the first row is
 * enough to tell the career export from the lighter one.
 */
function assertImportable(rows: readonly ImportedCsvData['records'][string]['raw'][]): void {
  const [first] = rows;
  if (!first) {
    throw new Error('The imported CSV does not contain any profiles.');
  }

  if (!hasCareerColumns(first)) {
    throw new Error(
      'This CSV has no career columns. Export the campaign from Linked Helper as "Perfis baixados" so each row carries jobs and education.',
    );
  }

  const maximumProfiles = maxPipelineProfilesFromEnvironment();
  if (rows.length > maximumProfiles) {
    throw new Error(
      `The pipeline accepts at most ${maximumProfiles} profiles per run; received ${rows.length}.`,
    );
  }
}
