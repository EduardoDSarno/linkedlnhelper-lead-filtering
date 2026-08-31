import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { rm } from 'node:fs/promises';
import test from 'node:test';

import { cleanupExpiredRuns } from '../cleanup.js';
import { processingPaths } from '../processing.js';
import {
  dbGetProcessingRunById,
  dbInsertProcessingRun,
  openDatabase,
  PROCESSING_STATUS,
} from '../../../database/index.js';

/** Reports whether a path exists on disk. */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test('cleanupExpiredRuns removes old run files and marks the run expired', async () => {
  const db = openDatabase(':memory:');
  const oldId = 'cleanup-old-run';
  const freshId = 'cleanup-fresh-run';
  const oldPaths = processingPaths(oldId);
  const freshPaths = processingPaths(freshId);

  try {
    for (const paths of [oldPaths, freshPaths]) {
      await mkdir(paths.dir, { recursive: true });
      await writeFile(paths.original, 'csv-bytes');
    }

    dbInsertProcessingRun(
      {
        id: oldId,
        status: PROCESSING_STATUS.completed,
        originalCsvPath: oldPaths.original,
        approvedCsvPath: oldPaths.approved,
        evaluationReportPath: oldPaths.report,
        createdAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:10:00.000Z',
      },
      db,
    );
    dbInsertProcessingRun(
      {
        id: freshId,
        status: PROCESSING_STATUS.completed,
        originalCsvPath: freshPaths.original,
        createdAt: '2026-01-01T00:00:00.000Z',
        completedAt: new Date().toISOString(),
      },
      db,
    );

    const expired = await cleanupExpiredRuns(1, db);

    assert.equal(expired, 1);
    assert.equal(await exists(oldPaths.dir), false);
    assert.equal(await exists(freshPaths.original), true);

    const oldRun = dbGetProcessingRunById(oldId, db);
    assert.equal(oldRun?.status, PROCESSING_STATUS.expired);
    assert.equal(oldRun?.approvedCsvPath, undefined);
    assert.equal(
      dbGetProcessingRunById(freshId, db)?.status,
      PROCESSING_STATUS.completed,
    );
  } finally {
    db.close();
    await rm(oldPaths.dir, { recursive: true, force: true });
    await rm(freshPaths.dir, { recursive: true, force: true });
  }
});
