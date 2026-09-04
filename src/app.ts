import { loadProfilesFromCsv } from './dataCollector/csv/csvdata.js';
import type { ImportedCsvData } from './dataCollector/csv/csvdata.js';
import {
  dbInsertProcessingRun,
  dbUpdateProcessingRun,
  openDatabase,
  PROCESSING_STATUS,
} from './database/index.js';
import { saveOriginalCsv } from './dataCollector/processing/processing.js';
import type { ProcessingPaths } from './dataCollector/processing/processing.js';
import { writeReviewArtifacts } from './dataCollector/processing/review_artifacts.js';
import type { FullEvaluationCriteria } from './evaluation/index.js';
import { errorMessage } from './helpers/index.js';
import type { Logger } from './logging/index.js';
import { runReviewPipeline } from './pipeline/index.js';

/**
 * Saves the uploaded CSV verbatim under the processing id and parses a copy for
 * the pipeline, reporting the row and profile counts.
 *
 * Takes the bytes rather than a file path so both the CLI (which reads a file)
 * and the API (which receives an upload body) can reuse it unchanged.
 */
export async function prepRun(
  id: string,
  bytes: Buffer,
  logger: Logger,
): Promise<{ originalPath: string; importedData: ImportedCsvData }> {
  const { originalPath } = await saveOriginalCsv(id, bytes);
  logger.info({ originalPath }, 'Saved original CSV.');

  const importedData = await loadProfilesFromCsv(originalPath);
  logger.info(
    {
      totalRows: importedData.total_rows,
      totalProfiles: importedData.total_profiles,
      duplicatedProfiles: importedData.duplicated_profiles,
    },
    'Imported Linked Helper CSV.',
  );

  return { originalPath, importedData };
}

/** Optional review-pipeline flags that the API can pass without changing the UI. */
export interface RunPipelineOptions {
  skipCollection?: boolean;
}

/**
 * Reviews an already-saved upload and writes both output artifacts.
 *
 * Shared by the CLI and the API so the review runs identically regardless of
 * how the request arrived. The original is kept after completion so manual
 * decision overrides can rebuild the approved CSV from its exact bytes; a
 * failure also keeps it for retry and re-throws for the caller to report.
 */
export async function runPipeline(
  id: string,
  paths: ProcessingPaths,
  criteria: FullEvaluationCriteria,
  logger: Logger,
  name?: string,
  options: RunPipelineOptions = {},
): Promise<{
  approvedCsvPath: string;
  evaluationReportPath: string;
  evaluationRunId: string;
}> {
  const createdAt = new Date().toISOString();
  // Carry the campaign name through every status write so it is never wiped;
  // coalesce in the DB keeps an existing name when this call omits it.
  const baseRun = {
    id,
    originalCsvPath: paths.original,
    createdAt,
    ...(name ? { name } : {}),
  };

  recordProcessingRun(
    (db) =>
      dbInsertProcessingRun(
        { ...baseRun, status: PROCESSING_STATUS.running },
        db,
      ),
  );

  try {
    const importedData = await loadProfilesFromCsv(paths.original);
    const result = await runReviewPipeline(
      importedData,
      criteria,
      logger,
      options.skipCollection === true ? { skipCollection: true } : {},
    );
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

    // The original is deliberately kept: manual decision overrides rebuild the
    // approved CSV from its exact bytes. A later cleanup pass removes it.
    return { approvedCsvPath: artifacts.approvedCsvPath, evaluationReportPath: artifacts.evaluationReportPath, evaluationRunId: result.evaluationRun.id };

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
