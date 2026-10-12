import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import type { Kysely } from "kysely";

import { insertLinkedinAccount, listLinkedinAccounts } from "../db/linkedinAccountsDb.js";
import type { Database } from "../db/schema.js";
import type { LinkedinClient } from "../linkedin/client.js";
import { requireUnipileWorkspace } from "../linkedin/unipile/config.js";
import { createConnectLink } from "../linkedin/unipile/connect_link.js";
import type { FetchFunction } from "../linkedin/unipile/index.js";
import { asRecord, asString } from "../shared/helpers/index.js";
import { currentUser } from "./auth.js";
import { getPublicUrl, getWebhookSecret } from "./config.js";
import { HTTP_BAD_REQUEST } from "./consts.js";
import { ACCOUNT_CONNECTED_PATH } from "./webhooks/unipile/webhook.js";

/** How long a Unipile login link stays usable. */
const LINK_LIFETIME_MS = 60 * 60 * 1000;

/** Prefix of the Unipile id given to accounts connected in fake mode. */
const FAKE_ACCOUNT_PREFIX = "fake-account-";

/**
 * Routes to list the organization's LinkedIn accounts and connect a new one.
 * Must be registered behind `requireUser`.
 *
 * Connecting differs by mode: with Unipile it returns a login link, and the
 * account is saved when Unipile calls the webhook; in fake mode the account is
 * saved at once, so the rest of the app can be used without Unipile.
 */
export function registerLinkedinAccountRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  linkedin: LinkedinClient,
  environment: NodeJS.ProcessEnv = process.env,
  fetchFunction?: FetchFunction,
): void {
  app.get("/api/linkedin-accounts", async (request) => ({
    accounts: await listLinkedinAccounts(db, currentUser(request).organizationId),
  }));

  app.post("/api/linkedin-accounts/connect", async (request, reply) => {
    const label = asString(asRecord(request.body)?.["label"])?.trim();
    if (!label) return reply.code(HTTP_BAD_REQUEST).send({ error: "label is required" });

    const { organizationId } = currentUser(request);

    if (linkedin.mode === "fake") {
      const unipileId = `${FAKE_ACCOUNT_PREFIX}${randomUUID()}`;
      await insertLinkedinAccount(db, { organizationId, label, unipileId });
      return { connected: true };
    }

    const url = await createConnectLink(
      requireUnipileWorkspace(environment),
      {
        accountLabel: label,
        expiresAt: new Date(Date.now() + LINK_LIFETIME_MS),
        notifyUrl: notifyUrl(environment, organizationId),
      },
      fetchFunction,
    );
    return { url };
  });
}

/**
 * Where Unipile reports a finished login: our address plus the webhook path,
 * carrying the secret the webhook checks and the organization that asked, so
 * the account is saved under it.
 */
function notifyUrl(environment: NodeJS.ProcessEnv, organizationId: string): string {
  const query = new URLSearchParams({
    secret: getWebhookSecret(environment),
    organization_id: organizationId,
  });
  return `${getPublicUrl(environment)}${ACCOUNT_CONNECTED_PATH}?${query}`;
}
