import { once } from 'node:events';

import pino from 'pino';
import type { Logger as PinoLogger } from 'pino';

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
 */
export async function createFileLogger(
  path: string,
  runId: string,
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
        service: 'linkedin-profile-pipeline',
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
    async close(): Promise<void> {
      const finished = once(transport, 'finish');
      transport.end();
      await finished;
    },
  };
}
