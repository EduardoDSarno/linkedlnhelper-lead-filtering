import type { Logger } from '../logging/index.js';

/** A logger that discards output but keeps every line for assertions. */
export interface RecordingLogger extends Logger {
  entries: { level: string; payload: unknown; message: string }[];
}

/**
 * Builds a logger that records instead of writing anywhere.
 *
 * Stages report progress and failures through the logger they are handed, so
 * recording it lets a test assert on what a stage said as well as on what it
 * returned, without touching the filesystem.
 */
export function recordingLogger(): RecordingLogger {
  const entries: RecordingLogger['entries'] = [];
  const record =
    (level: string) =>
    (payload: unknown, message?: string): void => {
      entries.push({ level, payload, message: message ?? '' });
    };

  const logger = {
    entries,
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    debug: record('debug'),
    fatal: record('fatal'),
    trace: record('trace'),
  };

  return logger as unknown as RecordingLogger;
}
