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

const BEBITY_NOT_FOUND_STATUS = 'NOT_FOUND';

/**
 * Bebity marks an unresolved profile with `status: "NOT_FOUND"` and a
 * `reason` field — not the numeric status or `error` field
 * classifyProviderRecord already knows how to read. Left alone, a record
 * like `{ status: "NOT_FOUND", linkedinUrl: "...", reason: "DOES_NOT_EXIST" }`
 * still has a `linkedinUrl` and no recognized error signal, so it passes
 * through as a successful, nearly-empty profile instead of a failure.
 *
 * Stamping a plain `error` field on it here, at the provider boundary, is
 * what lets the shared classifier's existing "not found" text match catch it
 * — no changes needed to the generic classifier itself.
 */
export function markBebityNotFoundAsFailed(item: RawApifyProfile): RawApifyProfile {
  if (item['status'] !== BEBITY_NOT_FOUND_STATUS) return item;

  const reason = typeof item['reason'] === 'string' ? item['reason'] : 'unknown reason';
  return { ...item, error: `Bebity marked this profile as not found (${reason}).` };
}

/** Benchmark-only collector; it deliberately preserves Bebity records unchanged. */
export async function collectBebityProfiles(
  profileLinks: readonly string[], 
  logger?: Logger,
  options: ApifyCollectorOptions = {}): Promise<ApifyCollectionResult> {

  const client = new ApifyClient({ token: requireApifyApiKey() });

  const profileFields = resolveBebityProfileFields();
  const executeBatch: ApifyBatchExecutor = async (queries) => {
    const run = await client.actor(BEBITY_LINKEDIN_PREMIUM_ACTOR).call(bebityActorInput(queries, profileFields));
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    if (!items.every(isRawProfileRecord)) throw new Error('Bebity returned an unexpected dataset item format.');
    return {
      records: items.map(markBebityNotFoundAsFailed),
      actorRunId: run.id,
      datasetId: run.defaultDatasetId,
    };
  };
  return collectApifyProfilesWithExecutor(profileLinks, executeBatch, logger, options);
}

function isRawProfileRecord(value: unknown): value is RawApifyProfile {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
