import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import pino from 'pino';
import type { Kysely } from 'kysely';

import { connectToDb } from '../db/client.js';
import type { Database } from '../db/schema.js';
import { createLinkedinClient } from '../linkedin/client.js';
import type { LinkedinClient } from '../linkedin/client.js';
import { createPipelineContext } from '../pipeline/steps.js';
import {
  CONFIG_NUMBER_MINIMUMS,
  resolveConfigNumber,
} from '../shared/helpers/index.js';
import { registerAgentChatRoutes } from './agentChat.js';
import { registerAuthRoutes, requireUser } from './auth.js';
import { getWebhookSecret } from './config.js';
import { HTTP_NOT_FOUND } from './consts.js';
import { registerCampaignRoutes } from './campaigns.js';
import { registerLeadRoutes } from './leads.js';
import { registerLinkedinAccountRoutes } from './linkedinAccounts.js';
import { registerUnipileWebhooks } from './webhooks/unipile/webhook.js';

/** Port used when the PORT environment variable is absent or unusable. */
const DEFAULT_PORT = 3000;

/** Highest valid TCP port. */
const MAXIMUM_PORT = 65_535;

/** The built web app (`npm run build:web`), served when it exists. */
const WEB_DIST_DIRECTORY = fileURLToPath(new URL('../../web/dist/', import.meta.url));

/**
 * Builds the app with every route registered, without starting to listen.
 *
 * Kept apart from `startServer` so a test can call routes in memory with
 * Fastify's `inject`, without opening a real port. Public routes (login,
 * webhooks) sit at the top level; everything else is registered inside a
 * scope whose pre-handler refuses requests without a valid session.
 */
export async function buildServer(
  db: Kysely<Database>,
  environment: NodeJS.ProcessEnv = process.env,
  linkedin: LinkedinClient = createLinkedinClient(environment),
): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  app.decorateRequest('user', null);
  await app.register(cookie);

  app.get('/api/ping', async () => ({ message: 'Pong' }));
  registerAuthRoutes(app, db, environment);
  // Webhooks only exist in Unipile mode, so fake mode needs no webhook secret.
  if (linkedin.mode === 'unipile') {
    registerUnipileWebhooks(app, db, getWebhookSecret(environment));
  }

  await app.register(async (protectedScope) => {
    protectedScope.addHook('preHandler', requireUser(db));
    registerLinkedinAccountRoutes(protectedScope, db, linkedin, environment);
    registerCampaignRoutes(protectedScope, db, linkedin);
    registerLeadRoutes(protectedScope, db);
    registerAgentChatRoutes(protectedScope, createPipelineContext(db, linkedin, pino(), environment));
  });

  await serveWebApp(app);
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
  const db = await connectToDb();
  const app = await buildServer(db);
  try {
    await app.listen({ port: resolvePort() });
  } catch (error: unknown) {
    app.log.error(error);
    process.exit(1);
  }
}

/**
 * Serves the built web app, sending `index.html` for any non-API page so the
 * app's own router handles addresses like `/campaigns/3`. Skipped when the app
 * has not been built: in development Vite serves it instead.
 */
async function serveWebApp(app: FastifyInstance): Promise<void> {
  if (!existsSync(WEB_DIST_DIRECTORY)) return;

  await app.register(fastifyStatic, { root: WEB_DIST_DIRECTORY });
  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && !request.url.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    return reply.code(HTTP_NOT_FOUND).send({ error: 'Not found' });
  });
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startServer();
}
