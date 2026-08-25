import type { ApifyCollectorOptions } from './types.js';
import {
  CONFIG_NUMBER_MINIMUMS,
  resolveConfigNumber,
} from '../../helpers/index.js';

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
    profilesPerActorRun: resolveConfigNumber(
      options.batchSize ?? environment[ENVIRONMENT_KEYS.profilesPerActorRun],
      {
        fallback: APIFY_COLLECTOR_DEFAULTS.profilesPerActorRun,
        minimum: CONFIG_NUMBER_MINIMUMS.positive,
        maximum: APIFY_COLLECTOR_LIMITS.profilesPerActorRun,
        integer: true,
        clampMaximum: true,
      },
    ),
    actorRunConcurrency: resolveConfigNumber(
      options.concurrency ?? environment[ENVIRONMENT_KEYS.actorRunConcurrency],
      {
        fallback: APIFY_COLLECTOR_DEFAULTS.actorRunConcurrency,
        minimum: CONFIG_NUMBER_MINIMUMS.positive,
        maximum: APIFY_COLLECTOR_LIMITS.actorRunConcurrency,
        integer: true,
        clampMaximum: true,
      },
    ),
    maxAttempts: resolveConfigNumber(
      options.maxAttempts ?? environment[ENVIRONMENT_KEYS.maxAttempts],
      {
        fallback: APIFY_COLLECTOR_DEFAULTS.maxAttempts,
        minimum: CONFIG_NUMBER_MINIMUMS.positive,
        maximum: APIFY_COLLECTOR_LIMITS.maxAttempts,
        integer: true,
        clampMaximum: true,
      },
    ),
    retryBaseDelayMs: resolveConfigNumber(
      options.retryBaseDelayMs ?? environment[ENVIRONMENT_KEYS.retryBaseDelayMs],
      {
        fallback: APIFY_COLLECTOR_DEFAULTS.retryBaseDelayMs,
        minimum: CONFIG_NUMBER_MINIMUMS.nonNegative,
      },
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
