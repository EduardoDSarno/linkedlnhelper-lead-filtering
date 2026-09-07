import { collectBebityProfiles } from './bebity_profile_collector/index.js';
import { collectHarvestProfiles } from './harvest_profile_collector/index.js';
import type {
  ApifyCollectionResult,
  ApifyCollectorOptions,
} from './types.js';
import type { Logger } from '../../logging/index.js';

/** Environment variable selecting which Apify Actor collects full profiles. */
export const PROFILE_COLLECTOR_ENVIRONMENT_KEY = 'APIFY_PROFILE_COLLECTOR';

export const PROFILE_COLLECTOR_PROVIDERS = ['bebity', 'harvest'] as const;

export type ProfileCollectorProvider =
  (typeof PROFILE_COLLECTOR_PROVIDERS)[number];

/** Provider used when the environment does not select one. */
export const DEFAULT_PROFILE_COLLECTOR_PROVIDER: ProfileCollectorProvider =
  'bebity';

/** A collector entry point, shared by every provider and by benchmark fakes. */
export type ProfileCollector = (
  profileLinks: readonly string[],
  logger?: Logger,
  options?: ApifyCollectorOptions,
) => Promise<ApifyCollectionResult>;

const COLLECTORS: Readonly<Record<ProfileCollectorProvider, ProfileCollector>> =
  {
    bebity: collectBebityProfiles,
    harvest: collectHarvestProfiles,
  };

/**
 * Resolves the configured provider, rejecting an unrecognized value instead of
 * silently falling back. A typo would otherwise route a paid production run to
 * the wrong Actor, which differs in cost, schema, and coverage.
 */
export function resolveProfileCollectorProvider(
  environment: NodeJS.ProcessEnv = process.env,
): ProfileCollectorProvider {
  const configured = environment[PROFILE_COLLECTOR_ENVIRONMENT_KEY]
    ?.trim()
    .toLowerCase();

  if (!configured) return DEFAULT_PROFILE_COLLECTOR_PROVIDER;

  const provider = PROFILE_COLLECTOR_PROVIDERS.find(
    (candidate) => candidate === configured,
  );

  if (!provider) {
    throw new Error(
      `${PROFILE_COLLECTOR_ENVIRONMENT_KEY} must be one of: ${PROFILE_COLLECTOR_PROVIDERS.join(', ')}.`,
    );
  }

  return provider;
}

/** Returns the collector entry point for the configured provider. */
export function resolveProfileCollector(
  environment: NodeJS.ProcessEnv = process.env,
): ProfileCollector {
  return COLLECTORS[resolveProfileCollectorProvider(environment)];
}
