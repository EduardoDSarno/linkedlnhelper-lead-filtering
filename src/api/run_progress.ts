import { PIPELINE_PROGRESS_MESSAGE } from '../logging/index.js';
import type { Logger } from '../logging/index.js';
import { asRecord } from '../helpers/index.js';

/** The stage a run is currently working through. */
const RUN_PROGRESS_STAGE = {
  loadingPhotos: 'loading_photos',
  evaluating: 'evaluating',
} as const;

type RunProgressStage =
  (typeof RUN_PROGRESS_STAGE)[keyof typeof RUN_PROGRESS_STAGE];

/**
 * Where each stage sits on one continuous 0-1 bar.
 *
 * Split by how long each stage actually takes rather than evenly: photo
 * downloads are a small fraction of the time evaluation takes, so an even
 * split would race through photos and then crawl through evaluation.
 */
const STAGE_SPAN: Record<RunProgressStage, { from: number; to: number }> = {
  [RUN_PROGRESS_STAGE.loadingPhotos]: { from: 0, to: 0.2 },
  [RUN_PROGRESS_STAGE.evaluating]: { from: 0.2, to: 1 },
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

  /**
   * Whether the run is in the follow-up round for profiles that did not score.
   *
   * That round re-requests only the stragglers, so the bar barely moves while
   * it runs and a finished-looking run appears to hang. The flag lets the
   * screen say what is happening instead.
   */
  retrying?: boolean;
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

/**
 * Moves the evaluating stage forward by profiles that just settled.
 *
 * Groups land out of order and in parallel, so the bar accumulates what each
 * line reports rather than reading a position from it, and never runs past the
 * stage total.
 */
function advancedBy(
  current: RunProgress | undefined,
  settledProfiles: number,
): RunProgress {
  const total = current?.total ?? 0;
  const completed = Math.min(
    total || Number.MAX_SAFE_INTEGER,
    (current?.completed ?? 0) + settledProfiles,
  );

  return progressAt(
    RUN_PROGRESS_STAGE.evaluating,
    completed,
    total,
    current?.retrying ?? false,
  );
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
  retrying = false,
): RunProgress {
  return {
    stage,
    completed,
    total,
    overall: overallFor(stage, completed, total),
    ...(retrying ? { retrying: true } : {}),
  };
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
      return advancedBy(current, scored + failed);
    }

    // A rejected group scores nobody, so it reports on the failure line
    // instead. Its profiles are still settled, and leaving them uncounted
    // would strand the bar short of full for the rest of the run.
    case PIPELINE_PROGRESS_MESSAGE.evalGroupFailed: {
      const ids = payload['profileIds'];
      return advancedBy(current, Array.isArray(ids) ? ids.length : 0);
    }

    // The follow-up round re-requests only the profiles that never scored,
    // which the primary pass already counted. Hold the bar where it is and
    // mark the run as retrying so the screen can explain the pause.
    case PIPELINE_PROGRESS_MESSAGE.evalRetryStarted:
      return progressAt(
        RUN_PROGRESS_STAGE.evaluating,
        current?.completed ?? 0,
        current?.total ?? 0,
        true,
      );

    default:
      return undefined;
  }
}

/**
 * Wraps a logger so progress lines update this run's status on their way past.
 *
 * Watching the logger keeps the photo loader and evaluator unaware
 * of progress reporting: they already log these counts, and every line is
 * forwarded unchanged to the real logger.
 */
export function progressReportingLogger(
  processingId: string,
  logger: Logger,
): Logger {
  const watch = (args: unknown[]): void => {
    const [first, second] = args;
    const payload = asRecord(first);
    const message = typeof second === 'string' ? second : undefined;
    if (!payload || !message) return;

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
  };

  const info: Logger['info'] = (...args: Parameters<Logger['info']>) => {
    watch(args);
    return logger.info(...args);
  };

  // A whole group that never scored reports at warn level, and its profiles
  // are as settled as any scored group's. Watching only info would leave them
  // uncounted and strand the bar short of full.
  const warn: Logger['warn'] = (...args: Parameters<Logger['warn']>) => {
    watch(args);
    return logger.warn(...args);
  };

  return Object.assign(Object.create(logger) as Logger, { info, warn });
}
