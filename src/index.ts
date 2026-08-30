// Load local environment variables before constructing provider clients.
import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';

import {
  APPLICATION_MODE,
  APPLICATION_USAGE,
  parseApplicationArguments,
} from './cli/arguments.js';
import { loadProfilesFromCsv } from './dataCollector/csv/csvdata.js';
import type { ImportedCsvData } from './dataCollector/csv/csvdata.js';
import {
  dbInsertProcessingRun,
  dbUpdateProcessingRun,
  openDatabase,
  PROCESSING_STATUS,
} from './database/index.js';
import { loadFullEvaluationCriteria } from './evaluation/index.js';
import { createFileLogger } from './logging/index.js';
import type { Logger } from './logging/index.js';
import {
  runFullProfilePipeline,
  runReviewPipeline,
} from './pipeline/index.js';
import {
  processingPaths,
  saveOriginalCsv,
} from './dataCollector/processing/processing.js';
import type { ProcessingPaths } from './dataCollector/processing/processing.js';
import { writeReviewArtifacts } from './dataCollector/processing/review_artifacts.js';

// Resolved at startup, after dotenv has loaded; blank means absent.
const LOG_PATH = process.env['LOG_PATH']?.trim() || 'output/pipeline.log';

/** Converts an unknown application failure into a log-safe message. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

  // Save the uploaded CSV verbatim under a processing id so the approved output
  // can later be rebuilt from its exact bytes without breaking vendor checksums.
  const id = randomUUID();
  const paths = processingPaths(id);
  const { csvPath } = applicationArguments;
  const bytes = await readFile(csvPath);
  const { originalPath } = await saveOriginalCsv(id, bytes);

  logger.info({ originalPath }, 'Saved original CSV.');
  logger.info({ csvPath }, 'Loading Linked Helper CSV.');
  const importedData = await loadProfilesFromCsv(originalPath);

  logger.info(
    {
      totalRows: importedData.total_rows,
      totalProfiles: importedData.total_profiles,
      duplicatedProfiles: importedData.duplicated_profiles,
    },
    'Imported Linked Helper CSV.',
  );

  if (applicationArguments.mode === APPLICATION_MODE.importCsv) {
    logger.info(
      {
        originalPath,
        profilesImported: importedData.total_profiles,
      },
      'Completed CSV-only import.',
    );
    return;
  }

  if (applicationArguments.mode === APPLICATION_MODE.collectProfiles) {
    await runFullProfilePipeline(importedData, logger);
    return;
  }

  await runReviewMode(
    id,
    paths,
    importedData,
    applicationArguments.criteriaPath,
    logger,
  );
}

/**
 * Runs the review pipeline, writes both output artifacts, and tracks the
 * processing run's status in SQLite.
 *
 * The original CSV is deleted only after both artifacts are written and the
 * completed status is recorded. A failure leaves the original in place so the
 * run can be inspected or retried, and is re-thrown for the top-level handler.
 */
async function runReviewMode(
  id: string,
  paths: ProcessingPaths,
  importedData: ImportedCsvData,
  criteriaPath: string,
  logger: Logger,
): Promise<void> {
  const createdAt = new Date().toISOString();
  const baseRun = { id, originalCsvPath: paths.original, createdAt };

  recordProcessingRun(
    (db) =>
      dbInsertProcessingRun(
        { ...baseRun, status: PROCESSING_STATUS.running },
        db,
      ),
  );

  try {
    const criteria = await loadFullEvaluationCriteria(criteriaPath);
    const result = await runReviewPipeline(importedData, criteria, logger);
    const artifacts = await writeReviewArtifacts(paths.original, paths, result);

    recordProcessingRun((db) =>
      dbUpdateProcessingRun(
        {
          ...baseRun,
          status: PROCESSING_STATUS.completed,
          approvedCsvPath: artifacts.approvedCsvPath,
          evaluationReportPath: artifacts.evaluationReportPath,
          evaluationRunId: result.evaluationRun.id,
          completedAt: new Date().toISOString(),
        },
        db,
      ),
    );

    // Both artifacts are written and recorded, so the original is safe to drop.
    await rm(paths.original, { force: true });

    logger.info(
      {
        processingId: id,
        approvedCsvPath: artifacts.approvedCsvPath,
        evaluationReportPath: artifacts.evaluationReportPath,
        evaluationRunId: result.evaluationRun.id,
      },
      'Completed review and wrote output artifacts.',
    );
  } catch (error: unknown) {
    recordProcessingRun((db) =>
      dbUpdateProcessingRun(
        {
          ...baseRun,
          status: PROCESSING_STATUS.failed,
          error: errorMessage(error),
          completedAt: new Date().toISOString(),
        },
        db,
      ),
    );
    throw error;
  }
}

/** Opens the database for one short status write and always closes it. */
function recordProcessingRun(
  write: (db: ReturnType<typeof openDatabase>) => unknown,
): void {
  const db = openDatabase();
  try {
    write(db);
  } finally {
    db.close();
  }
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
