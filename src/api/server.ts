import Fastify, { type FastifyInstance } from 'fastify';

import {
  CONFIG_NUMBER_MINIMUMS,
  resolveConfigNumber,
} from '../shared/helpers/index.js';

/** Port used when the PORT environment variable is absent or unusable. */
const DEFAULT_PORT = 3000;

/** Highest valid TCP port. */
const MAXIMUM_PORT = 65_535;

/**
 * Builds the app with every route registered, without starting to listen.
 *
 * Kept apart from `startServer` so a test can call routes in memory with
 * Fastify's `inject`, without opening a real port.
 */
export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });
  registerPingRoute(app);
  return app;
}

/**
 * Builds the app and starts listening on the configured port.
 *
 * A failed start (most often a port already in use) exits the process with
 * an error code, so whatever launched it sees the failure instead of a server
 * that silently never came up.
 */
async function startServer(): Promise<void> {
  const app = buildServer();

  try {
    await app.listen({ port: resolvePort() });
  } catch (error: unknown) {
    app.log.error(error);
    process.exit(1);
  }
}

/** A route that only proves the server is up and answering. */
function registerPingRoute(app: FastifyInstance): void {
  app.get('/api/ping', async () => ({ message: 'Pong' }));
}

/**
 * Reads the port from the environment, falling back to the default.
 *
 * Environment values always arrive as strings; a blank, non-numeric, or
 * out-of-range value uses the default rather than failing to start.
 */
function resolvePort(environment: NodeJS.ProcessEnv = process.env): number {
  return resolveConfigNumber(environment['PORT'], {
    fallback: DEFAULT_PORT,
    minimum: CONFIG_NUMBER_MINIMUMS.positive,
    maximum: MAXIMUM_PORT,
    integer: true,
  });
}

await startServer();
