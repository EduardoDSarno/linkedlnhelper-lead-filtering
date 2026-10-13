import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';

import {
  CONFIG_NUMBER_MINIMUMS,
  resolveConfigNumber,
} from '../shared/helpers/index.js';
import { registerUnipileWebhooks } from './webhooks/unipile/webhook.js';
import { requireUnipileWorkspace } from '../linkedin/unipile/config.js';
import { registerLinkedinAccountRoute } from './linkedinAccounts.js';
import { getPublicUrl, getWebhookSecret } from './config.js';
import { connectToDb}       from '../db/client.js';
import type { Kysely } from 'kysely';
import type { Database } from '../db/schema.js';

/** Port used when the PORT environment variable is absent or unusable. */
const DEFAULT_PORT = 3000;

/** Highest valid TCP port. */
const MAXIMUM_PORT = 65_535;

/** Largest request body accepted; our forms are tiny, so anything bigger is refused before any route reads it. */
const MAXIMUM_BODY_BYTES = 100 * 1024;

/** Request and response parts the log hides, so cookies and tokens never reach log files. */
const LOG_REDACTED_PATHS = ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'];

/**
 * Requests one IP may make to any route per rate-limit window; generous for a
 * person using the app, low enough to stop a bot flood. Login gets its own,
 * much stricter limit.
 */
const GENERAL_REQUESTS_PER_WINDOW = 100;
const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * Builds the app with every route registered, without starting to listen.
 *
 * Kept apart from `startServer` so a test can call routes in memory with
 * Fastify's `inject`, without opening a real port. The safety plugins are
 * awaited before any route exists, so every route gets their protection.
 */
export async function buildServer(db: Kysely<Database>): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { redact: LOG_REDACTED_PATHS },
    bodyLimit: MAXIMUM_BODY_BYTES,
  });
  await app.register(helmet);
  await app.register(rateLimit, { max: GENERAL_REQUESTS_PER_WINDOW, timeWindow: RATE_LIMIT_WINDOW_MS });
  registerRoutes(app, db);
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
  const db = await connectToDb(); // Creating database connection
  const app = await buildServer(db);
  try {
    await app.listen({ port: resolvePort() });
  } catch (error: unknown) {
    app.log.error(error);
    process.exit(1);
  }
}

/** A route that only proves the server is up and answering. */
function registerRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  app.get('/api/ping', async () => ({ message: 'Pong' }));
  const webhookSecret = getWebhookSecret();
  registerUnipileWebhooks(app, db, webhookSecret);
  registerLinkedinAccountRoute(app, requireUnipileWorkspace(),
                                    getPublicUrl(),
                                    webhookSecret);
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
