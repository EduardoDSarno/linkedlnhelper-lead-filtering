/** Environment variable holding the address others use to reach this server. */
const PUBLIC_URL_ENVIRONMENT_KEY = 'PUBLIC_URL';

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
export function requirePublicUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const publicUrl = environment[PUBLIC_URL_ENVIRONMENT_KEY]?.trim();
  if (!publicUrl) throw new Error(`${PUBLIC_URL_ENVIRONMENT_KEY} is not configured.`);

  return publicUrl.replace(/\/+$/, '');
}
