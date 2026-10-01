import type { FastifyInstance } from 'fastify';

export const ACCOUNT_CONNECTED_PATH = '/api/webhooks/unipile/account-connected';

/** Adds the route Unipile calls when a hosted login finishes. */
export function registerUnipileWebhooks(app: FastifyInstance): void 
{
  app.post(ACCOUNT_CONNECTED_PATH, async (request) => 
  {
    app.log.info({ body: request.body }, 'Unipile account connected');
    return { received: true };   // returning anything = 200
  });
}
