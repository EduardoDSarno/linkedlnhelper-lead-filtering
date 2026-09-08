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

/**
 * Where each stage sits on one continuous 0-1 bar.
 *
 * Split by how long each stage actually takes rather than evenly: on a
 * 604-profile run, collection and photo downloads together took under half
 * the time evaluation did, so an even three-way split would crawl through
 * evaluation and race through the rest.
 */
const STAGE_SPAN: Record<RunProgressStage, { from: number; to: number }> = {
  [RUN_PROGRESS_STAGE.collecting]: { from: 0, to: 0.3 },
  [RUN_PROGRESS_STAGE.loadingPhotos]: { from: 0.3, to: 0.45 },
  [RUN_PROGRESS_STAGE.evaluating]: { from: 0.45, to: 1 },
};

/** How far one run has got, as the status route reports it. */
export interface RunProgress {
  stage: RunProgressStage;
  /** Items finished within the current stage. */
  completed: number;
  /** Items the current stage will process in total. */
  total: number;
  /** Position on the single overall bar, 0-1 across every stage. */
  overall: number;
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

/** Reads a non-negative finite number from a log payload. */
function count(payload: Record<string, unknown>, field: string): number | undefined {
  const value = payload[field];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

/** Places a stage's own completed/total onto the single overall bar. */
function overallFor(
  stage: RunProgressStage,
  completed: number,
  total: number,
): number {
  const span = STAGE_SPAN[stage];
  const withinStage = total > 0 ? Math.min(1, completed / total) : 0;
  return span.from + (span.to - span.from) * withinStage;
}

/** Builds one progress snapshot, keeping the overall position in step. */
function progressAt(
  stage: RunProgressStage,
  completed: number,
  total: number,
): RunProgress {
  return { stage, completed, total, overall: overallFor(stage, completed, total) };
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
      return progressAt(
        RUN_PROGRESS_STAGE.collecting,
        0,
        count(payload, 'requestedProfiles') ?? 0,
      );

    // Batch completions, not round completions: a round only reports once
    // every batch in it has already settled, which on a run with no retries
    // means a single report at the very end. Batches report as they land.
    case PIPELINE_PROGRESS_MESSAGE.apifyBatchCompleted: {
      const batchesDone = count(payload, 'completed') ?? 0;
      const batchesTotal = count(payload, 'total') ?? 0;
      const profilesTotal =
        count(payload, 'runRequestedProfiles') ?? current?.total ?? 0;
      const profilesDone =
        batchesTotal > 0
          ? Math.min(
              profilesTotal,
              Math.round((batchesDone / batchesTotal) * profilesTotal),
            )
          : 0;
      return progressAt(
        RUN_PROGRESS_STAGE.collecting,
        profilesDone,
        profilesTotal,
      );
    }

    case PIPELINE_PROGRESS_MESSAGE.photoLoadStarted:
      return progressAt(
        RUN_PROGRESS_STAGE.loadingPhotos,
        0,
        count(payload, 'photos') ?? 0,
      );

    case PIPELINE_PROGRESS_MESSAGE.photoLoadProgress:
      return progressAt(
        RUN_PROGRESS_STAGE.loadingPhotos,
        count(payload, 'completed') ?? current?.completed ?? 0,
        count(payload, 'total') ?? current?.total ?? 0,
      );

    case PIPELINE_PROGRESS_MESSAGE.evalStarted:
      return progressAt(
        RUN_PROGRESS_STAGE.evaluating,
        0,
        count(payload, 'requestedProfiles') ?? 0,
      );

    // Groups finish out of order and in parallel, so progress accumulates
    // rather than reading a position from the line itself.
    case PIPELINE_PROGRESS_MESSAGE.evalGroupCompleted: {
      const scored = count(payload, 'scoredProfiles') ?? 0;
      const failed = count(payload, 'failedProfiles') ?? 0;
      const total = current?.total ?? 0;
      const completed = Math.min(
        total || Number.MAX_SAFE_INTEGER,
        (current?.completed ?? 0) + scored + failed,
      );
      return progressAt(RUN_PROGRESS_STAGE.evaluating, completed, total);
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
      // Never let the bar move backwards: stages overlap slightly in the
      // logs, and a late line from a finished stage would otherwise undo
      // progress the next stage has already reported.
      const existing = progressByRun.get(processingId);
      if (update && (!existing || update.overall >= existing.overall)) {
        progressByRun.set(processingId, update);
      }
    }

    return logger.info(...args);
  };

  return Object.assign(Object.create(logger) as Logger, { info });
}
