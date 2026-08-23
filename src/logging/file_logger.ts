import { once } from 'node:events';

import pino from 'pino';
import type { Logger as PinoLogger } from 'pino';

const DEFAULT_LOGGER_SERVICE_NAME = 'linkedin-profile-pipeline';

export type Logger = PinoLogger;

export interface FileLoggerHandle {
  logger: Logger;
  close(): Promise<void>;
}

/**
 * Creates the application's structured JSON logger.
 *
 * Pino writes through its file transport on a worker thread. The returned
 * lifecycle handle must be closed during shutdown so buffered records reach
 * the log file before the process exits.
 *
 * @param path - Destination for newline-delimited JSON log records.
 * @param runId - Correlation ID included in every record for this execution.
 * @param service - Service name distinguishing the producing application flow.
 * @returns The logger and an asynchronous transport shutdown function.
 */
export async function createFileLogger(
  path: string,
  runId: string,
  service: string = DEFAULT_LOGGER_SERVICE_NAME,
): Promise<FileLoggerHandle> {
  const transport = pino.transport({
    target: 'pino/file',
    options: {
      destination: path,
      mkdir: true,
      append: true,
    },
  });

  await once(transport, 'ready');

  const logger = pino(
    {
      level: process.env['LOG_LEVEL']?.trim() || 'info',
      base: {
        service,
        runId,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: {
        paths: [
          'apiKey',
          '*.apiKey',
          'token',
          '*.token',
          'APIFY_API_KEY',
          'GEMINI_API_KEY',
        ],
        censor: '[REDACTED]',
      },
    },
    transport,
  );

  return {
    logger,

    /** Flushes buffered records and closes the Pino file transport. */
    async close(): Promise<void> {
      const finished = once(transport, 'finish');
      transport.end();
      await finished;
    },
  };
}
