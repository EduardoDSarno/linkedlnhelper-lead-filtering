/** Environment variable holding the address others use to reach this server. */
const PUBLIC_URL_ENVIRONMENT_KEY = 'PUBLIC_URL';
/** Environment variable holding the secret Unipile's callbacks must carry. */
const WEBHOOK_SECRET_ENVIRONMENT_KEY = 'UNIPILE_WEBHOOK_SECRET';

/**
 * Reads this server's public address: the ngrok address in development, the
 * real domain in production.
 *
 * Outside services need it to call us back (Unipile sends "account connected"
 * there), and it changes with every environment, so it lives in `.env` rather
 * than in code. A trailing slash is removed so a path can be appended to it
 * without producing a double slash.
 *
 * @throws When PUBLIC_URL is absent or blank.
 */
export function getPublicUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const publicUrl = environment[PUBLIC_URL_ENVIRONMENT_KEY]?.trim();
  if (!publicUrl) throw new Error(`${PUBLIC_URL_ENVIRONMENT_KEY} is not configured.`);

  return publicUrl.replace(/\/+$/, '');
}

/**
 * Reads the secret that proves a webhook call really comes from Unipile.
 *
 * It travels inside the notify URL we give Unipile, so only a caller who got
 * that URL from us can produce it. Missing it would leave the webhook open to
 * anyone, so the server refuses to start instead.
 *
 * @throws When UNIPILE_WEBHOOK_SECRET is absent or blank.
 */
export function getWebhookSecret(environment: NodeJS.ProcessEnv = process.env): string {
  const secret = environment[WEBHOOK_SECRET_ENVIRONMENT_KEY]?.trim();
  if (!secret) throw new Error(`${WEBHOOK_SECRET_ENVIRONMENT_KEY} is not configured.`);
  return secret;
}
