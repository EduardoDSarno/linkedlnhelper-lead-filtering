import { rm } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';

import {
  dbListFinishedRunsBefore,
  dbUpdateProcessingRun,
  PROCESSING_STATUS,
} from '../../database/index.js';
import { processingPaths } from './processing.js';

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/**
 * Deletes the on-disk files of finished runs older than the retention window
 * and marks each run expired so the API reports its files as gone instead of
 * failing on a missing path.
 *
 * Expiring clears the artifact paths because the whole run directory —
 * original CSV included — is removed at once.
 */
export async function cleanupExpiredRuns(
  ttlHours: number,
  db: DatabaseSync,
): Promise<number> {
  const cutoffIso = new Date(
    Date.now() - ttlHours * MILLISECONDS_PER_HOUR,
  ).toISOString();

  const expiredRuns = dbListFinishedRunsBefore(cutoffIso, db);

  for (const run of expiredRuns) {
    await rm(processingPaths(run.id).dir, { recursive: true, force: true });

    dbUpdateProcessingRun(
      {
        id: run.id,
        status: PROCESSING_STATUS.expired,
        originalCsvPath: run.originalCsvPath,
        createdAt: run.createdAt,
        ...(run.evaluationRunId ? { evaluationRunId: run.evaluationRunId } : {}),
        ...(run.error ? { error: run.error } : {}),
        ...(run.completedAt ? { completedAt: run.completedAt } : {}),
        ...(run.manualOverrides ? { manualOverrides: run.manualOverrides } : {}),
      },
      db,
    );
  }

  return expiredRuns.length;
}
