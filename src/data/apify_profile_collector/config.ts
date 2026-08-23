import type { ApifyCollectorOptions } from './types.js';

/** Defaults used when neither caller options nor environment values exist. */
export const APIFY_COLLECTOR_DEFAULTS = {
  profilesPerActorRun: 50,
  actorRunConcurrency: 6,
  maxAttempts: 3,
  retryBaseDelayMs: 1_000,
} as const;

/** Application safety ceilings applied independently of provider validation. */
export const APIFY_COLLECTOR_LIMITS = {
  profilesPerActorRun: 250,
  actorRunConcurrency: 32,
  maxAttempts: 5,
} as const;

/** Maximum random offset added to retry backoff to avoid synchronized retries. */
export const APIFY_RETRY_JITTER_MS = 250;

const ENVIRONMENT_KEYS = {
  profilesPerActorRun: 'APIFY_BATCH_SIZE',
  actorRunConcurrency: 'APIFY_BATCH_CONCURRENCY',
  maxAttempts: 'APIFY_MAX_ATTEMPTS',
  retryBaseDelayMs: 'APIFY_RETRY_BASE_DELAY_MS',
  apiKey: 'APIFY_API_KEY',
} as const;

/** Validated configuration consumed by the collection engine. */
export interface ResolvedApifyCollectorConfig {
  profilesPerActorRun: number;
  actorRunConcurrency: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
}

/**
 * Converts untrusted configuration into a positive integer within a safety
 * ceiling. Invalid values fall back to the configured default.
 *
 * @param value - Function option or environment value to validate.
 * @param fallback - Value used when the supplied value is unusable.
 * @param maximum - Greatest accepted integer.
 * @returns A positive integer no greater than the supplied maximum.
 */
function boundedPositiveInteger(
  value: unknown,
  fallback: number,
  maximum: number,
): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return fallback;
  return Math.min(maximum, Math.floor(numericValue));
}

/**
 * Converts untrusted configuration into a non-negative number.
 *
 * @param value - Function option or environment value to validate.
 * @param fallback - Value used when the supplied value is unusable.
 * @returns The validated number, including zero, or the fallback.
 */
function nonNegativeNumber(value: unknown, fallback: number): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0
    ? numericValue
    : fallback;
}

/**
 * Resolves caller options and environment values into safe collector settings.
 * Explicit function options take precedence over environment configuration.
 *
 * @param options - Optional overrides supplied by the collector caller.
 * @param environment - Environment source, injectable for deterministic tests.
 * @returns Complete validated settings with no optional properties.
 */
export function resolveApifyCollectorConfig(
  options: ApifyCollectorOptions = {},
  environment: NodeJS.ProcessEnv = process.env,
): ResolvedApifyCollectorConfig {
  return {
    profilesPerActorRun: boundedPositiveInteger(
      options.batchSize ?? environment[ENVIRONMENT_KEYS.profilesPerActorRun],
      APIFY_COLLECTOR_DEFAULTS.profilesPerActorRun,
      APIFY_COLLECTOR_LIMITS.profilesPerActorRun,
    ),
    actorRunConcurrency: boundedPositiveInteger(
      options.concurrency ?? environment[ENVIRONMENT_KEYS.actorRunConcurrency],
      APIFY_COLLECTOR_DEFAULTS.actorRunConcurrency,
      APIFY_COLLECTOR_LIMITS.actorRunConcurrency,
    ),
    maxAttempts: boundedPositiveInteger(
      options.maxAttempts ?? environment[ENVIRONMENT_KEYS.maxAttempts],
      APIFY_COLLECTOR_DEFAULTS.maxAttempts,
      APIFY_COLLECTOR_LIMITS.maxAttempts,
    ),
    retryBaseDelayMs: nonNegativeNumber(
      options.retryBaseDelayMs ?? environment[ENVIRONMENT_KEYS.retryBaseDelayMs],
      APIFY_COLLECTOR_DEFAULTS.retryBaseDelayMs,
    ),
  };
}

/**
 * Reads the Apify credential without placing it in the resolved configuration.
 * Keeping secrets separate prevents accidental exposure when settings are logged.
 *
 * @param environment - Environment source, injectable for deterministic tests.
 * @returns The trimmed Apify API key.
 * @throws When the API key is absent or contains only whitespace.
 */
export function requireApifyApiKey(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const apiKey = environment[ENVIRONMENT_KEYS.apiKey]?.trim();
  if (!apiKey) throw new Error('APIFY_API_KEY is not configured.');
  return apiKey;
}
