import { PIPELINE_PROGRESS_MESSAGE } from '../logging/index.js';
import type { Logger } from '../logging/index.js';
import { asRecord } from '../helpers/index.js';

/** The stage a run is currently working through. */
export const RUN_PROGRESS_STAGE = {
  collecting: 'collecting',
  loadingPhotos: 'loading_photos',
  evaluating: 'evaluating',
} as const;

export type RunProgressStage =
  (typeof RUN_PROGRESS_STAGE)[keyof typeof RUN_PROGRESS_STAGE];

/** How far one run has got, as the status route reports it. */
export interface RunProgress {
  stage: RunProgressStage;
  completed: number;
  total: number;
}

/**
 * Live progress per run, held only in memory.
 *
 * The API process runs the pipeline itself, so progress is only meaningful
 * while that process is alive. A restart marks every running row failed
 * anyway (dbFailInterruptedRuns), so progress that dies with the process
 * matches the run's real lifetime — and this avoids a database write on every
 * completed batch.
 */
const progressByRun = new Map<string, RunProgress>();

/** Reads one run's progress, or undefined before its first reported stage. */
export function runProgress(processingId: string): RunProgress | undefined {
  return progressByRun.get(processingId);
}

/** Drops a finished run's progress so the map does not grow without bound. */
export function clearRunProgress(processingId: string): void {
  progressByRun.delete(processingId);
}

/** Reads a non-negative integer field from a log payload. */
function count(payload: Record<string, unknown>, field: string): number | undefined {
  const value = payload[field];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Derives a progress update from one log line, or undefined when it says
 * nothing about progress.
 *
 * Every count here is already produced by the pipeline for its own logs, so
 * reading them costs nothing and needs no changes to the stages themselves.
 */
function progressFromLog(
  message: string,
  payload: Record<string, unknown>,
  current: RunProgress | undefined,
): RunProgress | undefined {
  switch (message) {
    case PIPELINE_PROGRESS_MESSAGE.apifyStarted:
      return {
        stage: RUN_PROGRESS_STAGE.collecting,
        completed: 0,
        total: count(payload, 'requestedProfiles') ?? 0,
      };

    case PIPELINE_PROGRESS_MESSAGE.apifyRoundProgress:
      return {
        stage: RUN_PROGRESS_STAGE.collecting,
        completed: count(payload, 'completed') ?? current?.completed ?? 0,
        total: count(payload, 'total') ?? current?.total ?? 0,
      };

    case PIPELINE_PROGRESS_MESSAGE.photoLoadStarted:
      return {
        stage: RUN_PROGRESS_STAGE.loadingPhotos,
        completed: 0,
        total: count(payload, 'photos') ?? 0,
      };

    case PIPELINE_PROGRESS_MESSAGE.evalStarted:
      return {
        stage: RUN_PROGRESS_STAGE.evaluating,
        completed: 0,
        total: count(payload, 'requestedProfiles') ?? 0,
      };

    // Groups finish out of order and in parallel, so progress accumulates
    // rather than reading a position from the line itself.
    case PIPELINE_PROGRESS_MESSAGE.evalGroupCompleted: {
      const scored = count(payload, 'scoredProfiles') ?? 0;
      const failed = count(payload, 'failedProfiles') ?? 0;
      return {
        stage: RUN_PROGRESS_STAGE.evaluating,
        completed: (current?.completed ?? 0) + scored + failed,
        total: current?.total ?? 0,
      };
    }

    default:
      return undefined;
  }
}

/**
 * Wraps a logger so progress lines update this run's status on their way past.
 *
 * Watching the logger keeps the collector, photo loader and evaluator unaware
 * of progress reporting: they already log these counts, and every line is
 * forwarded unchanged to the real logger.
 */
export function progressReportingLogger(
  processingId: string,
  logger: Logger,
): Logger {
  const info: Logger['info'] = (...args: Parameters<Logger['info']>) => {
    const [first, second] = args;
    const payload = asRecord(first);
    const message = typeof second === 'string' ? second : undefined;

    if (payload && message) {
      const update = progressFromLog(
        message,
        payload,
        progressByRun.get(processingId),
      );
      if (update) progressByRun.set(processingId, update);
    }

    return logger.info(...args);
  };

  return Object.assign(Object.create(logger) as Logger, { info });
}
