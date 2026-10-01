/** Environment variables that locate and authorize our Unipile workspace. */
const UNIPILE_ENVIRONMENT_KEYS = {
  dsn: 'UNIPILE_DSN',
  accessToken: 'UNIPILE_ACCESS_TOKEN',
} as const;

/** What every Unipile request needs to reach our workspace. */
export interface UnipileWorkspace {
  /** `https://` plus the DSN: the base of every API URL. */
  readonly baseUrl: string;
  readonly accessToken: string;
}

/**
 * Reads the workspace from the environment.
 *
 * These two values are the only place the code meets one particular Unipile
 * account: pointing the app at another workspace means changing them and
 * nothing else. The dashboard shows the DSN as a bare host and port, so a
 * scheme is added when it is missing.
 *
 * @throws When either value is absent or blank.
 */
export function requireUnipileWorkspace(
  environment: NodeJS.ProcessEnv = process.env,
): UnipileWorkspace {
  const dsn = environment[UNIPILE_ENVIRONMENT_KEYS.dsn]?.trim();
  const accessToken = environment[UNIPILE_ENVIRONMENT_KEYS.accessToken]?.trim();

  if (!dsn) throw new Error(`${UNIPILE_ENVIRONMENT_KEYS.dsn} is not configured.`);
  if (!accessToken) {
    throw new Error(`${UNIPILE_ENVIRONMENT_KEYS.accessToken} is not configured.`);
  }

  return {
    baseUrl: /^https?:\/\//i.test(dsn) ? dsn : `https://${dsn}`,
    accessToken,
  };
}
