import { ApifyClient } from 'apify-client';
import { collectApifyProfilesWithExecutor } from '../index.js';
import { requireApifyApiKey } from '../config.js';
import type {
  ApifyBatchExecutor,
  ApifyCollectionResult,
  ApifyCollectorOptions,
  RawApifyProfile,
} from '../index.js';
import type { Logger } from '../../../logging/index.js';
import { BEBITY_LINKEDIN_PREMIUM_ACTOR, BEBITY_PROFILE_FIELDS_ENVIRONMENT_KEY, BEBITY_PROFILE_FIELD_VALUES, DEFAULT_BEBITY_PROFILE_FIELDS } from './constants.js';
import type { BebityProfileField } from './constants.js';

export function resolveBebityProfileFields(environment: NodeJS.ProcessEnv = process.env): BebityProfileField[] | undefined 
{
  const raw = environment[BEBITY_PROFILE_FIELDS_ENVIRONMENT_KEY]?.trim();

  if (!raw) return [...DEFAULT_BEBITY_PROFILE_FIELDS];

  if (raw.toLowerCase() === 'all') return undefined;

  const values = raw.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  const invalid = values.filter((value) => !new Set<string>(BEBITY_PROFILE_FIELD_VALUES).has(value));

  if (invalid.length) 
  {
    throw new Error(`${BEBITY_PROFILE_FIELDS_ENVIRONMENT_KEY} contains unsupported fields: ${invalid.join(', ')}.`);
  }
  return [...new Set(values)] as BebityProfileField[];
}

export function bebityActorInput(profileLinks: readonly string[], profileFields: readonly BebityProfileField[] | undefined): Record<string, unknown> {
  return { action: 'get-profiles', keywords: [...profileLinks], ...(profileFields ? { profileFields: [...profileFields] } : {}) };
}

/** Benchmark-only collector; it deliberately preserves Bebity records unchanged. */
export async function collectBebityProfiles(
  profileLinks: readonly string[], logger?: Logger, 
  options: ApifyCollectorOptions = {}): Promise<ApifyCollectionResult> {

  const client = new ApifyClient({ token: requireApifyApiKey() });
  
  const profileFields = resolveBebityProfileFields();
  const executeBatch: ApifyBatchExecutor = async (queries) => {
    const run = await client.actor(BEBITY_LINKEDIN_PREMIUM_ACTOR).call(bebityActorInput(queries, profileFields));
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    if (!items.every(isRawProfileRecord)) throw new Error('Bebity returned an unexpected dataset item format.');
    return { records: items, actorRunId: run.id, datasetId: run.defaultDatasetId };
  };
  return collectApifyProfilesWithExecutor(profileLinks, executeBatch, logger, options);
}

function isRawProfileRecord(value: unknown): value is RawApifyProfile {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
