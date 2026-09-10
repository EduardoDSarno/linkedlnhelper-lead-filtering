import { adaptBebityRawProfile } from '../../mapper/bebity_raw_profile_adapter.js';
import type { Logger } from '../../logging/index.js';
import { collectBebityProfiles } from './bebity_profile_collector/index.js';
import { collectHarvestProfiles } from './harvest_profile_collector/index.js';
import type { ProfileCollector } from './provider.js';
import type {
  ApifyCollectionResult,
  ApifyCollectionStats,
  ApifyCollectorOptions,
} from './types.js';

/**
 * Injectable so tests can supply fake collectors instead of calling either
 * real Actor. Both real collectors already match this shape.
 */
export interface HybridProfileCollectors {
  collectBebity: ProfileCollector;
  collectHarvest: ProfileCollector;
}

const DEFAULT_HYBRID_COLLECTORS: HybridProfileCollectors = {
  collectBebity: collectBebityProfiles,
  collectHarvest: collectHarvestProfiles,
};

/**
 * Each provider's own stats, preserved alongside the merged `stats` a plain
 * `ApifyCollectionResult` consumer would read. Without this, there is no way
 * to see how much of a run actually went through the cheap provider versus
 * fell back to the expensive one — the entire point of building Bebity
 * support was that split, so it can't be allowed to disappear at the merge.
 */
export interface HybridProfileCollectionBreakdown {
  bebity: ApifyCollectionStats;
  harvest: ApifyCollectionStats;
}

/**
 * A regular `ApifyCollectionResult` — assignable anywhere one is expected,
 * including as a `ProfileCollector` — plus the per-provider breakdown above.
 */
export interface HybridCollectionResult extends ApifyCollectionResult {
  providerBreakdown: HybridProfileCollectionBreakdown;
}

/**
 * Collects full profiles through Bebity, falling back to Harvest only for the
 * ones Bebity actually tried and came back with nothing on. Bebity is the
 * cheaper provider, so every URL goes there first and Harvest is reserved for
 * genuine failures, which costs nothing on a batch Bebity handles completely.
 *
 * Every URL is sent to Bebity, including slugs holding symbols and emoji.
 * Bebity's actor used to truncate those at the first non-ASCII character and
 * return whoever held the shorter slug, so they were routed straight to
 * Harvest instead; that bug is fixed, verified live against one URL per
 * character class present in real data. Nothing rests on that verification
 * staying true, though: a wrong-person record is caught by the name check in
 * the shared matching engine and falls through to the Harvest pass below like
 * any other failure, so a regression costs a slower profile rather than a
 * wrong one.
 *
 * `expectedNames` (URL -> display name from the source data) is passed
 * straight through to both providers; only Bebity actually uses it, to
 * recover a profile returned under a changed vanity URL (see
 * collectBebityProfiles).
 */
export async function collectHybridProfiles(
  profileLinks: readonly string[],
  logger?: Logger,
  options: ApifyCollectorOptions = {},
  expectedNames?: ReadonlyMap<string, string>,
  collectors: HybridProfileCollectors = DEFAULT_HYBRID_COLLECTORS,
): Promise<HybridCollectionResult> {
  if (profileLinks.length === 0) {
    throw new Error('At least one LinkedIn profile URL is required.');
  }

  // Step 1: every URL goes to Bebity. Nothing is held back for Harvest up
  // front any more — see the note on slug truncation above.
  const bebityResult = await collectors.collectBebity(
    profileLinks,
    logger,
    options,
    expectedNames,
  );

  // Step 2: only *now*, after Bebity has actually finished, do we know what
  // it failed on. That part is unavoidably sequential — there is no way to
  // know Bebity's failures before Bebity is done. This Harvest call fires
  // only when there is something to retry, so a batch with zero Bebity
  // failures never touches the more expensive provider at all.
  const bebityFailedUrls = bebityResult.failures.map(
    (failure) => failure.linkedinUrl,
  );
  const harvestResult =
    bebityFailedUrls.length > 0
      ? await collectors.collectHarvest(bebityFailedUrls, logger, options, expectedNames)
      : emptyCollectionResult();

  // Step 3: Bebity's raw records use different field names than Harvest's
  // (title vs position, summary vs about, a flat location string vs a parsed
  // object — see bebity_raw_profile_adapter.ts). Reshape them here, at the
  // point the providers' results get combined, so everything downstream
  // (mapApifyProfile, evaluation/mapper.ts) sees one consistent shape
  // regardless of which provider actually collected a given profile. This is
  // also the only point in the pipeline where "which provider found this"
  // is still known — after this, the result sets are indistinguishable.
  const adaptedBebityProfiles = bebityResult.profiles.map(adaptBebityRawProfile);
  const harvestStats = harvestResult.stats;

  // Logged here — not just returned — because this is the one number that
  // proves (or disproves) the cost saving Bebity was built for: how much of
  // this run actually stayed on the cheap provider versus fell back.
  logger?.info(
    {
      bebityRequested: profileLinks.length,
      bebityCollected: bebityResult.stats.collectedProfiles,
      bebityFailedOverToHarvest: bebityFailedUrls.length,
      harvestCollected: harvestStats.collectedProfiles,
      finalFailures: harvestResult.failures.length,
    },
    'Completed hybrid profile collection.',
  );

  return {
    profiles: [...adaptedBebityProfiles, ...harvestResult.profiles],
    // A URL only ends up as a final failure if Harvest also could not
    // collect it — a Bebity failure that Harvest rescued is not a failure
    // anymore, so bebityResult.failures is deliberately not included here.
    failures: harvestResult.failures,
    stats: mergeCollectionStats(profileLinks.length, bebityResult.stats, harvestStats),
    providerBreakdown: {
      bebity: bebityResult.stats,
      harvest: harvestStats,
    },
  };
}

/** A zero-work result, used so a skipped provider call still has stats to merge. */
function emptyCollectionResult(): ApifyCollectionResult {
  return {
    profiles: [],
    failures: [],
    stats: {
      requestedProfiles: 0,
      collectedProfiles: 0,
      failedProfiles: 0,
      permanentFailures: 0,
      exhaustedTransientFailures: 0,
      retriedProfiles: 0,
      totalProfileAttempts: 0,
      roundsCompleted: 0,
      retryRounds: 0,
      actorRuns: 0,
      batchSize: 0,
      batchConcurrency: 0,
      unexpectedProviderRecords: 0,
    },
  };
}

/**
 * Combines Bebity's run and Harvest's fallback run into one set of totals.
 *
 * `requestedProfiles` is deliberately not `bebity.requestedProfiles +
 * harvest.requestedProfiles` — a URL that failed at Bebity and was retried at
 * Harvest was "requested" from both providers, which would double-count it.
 * The true request count is the caller's original input length, computed
 * once by the caller and passed in here instead.
 *
 * `failedProfiles`/`permanentFailures`/`exhaustedTransientFailures` come from
 * `harvest` alone, because `harvestFailures` — not a combination of both
 * providers' failures — is what collectHybridProfiles actually returns as
 * final failures above.
 */
function mergeCollectionStats(
  requestedProfiles: number,
  bebity: ApifyCollectionStats,
  harvest: ApifyCollectionStats,
): ApifyCollectionStats {
  return {
    requestedProfiles,
    collectedProfiles: bebity.collectedProfiles + harvest.collectedProfiles,
    failedProfiles: harvest.failedProfiles,
    permanentFailures: harvest.permanentFailures,
    exhaustedTransientFailures: harvest.exhaustedTransientFailures,
    retriedProfiles: bebity.retriedProfiles + harvest.retriedProfiles,
    totalProfileAttempts:
      bebity.totalProfileAttempts + harvest.totalProfileAttempts,
    roundsCompleted: bebity.roundsCompleted + harvest.roundsCompleted,
    retryRounds: bebity.retryRounds + harvest.retryRounds,
    actorRuns: bebity.actorRuns + harvest.actorRuns,
    // Each provider is configured independently; reported from Bebity here
    // since it's the primary, cheaper path. Neither single number describes
    // the hybrid run as a whole — check each provider's own result for that.
    batchSize: bebity.batchSize,
    batchConcurrency: bebity.batchConcurrency,
    unexpectedProviderRecords:
      bebity.unexpectedProviderRecords + harvest.unexpectedProviderRecords,
  };
}
