import { ApifyClient } from 'apify-client';

import { requireApifyApiKey } from '../config.js';
import { collectApifyProfilesWithExecutor } from '../apify_profile_collector.js';
import type {
  ApifyBatchExecutor,
  ApifyCollectionResult,
  ApifyCollectorOptions,
  RawApifyProfile,
} from '../types.js';
import type { Logger } from '../../../logging/index.js';
import {
  HARVEST_LINKEDIN_PROFILE_SCRAPER_ACTOR,
  HARVEST_PROFILE_DETAILS_MODE,
} from './constants.js';

/**
 * Type guard narrowing an item straight off the Apify dataset to a record. The
 * `value is RawApifyProfile` return type is what lets TypeScript treat the item
 * as a profile after the check; arrays and null are rejected because a dataset
 * item is always expected to be an object.
 */
function isRawHarvestProfile(value: unknown): value is RawApifyProfile {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Production entry point for HarvestAPI's LinkedIn profile Actor.
 *
 * Apify's `call` waits for one Actor run to finish. The collection engine calls
 * this executor through a bounded worker pool, then combines all datasets.
 */
export async function collectHarvestProfiles(
  profileLinks: readonly string[],
  logger?: Logger,
  options: ApifyCollectorOptions = {},
): Promise<ApifyCollectionResult> {
  const client = new ApifyClient({ token: requireApifyApiKey() });

  /** Executes one configured HarvestAPI Actor batch and reads its dataset. */
  const executeBatch: ApifyBatchExecutor = async (queries) => {
    const run = await client.actor(HARVEST_LINKEDIN_PROFILE_SCRAPER_ACTOR).call({
      profileScraperMode: HARVEST_PROFILE_DETAILS_MODE,
      queries,
    });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    if (!items.every(isRawHarvestProfile)) {
      throw new Error('Apify returned an unexpected dataset item format.');
    }

    return {
      records: items,
      actorRunId: run.id,
      datasetId: run.defaultDatasetId,
    };
  };

  return collectApifyProfilesWithExecutor(
    profileLinks,
    executeBatch,
    logger,
    options,
  );
}
