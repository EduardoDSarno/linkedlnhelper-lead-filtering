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

test('reports collection progress from the counts the collector already logs', () => {
  const runId = 'run-collect';
  const logger = progressReportingLogger(runId, recordingLogger());

  logger.info({ requestedProfiles: 604 }, PIPELINE_PROGRESS_MESSAGE.apifyStarted);
  assert.deepEqual(runProgress(runId), {
    stage: 'collecting',
    completed: 0,
    total: 604,
  });

  logger.info({ completed: 412, total: 604 }, PIPELINE_PROGRESS_MESSAGE.apifyRoundProgress);
  assert.deepEqual(runProgress(runId), {
    stage: 'collecting',
    completed: 412,
    total: 604,
  });
  clearRunProgress(runId);
});

test('accumulates evaluation progress across groups that finish out of order', () => {
  const runId = 'run-eval';
  const logger = progressReportingLogger(runId, recordingLogger());

  logger.info({ requestedProfiles: 557 }, PIPELINE_PROGRESS_MESSAGE.evalStarted);
  logger.info({ scoredProfiles: 3, failedProfiles: 0 }, PIPELINE_PROGRESS_MESSAGE.evalGroupCompleted);
  logger.info({ scoredProfiles: 2, failedProfiles: 1 }, PIPELINE_PROGRESS_MESSAGE.evalGroupCompleted);

  // A failed profile is still one the run finished with, so it counts.
  assert.deepEqual(runProgress(runId), {
    stage: 'evaluating',
    completed: 6,
    total: 557,
  });
  clearRunProgress(runId);
});

test('advances the stage and forwards every line to the real logger', () => {
  const runId = 'run-stages';
  const base = recordingLogger();
  const logger = progressReportingLogger(runId, base);

  logger.info({ requestedProfiles: 10 }, PIPELINE_PROGRESS_MESSAGE.apifyStarted);
  logger.info({ photos: 8 }, PIPELINE_PROGRESS_MESSAGE.photoLoadStarted);
  assert.equal(runProgress(runId)?.stage, 'loading_photos');

  logger.info({ requestedProfiles: 8 }, PIPELINE_PROGRESS_MESSAGE.evalStarted);
  assert.equal(runProgress(runId)?.stage, 'evaluating');

  logger.info({ anything: true }, 'An unrelated line.');
  assert.equal(runProgress(runId)?.stage, 'evaluating', 'unrelated lines must not change progress');
  assert.equal(base.lines.length, 4, 'every line must reach the real logger');
  clearRunProgress(runId);
});

test('forgets a run once it is cleared', () => {
  const runId = 'run-cleared';
  const logger = progressReportingLogger(runId, recordingLogger());
  logger.info({ requestedProfiles: 5 }, PIPELINE_PROGRESS_MESSAGE.apifyStarted);

  clearRunProgress(runId);

  assert.equal(runProgress(runId), undefined);
});
