import { timingSafeEqual } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';

import { checkConnectionReply as parseConnectionReply } from '../../../linkedin/unipile/connect_link.js';
import type { AccountConnectedEvent } from '../../../linkedin/unipile/connect_link.js';
import { insertLinkedinAccount } from '../../../db/linkedinAccountsDb.js';
import { markAccepted } from '../../../db/leadsDb.js';
import type { Database } from '../../../db/schema.js';
import { HTTP_BAD_REQUEST, HTTP_UNAUTHORIZED } from '../../consts.js';
import { asRecord, asString } from '../../../shared/helpers/index.js';

export const ACCOUNT_CONNECTED_PATH = '/api/webhooks/unipile/account-connected';

/** Where Unipile reports that someone accepted one of our accounts' invites. */
export const NEW_RELATION_PATH = '/api/webhooks/unipile/new-relation';

/**
 * Adds the route Unipile calls when a hosted login finishes.
 *
 * It saves the connected account so it survives a restart. Unipile resends a
 * message it gets no 200 for, so the save updates an account it already has
 * instead of adding it twice. Also adds the route that marks invited leads
 * accepted when Unipile reports a new connection.
 */
export function registerUnipileWebhooks(
  app: FastifyInstance,
  db: Kysely<Database>,
  webhookSecret: string,
): void
{
  app.post(ACCOUNT_CONNECTED_PATH, async (request, reply) =>
  {
    // Reject callers who don't carry our secret, before reading anything else:
    // only Unipile got the URL that contains it.
    const query = asRecord(request.query);
    const given = asString(query?.['secret']);
    if (!given || !secretsMatch(given, webhookSecret))
    {
      return reply.code(HTTP_UNAUTHORIZED).send({ error: 'unauthorized' });
    }
    // Put in the notify URL by the connect route, next to the secret.
    const organizationId = asString(query?.['organization_id']);
    if (!organizationId) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: 'organization_id is required' });
    }
    // The parser throws on a malformed message; that is the sender's fault,
    // so it is answered with 400 rather than surfacing as a server error.
    let event: AccountConnectedEvent;
    try {
      event = parseConnectionReply(request.body);
    } catch {
      return reply.code(HTTP_BAD_REQUEST).send({ error: 'invalid payload' });
    }

    await insertLinkedinAccount(db, {
      organizationId,
      label: event.label,
      unipileId: event.accountId,
    });

    return { received: true };
  });

  // Unipile polls LinkedIn for new connections, so this can arrive hours
  // after the person accepted. Unknown people (connections made outside our
  // campaigns) are acknowledged and ignored.
  app.post(NEW_RELATION_PATH, async (request, reply) =>
  {
    const given = asString(asRecord(request.query)?.['secret']);
    if (!given || !secretsMatch(given, webhookSecret))
    {
      return reply.code(HTTP_UNAUTHORIZED).send({ error: 'unauthorized' });
    }
    const body = asRecord(request.body);
    const accountId = asString(body?.['account_id']);
    const memberId = asString(body?.['user_provider_id']);
    if (!accountId || !memberId) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: 'invalid payload' });
    }

    const updated = await markAccepted(db, accountId, memberId);
    return { received: true, updated };
  });
}

/**
 * Compares two secrets in constant time, so the response time reveals nothing
 * about how much of a guess was right. timingSafeEqual requires equal lengths,
 * so a different length is rejected first.
 */
function secretsMatch(given: string, expected: string): boolean {
  const givenBytes = Buffer.from(given);
  const expectedBytes = Buffer.from(expected);
  return givenBytes.length === expectedBytes.length
    && timingSafeEqual(givenBytes, expectedBytes);
}
