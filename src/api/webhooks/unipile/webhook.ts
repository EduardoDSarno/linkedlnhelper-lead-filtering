import type { FastifyInstance } from 'fastify';
import { checkConnectionReply as parseConnectionReply } from '../../../linkedin/unipile/connect_link.js';
import { HTTP_BAD_REQUEST } from '../../consts.js';

export const ACCOUNT_CONNECTED_PATH = '/api/webhooks/unipile/account-connected';

/** Adds the route Unipile calls when a hosted login finishes. */
export function registerUnipileWebhooks(app: FastifyInstance): void 
{
  app.post(ACCOUNT_CONNECTED_PATH, async (request, reply) => 
  {
    const event = parseConnectionReply(request.body);
    if (!event) return reply.code(HTTP_BAD_REQUEST).send({ error: 'invalid payload' });

  });
}
