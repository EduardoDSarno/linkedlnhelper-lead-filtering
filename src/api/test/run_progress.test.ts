import assert from 'node:assert/strict';
import test from 'node:test';

import { PIPELINE_PROGRESS_MESSAGE } from '../../logging/index.js';
import type { Logger } from '../../logging/index.js';
import { clearRunProgress, progressReportingLogger, runProgress } from '../run_progress.js';

/** A logger that records what it was asked to write. */
function recordingLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const noop = () => undefined;
  return Object.assign(
    {
      info: (_payload: unknown, message?: string) => {
        if (message) lines.push(message);
      },
      warn: noop,
      error: noop,
      debug: noop,
    } as unknown as Logger,
    { lines },
  );
}

test('advances collection on every batch, not once per round', () => {
  // A round only reports after all of its batches have settled, which on a
  // run with no retries is a single report at the very end — the bar would
  // sit at zero for the whole stage and then jump.
  const runId = 'run-collect';
  const logger = progressReportingLogger(runId, recordingLogger());

  logger.info({ requestedProfiles: 600 }, PIPELINE_PROGRESS_MESSAGE.apifyStarted);
  assert.deepEqual(runProgress(runId), {
    stage: 'collecting',
    completed: 0,
    total: 600,
    overall: 0,
  });

  logger.info(
    { completed: 3, total: 12, runRequestedProfiles: 600 },
    PIPELINE_PROGRESS_MESSAGE.apifyBatchCompleted,
  );
  const quarter = runProgress(runId);
  assert.equal(quarter?.completed, 150);
  assert.equal(quarter?.total, 600);

  logger.info(
    { completed: 6, total: 12, runRequestedProfiles: 600 },
    PIPELINE_PROGRESS_MESSAGE.apifyBatchCompleted,
  );
  assert.equal(runProgress(runId)?.completed, 300);
  clearRunProgress(runId);
});

test('advances photo loading as each download lands', () => {
  const runId = 'run-photos';
  const logger = progressReportingLogger(runId, recordingLogger());

  logger.info({ photos: 40 }, PIPELINE_PROGRESS_MESSAGE.photoLoadStarted);
  assert.equal(runProgress(runId)?.total, 40);

  logger.info({ completed: 10, total: 40 }, PIPELINE_PROGRESS_MESSAGE.photoLoadProgress);
  assert.equal(runProgress(runId)?.completed, 10);

  logger.info({ completed: 40, total: 40 }, PIPELINE_PROGRESS_MESSAGE.photoLoadProgress);
  assert.equal(runProgress(runId)?.completed, 40);
  clearRunProgress(runId);
});

test('accumulates evaluation progress across groups that finish out of order', () => {
  const runId = 'run-eval';
  const logger = progressReportingLogger(runId, recordingLogger());

  logger.info({ requestedProfiles: 557 }, PIPELINE_PROGRESS_MESSAGE.evalStarted);
  logger.info({ scoredProfiles: 3, failedProfiles: 0 }, PIPELINE_PROGRESS_MESSAGE.evalGroupCompleted);
  logger.info({ scoredProfiles: 2, failedProfiles: 1 }, PIPELINE_PROGRESS_MESSAGE.evalGroupCompleted);

  // A failed profile is still one the run finished with, so it counts.
  assert.equal(runProgress(runId)?.completed, 6);
  assert.equal(runProgress(runId)?.total, 557);
  clearRunProgress(runId);
});

test('keeps one overall position that only ever moves forward', () => {
  const runId = 'run-overall';
  const base = recordingLogger();
  const logger = progressReportingLogger(runId, base);
  const seen: number[] = [];
  const record = () => seen.push(runProgress(runId)?.overall ?? 0);

  logger.info({ requestedProfiles: 10 }, PIPELINE_PROGRESS_MESSAGE.apifyStarted);
  record();
  logger.info(
    { completed: 1, total: 2, runRequestedProfiles: 10 },
    PIPELINE_PROGRESS_MESSAGE.apifyBatchCompleted,
  );
  record();
  logger.info({ photos: 8 }, PIPELINE_PROGRESS_MESSAGE.photoLoadStarted);
  record();
  logger.info({ completed: 8, total: 8 }, PIPELINE_PROGRESS_MESSAGE.photoLoadProgress);
  record();
  logger.info({ requestedProfiles: 8 }, PIPELINE_PROGRESS_MESSAGE.evalStarted);
  record();
  logger.info({ scoredProfiles: 8, failedProfiles: 0 }, PIPELINE_PROGRESS_MESSAGE.evalGroupCompleted);
  record();

  assert.deepEqual(
    [...seen].sort((a, b) => a - b),
    seen,
    'the overall position must never move backwards',
  );
  assert.equal(seen[seen.length - 1], 1, 'a finished run reaches the end of the bar');
  assert.equal(runProgress(runId)?.stage, 'evaluating');
  assert.equal(base.lines.length, 6, 'every line must reach the real logger');
  clearRunProgress(runId);
});

test('ignores a late line from a stage that already finished', () => {
  const runId = 'run-late';
  const logger = progressReportingLogger(runId, recordingLogger());

  logger.info({ requestedProfiles: 10 }, PIPELINE_PROGRESS_MESSAGE.evalStarted);
  logger.info({ scoredProfiles: 10, failedProfiles: 0 }, PIPELINE_PROGRESS_MESSAGE.evalGroupCompleted);
  const finished = runProgress(runId)?.overall;

  // A collection line arriving after evaluation finished must not rewind.
  logger.info(
    { completed: 1, total: 9, runRequestedProfiles: 10 },
    PIPELINE_PROGRESS_MESSAGE.apifyBatchCompleted,
  );

  assert.equal(runProgress(runId)?.overall, finished);
  assert.equal(runProgress(runId)?.stage, 'evaluating');
  clearRunProgress(runId);
});

test('forgets a run once it is cleared', () => {
  const runId = 'run-cleared';
  const logger = progressReportingLogger(runId, recordingLogger());
  logger.info({ requestedProfiles: 5 }, PIPELINE_PROGRESS_MESSAGE.apifyStarted);

  clearRunProgress(runId);

  assert.equal(runProgress(runId), undefined);
});
