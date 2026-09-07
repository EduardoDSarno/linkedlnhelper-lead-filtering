import { adaptBebityRawProfile } from '../../mapper/bebity_raw_profile_adapter.js';
import type { Logger } from '../../logging/index.js';
import {
  collectBebityProfiles,
  partitionProfileLinksForBebity,
} from './bebity_profile_collector/index.js';
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
 * Collects full profiles using Bebity where it's safe, and Harvest for
 * everything Bebity can't handle — either because its slug would truncate
 * (confirmed against live Bebity output; see eligibility.ts) or because
 * Bebity was actually tried and came back with nothing. Bebity is roughly 4x
 * cheaper than Harvest, so this maximizes how much of a batch goes through
 * the cheap path without ever accepting one of Bebity's known failure modes
 * — wrong-profile misattribution on a truncated slug, or a NOT_FOUND record
 * silently treated as a success — as a final answer.
 *
 * `expectedNames` (URL -> display name from the source data) is passed
 * straight through to both providers; only Bebity actually uses it, to
 * recover a profile returned under a changed vanity URL (see
 * collectBebityProfiles) without reopening the truncation-bug risk.
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

  // Step 1: split the request before anything is sent anywhere.
  // `requiresHarvest` is every URL whose slug would get truncated by
  // Bebity's actor — those never go to Bebity at all, because there is no
  // encoding workaround for that bug (verified: raw and percent-encoded
  // input truncate to the identical string).
  const { bebityCompatible, requiresHarvest } =
    partitionProfileLinksForBebity(profileLinks);

  // Step 2: launch Bebity and Harvest's first pass at the same time, not one
  // after another. `requiresHarvest` is already fully known from the
  // partition above — it does not depend on anything Bebity does, so there
  // is no reason to make it sit idle behind Bebity's entire retry cycle
  // (which can run several rounds with backoff between them). Each call is
  // skipped when its slice is empty, since the shared collection engine
  // throws on an empty input array rather than returning a no-op result.
  const bebityPromise = bebityCompatible.length > 0
    ? collectors.collectBebity(bebityCompatible, logger, options, expectedNames)
    : emptyCollectionResult();
  const firstHarvestPromise = requiresHarvest.length > 0
    ? collectors.collectHarvest(requiresHarvest, logger, options, expectedNames)
    : emptyCollectionResult();
  const [bebityResult, firstHarvestResult] = await Promise.all([
    bebityPromise,
    firstHarvestPromise,
  ]);

  // Step 3: only *now*, after Bebity has actually finished, do we know what
  // it failed on. That part is unavoidably sequential — there is no way to
  // know Bebity's failures before Bebity is done. This second Harvest call
  // fires only when there is something to retry; a batch with zero Bebity
  // failures costs nothing extra here.
  const bebityFailedUrls = bebityResult.failures.map(
    (failure) => failure.linkedinUrl,
  );
  const secondHarvestResult =
    bebityFailedUrls.length > 0
      ? await collectors.collectHarvest(bebityFailedUrls, logger, options, expectedNames)
      : emptyCollectionResult();

  // Step 4: Bebity's raw records use different field names than Harvest's
  // (title vs position, summary vs about, a flat location string vs a parsed
  // object — see bebity_raw_profile_adapter.ts). Reshape them here, at the
  // point the providers' results get combined, so everything downstream
  // (mapApifyProfile, evaluation/mapper.ts) sees one consistent shape
  // regardless of which provider actually collected a given profile. This is
  // also the only point in the pipeline where "which provider found this"
  // is still known — after this, the result sets are indistinguishable.
  const adaptedBebityProfiles = bebityResult.profiles.map(adaptBebityRawProfile);
  const harvestProfiles = [
    ...firstHarvestResult.profiles,
    ...secondHarvestResult.profiles,
  ];
  const harvestFailures = [
    ...firstHarvestResult.failures,
    ...secondHarvestResult.failures,
  ];
  // The two Harvest calls are disjoint requests (requiresHarvest vs.
  // bebityFailedUrls never overlap), so unlike bebity+harvest below, summing
  // their stats directly does not double-count anything.
  const harvestStats = sumCollectionStats(
    firstHarvestResult.stats,
    secondHarvestResult.stats,
  );

  // Logged here — not just returned — because this is the one number that
  // proves (or disproves) the cost saving Bebity was built for: how much of
  // this run actually stayed on the cheap provider versus fell back.
  logger?.info(
    {
      bebityRequested: bebityCompatible.length,
      bebityCollected: bebityResult.stats.collectedProfiles,
      bebityFailedOverToHarvest: bebityFailedUrls.length,
      harvestFirstPassRequested: requiresHarvest.length,
      harvestSecondPassRequested: bebityFailedUrls.length,
      harvestCollected: harvestStats.collectedProfiles,
      finalFailures: harvestFailures.length,
    },
    'Completed hybrid profile collection.',
  );

  return {
    profiles: [...adaptedBebityProfiles, ...harvestProfiles],
    // A URL only ends up as a final failure if Harvest also could not
    // collect it — a Bebity failure that Harvest rescued is not a failure
    // anymore, so bebityResult.failures is deliberately not included here.
    failures: harvestFailures,
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
 * Sums two independent, non-overlapping collection runs' stats field by
 * field. Safe here specifically because Harvest's two passes never request
 * the same URL twice (`requiresHarvest` and `bebityFailedUrls` are disjoint)
 * — unlike combining Bebity with Harvest below, where a naive sum would
 * double-count a URL retried across providers.
 */
function sumCollectionStats(
  a: ApifyCollectionStats,
  b: ApifyCollectionStats,
): ApifyCollectionStats {
  return {
    requestedProfiles: a.requestedProfiles + b.requestedProfiles,
    collectedProfiles: a.collectedProfiles + b.collectedProfiles,
    failedProfiles: a.failedProfiles + b.failedProfiles,
    permanentFailures: a.permanentFailures + b.permanentFailures,
    exhaustedTransientFailures: a.exhaustedTransientFailures + b.exhaustedTransientFailures,
    retriedProfiles: a.retriedProfiles + b.retriedProfiles,
    totalProfileAttempts: a.totalProfileAttempts + b.totalProfileAttempts,
    roundsCompleted: a.roundsCompleted + b.roundsCompleted,
    retryRounds: a.retryRounds + b.retryRounds,
    actorRuns: a.actorRuns + b.actorRuns,
    // Both passes use the same Harvest configuration; reported from the
    // first pass here since a skipped second pass carries zeroed config.
    batchSize: a.batchSize || b.batchSize,
    batchConcurrency: a.batchConcurrency || b.batchConcurrency,
    unexpectedProviderRecords: a.unexpectedProviderRecords + b.unexpectedProviderRecords,
  };
}

/**
 * Combines Bebity's run and Harvest's (already-summed) run into one set of
 * totals.
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
