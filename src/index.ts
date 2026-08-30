// Load local environment variables before constructing provider clients.
import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { prepRun, runPipeline } from './app.js';
import { APPLICATION_MODE, parseCliArguments } from './cli/arguments.js';
import { loadFullEvaluationCriteria } from './evaluation/index.js';
import { errorMessage } from './helpers/index.js';
import { createFileLogger } from './logging/index.js';
import { runFullProfilePipeline } from './pipeline/index.js';
import { processingPaths } from './dataCollector/processing/processing.js';

// Resolved at startup, after dotenv has loaded; blank means absent.
const LOG_PATH = process.env['LOG_PATH']?.trim() || 'output/pipeline.log';

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
export async function main(): Promise<void> {
  const runId = randomUUID();
  const loggerHandle = await createFileLogger(LOG_PATH, runId);
  const { logger } = loggerHandle;

  try {
    logger.info(
      { processId: process.pid, logPath: LOG_PATH },
      'Application started.',
    );

    const applicationArguments = parseCliArguments(logger);
    if (!applicationArguments) return;

    // Save the uploaded CSV verbatim under a processing id so the approved
    // output can later be rebuilt from its exact bytes without breaking the
    // vendor checksums.
    const id = randomUUID();
    const paths = processingPaths(id);
    const bytes = await readFile(applicationArguments.csvPath);
    const { originalPath, importedData } = await prepRun(id, bytes, logger);

    if (applicationArguments.mode === APPLICATION_MODE.importCsv) {
      logger.info(
        { originalPath, profilesImported: importedData.total_profiles },
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
    const result = await runPipeline(id, paths, criteria, logger);

    logger.info(
      {
        processingId: id,
        approvedCsvPath: result.approvedCsvPath,
        evaluationReportPath: result.evaluationReportPath,
        evaluationRunId: result.evaluationRunId,
      },
      'Completed review and wrote output artifacts.',
    );
  } catch (error: unknown) {
    logger.error(
      { err: error, error: errorMessage(error) },
      'Application failed.',
    );
    process.exitCode = 1;
  } finally {
    logger.info(
      { exitCode: process.exitCode ?? 0 },
      'Application stopped.',
    );
    await loggerHandle.close();
  }
}

void main();
