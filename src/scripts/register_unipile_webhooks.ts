import { getPublicUrl, getWebhookSecret } from "../api/config.js";
import { NEW_RELATION_PATH } from "../api/webhooks/unipile/webhook.js";
import { requireUnipileWorkspace } from "../linkedin/unipile/config.js";
import { sendUnipileRequest } from "../linkedin/unipile/request.js";

/** The name the webhook shows under in Unipile's dashboard. */
const WEBHOOK_NAME = "New relation";

/**
 * Ask Unipile to report accepted invites to this server: `npm run unipile:webhooks`.
 *
 * Run once per Unipile workspace, after PUBLIC_URL points at this server. The
 * secret travels in the URL, the same way as for the account-connected webhook.
 */
async function main(): Promise<void> {
  const query = new URLSearchParams({ secret: getWebhookSecret() });
  const requestUrl = `${getPublicUrl()}${NEW_RELATION_PATH}?${query}`;

  const reply = await sendUnipileRequest(requireUnipileWorkspace(), {
    method: "POST",
    path: "/webhooks",
    body: {
      source: "users",
      name: WEBHOOK_NAME,
      request_url: requestUrl,
      headers: [{ key: "Content-Type", value: "application/json" }],
    },
  });
  console.log("Registered:", JSON.stringify(reply));
}

await main();
