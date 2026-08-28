// Load local environment variables before constructing provider clients.
import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

import {
  APPLICATION_MODE,
  APPLICATION_USAGE,
  parseApplicationArguments,
} from './cli/arguments.js';
import { loadProfilesFromCsv } from './data/csvdata.js';
import type { ImportedCsvData } from './data/csvdata.js';
import { loadFullEvaluationCriteria } from './evaluation/index.js';
import { createFileLogger } from './logging/index.js';
import type { Logger } from './logging/index.js';
import {
  runFullProfilePipeline,
  runReviewPipeline,
} from './pipeline/index.js';

// Resolved at startup, after dotenv has loaded; blank means absent.
const LOG_PATH = process.env['LOG_PATH']?.trim() || 'output/pipeline.log';
const IMPORTED_CSV_OUTPUT_PATH = 'output/imported-csv-profiles.json';

/** Converts an unknown application failure into a log-safe message. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Writes the normalized CSV-only import for the non-provider CLI mode. */
async function saveImportedCsvData(importedData: ImportedCsvData): Promise<void> {
  await mkdir('output', { recursive: true });
  await writeFile(
    IMPORTED_CSV_OUTPUT_PATH,
    JSON.stringify(Object.values(importedData.records), null, 2),
    'utf8',
  );
}

/**
 * Command-line entry point.
 *
 * Import only:
 *   npm start -- "test_data/profiles.csv"
 *
 * Complete Apify + image-analysis pipeline:
 *   npm run collect -- "test_data/profiles.csv"
 *   npm run collect:apify -- "test_data/profiles.csv"
 *
 * Complete collection + evaluation pipeline:
 *   npm run review -- "test_data/profiles.csv" "criteria.json"
 */
export async function main(logger: Logger): Promise<void> {
  let applicationArguments;
  try {
    applicationArguments = parseApplicationArguments(process.argv.slice(2));
  } catch (error: unknown) {
    logger.error(
      {
        error: errorMessage(error),
        usage: Object.values(APPLICATION_USAGE),
      },
      'Invalid command-line arguments.',
    );
    process.exitCode = 1;
    return;
  }

  const { csvPath } = applicationArguments;
  logger.info({ csvPath }, 'Loading Linked Helper CSV.');
  const importedData = await loadProfilesFromCsv(csvPath);

  logger.info(
    {
      totalRows: importedData.total_rows,
      totalProfiles: importedData.total_profiles,
      duplicatedProfiles: importedData.duplicated_profiles,
    },
    'Imported Linked Helper CSV.',
  );

  if (applicationArguments.mode === APPLICATION_MODE.importCsv) {
    await saveImportedCsvData(importedData);
    logger.info(
      {
        outputPath: IMPORTED_CSV_OUTPUT_PATH,
        profilesWritten: importedData.total_profiles,
      },
      'Completed CSV-only import.',
    );
    return;
  }

  if (applicationArguments.mode === APPLICATION_MODE.collectProfiles) {
    await runFullProfilePipeline(importedData, logger);
    return;
  }

  const criteria = await loadFullEvaluationCriteria(
    applicationArguments.criteriaPath,
  );
  const result = await runReviewPipeline(importedData, criteria, logger);
  logger.info(
    {
      evaluationRunId: result.evaluationRun.id,
      evaluatedProfiles:
        result.evaluationRun.evaluation.broadFilter.evaluations.length,
    },
    'Review results are available in SQLite.',
  );
}

/** Creates the run logger and guarantees its transport is closed on shutdown. */
async function runApplication(): Promise<void> {
  const runId = randomUUID();
  const loggerHandle = await createFileLogger(LOG_PATH, runId);
  const { logger } = loggerHandle;

  try {
    logger.info(
      {
        processId: process.pid,
        logPath: LOG_PATH,
      },
      'Application started.',
    );
    await main(logger);
  } catch (error: unknown) {
    logger.error(
      {
        err: error,
        error: errorMessage(error),
      },
      'Application failed.',
    );
    process.exitCode = 1;
  } finally {
    logger.info(
      {
        exitCode: process.exitCode ?? 0,
      },
      'Application stopped.',
    );
    await loggerHandle.close();
  }
}

void runApplication();
