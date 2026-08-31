import { buildServer } from './index.js';
import {
  CLEANUP_INTERVAL_MS,
  DEFAULT_PORT,
  DEFAULT_PROCESSING_TTL_HOURS,
  PROCESSING_TTL_ENVIRONMENT_KEY,
} from './constants.js';
import { cleanupExpiredRuns } from '../dataCollector/processing/cleanup.js';
import { dbFailInterruptedRuns, openDatabase } from '../database/index.js';
import type { FastifyInstance } from 'fastify';

/** Builds the app and starts listening, exiting the process on a failed bind. */
async function startServer(): Promise<void> {
    const app = await buildServer();
    const host = getHostFromEnv();

    recoverInterruptedRuns(app);
    startCleanupSchedule(app);

    app.listen(
      { port: getPortFromEnv(), ...(host ? { host } : {}) },
      (error, address) => {
        if (error) {
          app.log.error(error);
          process.exit(1);
        }
        app.log.info(`Server is running on ${address}`);
      },
    );
}

/**
 * Fails every run left as running by a previous process.
 *
 * Only this process executes pipelines, so a running row at startup belongs
 * to a run that died with the last process. Failing it keeps the retained
 * original CSV retryable through the filter route.
 */
function recoverInterruptedRuns(app: FastifyInstance): void {
  const db = openDatabase();
  try {
    const recovered = dbFailInterruptedRuns(db);
    if (recovered > 0) {
      app.log.warn({ recovered }, 'Marked interrupted runs as failed.');
    }
  } finally {
    db.close();
  }
}

/**
 * Runs the retention cleanup now and repeats it on a fixed interval.
 *
 * The timer is unreferenced so it never keeps the process alive on its own.
 */
function startCleanupSchedule(app: FastifyInstance): void {
  const ttlHours = getTtlHoursFromEnv();

  const sweep = async (): Promise<void> => {
    const db = openDatabase();
    try {
      const expired = await cleanupExpiredRuns(ttlHours, db);
      if (expired > 0) {
        app.log.info({ expired, ttlHours }, 'Expired old processing runs.');
      }
    } catch (error) {
      app.log.error({ err: error }, 'Cleanup pass failed.');
    } finally {
      db.close();
    }
  };

  void sweep();
  setInterval(() => void sweep(), CLEANUP_INTERVAL_MS).unref();
}

/** Reads the retention window from the environment, falling back to the default. */
function getTtlHoursFromEnv(): number {
  const ttl = process.env[PROCESSING_TTL_ENVIRONMENT_KEY]?.trim();
  const parsed = ttl ? Number.parseInt(ttl, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_PROCESSING_TTL_HOURS;
}
  
void startServer();

  
/** Reads the port from the environment, falling back to the default. */
function getPortFromEnv(): number {
  const port = process.env['PORT']?.trim();
  return port ? Number.parseInt(port, 10) : DEFAULT_PORT;
}

/**
 * Reads the optional bind address from the environment.
 *
 * An empty value leaves the host unset so Fastify binds to localhost, which
 * only accepts local connections. Deployments that must accept external
 * connections set HOST (for example 0.0.0.0 inside a container).
 */
function getHostFromEnv(): string | undefined {
  return process.env['HOST']?.trim() || undefined;
}

