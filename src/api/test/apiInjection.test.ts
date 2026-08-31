import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { API_ROUTES, CSV_CONTENT_TYPE, HTTP_STATUS } from '../constants.js';
import { buildServer } from '../index.js';
import {
  dbGetProcessingRunById,
  dbInsertEvaluationRun,
  dbInsertProcessingRun,
  openDatabase,
  PROCESSING_STATUS,
} from '../../database/index.js';
import type { StoredEvaluationRun } from '../../database/index.js';
import { processingPaths } from '../../dataCollector/processing/processing.js';

/** Builds a completed evaluation run with one approved and one review profile. */
function storedEvaluationRun(id: string): StoredEvaluationRun {
  const evaluations = [
    { publicId: 'auto-yes', decision: 'approved' as const },
    { publicId: 'review-me', decision: 'manual_review' as const },
  ].map(({ publicId, decision }) => ({
    profileId: `profile-${publicId}`,
    linkedHelperPublicId: publicId,
    decision,
    matchPercent: 80,
    estimatedTotalMonthlyCompensation: {
      status: 'insufficient_evidence' as const,
      reasons: [],
    },
    reasons: ['fits the campaign'],
    evidence: [],
    uncertainties: [],
  }));

  return {
    id,
    createdAt: '2026-01-01T00:00:00.000Z',
    criteria: { systemPrompt: 'test' },
    evaluation: {
      broadFilter: {
        profilesForAi: [],
        evaluations: evaluations.map((evaluation) => ({
          profileId: evaluation.profileId,
          linkedHelperPublicId: evaluation.linkedHelperPublicId,
          decision: 'NextPhase',
          decisionMessage: 'passed',
          results: [],
        })),
      },
      modelEvaluation: {
        requestedProfiles: evaluations.length,
        successfulProfiles: evaluations.length,
        failedProfiles: 0,
        evaluations,
        failures: [],
        tokenUsage: {
          promptTokens: 0,
          outputTokens: 0,
          thinkingTokens: 0,
          totalTokens: 0,
        },
      },
    },
  };
}

/**
 * Seeds a completed processing run with its evaluation results and retained
 * original CSV, so the decisions and results routes can be driven directly.
 */
async function seedCompletedRun(processingId: string): Promise<void> {
  const paths = processingPaths(processingId);
  await mkdir(paths.dir, { recursive: true });
  await writeFile(
    paths.original,
    Buffer.from(
      '﻿public_id;full_name\r\nauto-yes;Ada\r\nreview-me;Bob\r\n',
      'utf-8',
    ),
  );

  const db = openDatabase();
  try {
    const evaluationRunId = `evaluation-${processingId}`;
    dbInsertEvaluationRun(storedEvaluationRun(evaluationRunId), db);
    dbInsertProcessingRun(
      {
        id: processingId,
        status: PROCESSING_STATUS.completed,
        originalCsvPath: paths.original,
        approvedCsvPath: paths.approved,
        evaluationReportPath: paths.report,
        evaluationRunId,
        createdAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:10:00.000Z',
      },
      db,
    );
  } finally {
    db.close();
  }
}

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

test('POST /run_filter rejects a completed run with a conflict', async () => {
  const databasePath = join(tmpdir(), `api-test-${randomUUID()}.sqlite`);
  process.env['DATABASE_PATH'] = databasePath;
  const processingId = randomUUID();

  try {
    await seedCompletedRun(processingId);
    const app = await buildServer();

    const response = await app.inject({
      method: 'POST',
      url: API_ROUTES.review,
      payload: { processingId },
    });

    assert.equal(response.statusCode, HTTP_STATUS.conflict);
  } finally {
    await rm(processingPaths(processingId).dir, { recursive: true, force: true });
    await rm(databasePath, { force: true });
    delete process.env['DATABASE_PATH'];
  }
});

test('POST decisions applies overrides and rebuilds the approved CSV', async () => {
  const databasePath = join(tmpdir(), `api-test-${randomUUID()}.sqlite`);
  process.env['DATABASE_PATH'] = databasePath;
  const processingId = randomUUID();

  try {
    await seedCompletedRun(processingId);
    const app = await buildServer();

    const response = await app.inject({
      method: 'POST',
      url: API_ROUTES.decisions.replace(':processingId', processingId),
      payload: {
        overrides: [
          { publicId: 'review-me', decision: 'approved', reason: 'verified manually' },
          { publicId: 'auto-yes', decision: 'rejected' },
        ],
      },
    });

    assert.equal(response.statusCode, HTTP_STATUS.ok);
    const result = response.json() as { finalApprovedCount: number };
    assert.equal(result.finalApprovedCount, 1);

    // The stored run remembers the overrides for later re-submission.
    const db = openDatabase();
    try {
      const run = dbGetProcessingRunById(processingId, db);
      assert.equal(run?.manualOverrides?.length, 2);
    } finally {
      db.close();
    }
  } finally {
    await rm(processingPaths(processingId).dir, { recursive: true, force: true });
    await rm(databasePath, { force: true });
    delete process.env['DATABASE_PATH'];
  }
});

test('GET results returns per-profile decisions as JSON', async () => {
  const databasePath = join(tmpdir(), `api-test-${randomUUID()}.sqlite`);
  process.env['DATABASE_PATH'] = databasePath;
  const processingId = randomUUID();

  try {
    await seedCompletedRun(processingId);
    const app = await buildServer();

    const response = await app.inject({
      method: 'GET',
      url: API_ROUTES.results.replace(':processingId', processingId),
    });

    assert.equal(response.statusCode, HTTP_STATUS.ok);
    const body = response.json() as {
      results: Array<{ publicId: string; modelDecision?: string }>;
    };
    assert.equal(body.results.length, 2);
    assert.deepEqual(
      body.results.map((entry) => [entry.publicId, entry.modelDecision]),
      [
        ['auto-yes', 'approved'],
        ['review-me', 'manual_review'],
      ],
    );
  } finally {
    await rm(processingPaths(processingId).dir, { recursive: true, force: true });
    await rm(databasePath, { force: true });
    delete process.env['DATABASE_PATH'];
  }
});
