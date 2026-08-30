import { readFile } from 'node:fs/promises';

import type { ReviewPipelineResult } from '../../pipeline/index.js';
import { readRawRecords } from '../csv/csvdata.js';
import { collectApprovedPublicIds, writeApprovedCsv } from './approved_csv.js';
import { writeEvaluationReport } from './evaluation_report.js';
import type { ProcessingPaths } from './processing.js';

/** The artifact paths a completed review run produced on disk. */
export interface ReviewArtifacts {
  approvedCsvPath: string;
  evaluationReportPath: string;
}

/**
 * Writes both output files for a completed review run.
 *
 * The approved CSV is rebuilt from the saved original's exact bytes so vendor
 * checksums survive; the report is our own explanatory file. The original is
 * read here rather than passed in so callers cannot accidentally feed a
 * re-encoded copy into the byte-preserving path.
 */
export async function writeReviewArtifacts(
  originalPath: string,
  paths: ProcessingPaths,
  result: ReviewPipelineResult,
): Promise<ReviewArtifacts> {
  const originalBytes = await readFile(originalPath);
  const raw = readRawRecords(originalBytes);

  const approvedPublicIds = collectApprovedPublicIds(result.evaluationRun);
  await writeApprovedCsv(raw, approvedPublicIds, paths.approved);
  await writeEvaluationReport(
    result.profilePipeline.profiles,
    result.evaluationRun,
    paths.report,
  );

  return {
    approvedCsvPath: paths.approved,
    evaluationReportPath: paths.report,
  };
}
