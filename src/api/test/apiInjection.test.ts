import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { API_ROUTES, CSV_CONTENT_TYPE, HTTP_STATUS } from '../constants.js';
import { buildServer } from '../index.js';
import {
  dbGetProcessingRunById,
  openDatabase,
  PROCESSING_STATUS,
} from '../../database/index.js';
import { processingPaths } from '../../dataCollector/processing/processing.js';

test('POST /import stores the CSV and queues a processing run', async () => {
  // Redirect the database to a throwaway file before any connection is opened,
  // so the route's write and this test's read share it without touching the
  // real database. A temp file (not :memory:) is required because the route and
  // the test open separate connections to the same database.
  const databasePath = join(tmpdir(), `api-test-${randomUUID()}.sqlite`);
  process.env['DATABASE_PATH'] = databasePath;

  const app = await buildServer();
  const csv = Buffer.from(
    '﻿public_id;full_name\r\nabc;Ada Lovelace\r\n',
    'utf-8',
  );

  const response = await app.inject({
    method: 'POST',
    url: API_ROUTES.import,
    headers: { 'content-type': CSV_CONTENT_TYPE },
    payload: csv,
  });

  const { processingId } = response.json() as { processingId: string };

  try {
    assert.equal(response.statusCode, HTTP_STATUS.created);
    assert.ok(processingId);

    const db = openDatabase();
    try {
      const run = dbGetProcessingRunById(processingId, db);
      assert(run);
      assert.equal(run.status, PROCESSING_STATUS.queued);
      assert.equal(run.originalCsvPath, processingPaths(processingId).original);
      assert.ok(run.createdAt);
    } finally {
      db.close();
    }
  } finally {
    await rm(processingPaths(processingId).dir, {
      recursive: true,
      force: true,
    });
    await rm(databasePath, { force: true });
    delete process.env['DATABASE_PATH'];
  }
});
