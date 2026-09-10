import assert from 'node:assert/strict';
import test from 'node:test';

import { collectHybridProfiles } from '../apify_pipeline.js';
import type {
  ApifyCollectionResult,
  ApifyCollectionStats,
  ApifyProfileFailure,
  RawApifyProfile,
} from '../types.js';
import type { ProfileCollector } from '../provider.js';

const ASCII_URL_A = 'https://www.linkedin.com/in/jane-doe-123/';
const ASCII_URL_B = 'https://www.linkedin.com/in/john-smith-456/';
// A slug holding a symbol. Bebity used to truncate these and return the
// wrong member, so they were routed straight to Harvest; it resolves them
// correctly now, so they go to Bebity like every other URL.
const SYMBOL_URL =
  'https://www.linkedin.com/in/roberto-alencar-cfp®-cpro-i-892529a/';

function stats(overrides: Partial<ApifyCollectionStats> = {}): ApifyCollectionStats {
  return {
    requestedProfiles: 0,
    collectedProfiles: 0,
    failedProfiles: 0,
    permanentFailures: 0,
    exhaustedTransientFailures: 0,
    retriedProfiles: 0,
    totalProfileAttempts: 0,
    roundsCompleted: 1,
    retryRounds: 0,
    actorRuns: 1,
    batchSize: 50,
    batchConcurrency: 6,
    unexpectedProviderRecords: 0,
    ...overrides,
  };
}

function bebityRawProfile(linkedinUrl: string): RawApifyProfile {
  return {
    linkedinUrl,
    firstName: 'Jane',
    summary: 'A Bebity-shaped bio.',
    experience: [],
    education: [],
  };
}

function harvestRawProfile(linkedinUrl: string): RawApifyProfile {
  return { linkedinUrl, firstName: 'John', about: 'A Harvest-shaped bio.' };
}

function failureFor(linkedinUrl: string, inputIndex: number): ApifyProfileFailure {
  return {
    linkedinUrl,
    inputIndex,
    category: 'not_found',
    error: 'Provider marked this profile as not found.',
    attempts: 1,
    retryable: false,
    retryExhausted: false,
  };
}

/** A fake collector that fails on the given URLs and succeeds on the rest. */
function fakeCollector(
  buildRawProfile: (url: string) => RawApifyProfile,
  failingUrls: readonly string[] = [],
): ProfileCollector {
  return async (profileLinks): Promise<ApifyCollectionResult> => {
    const failingSet = new Set(failingUrls);
    const profiles = profileLinks
      .filter((url) => !failingSet.has(url))
      .map(buildRawProfile);
    const failures = profileLinks
      .filter((url) => failingSet.has(url))
      .map((url, index) => failureFor(url, index));

    return {
      profiles,
      failures,
      stats: stats({
        requestedProfiles: profileLinks.length,
        collectedProfiles: profiles.length,
        failedProfiles: failures.length,
        permanentFailures: failures.filter((failure) => !failure.retryable).length,
      }),
    };
  };
}

/** A collector that must never be called — used to prove a provider is skipped. */
const unreachableCollector: ProfileCollector = async () => {
  throw new Error('This collector should not have been called.');
};

/** Wraps a collector to record the URLs it was called with, call by call. */
function trackCalls(base: ProfileCollector): {
  collector: ProfileCollector;
  calls: string[][];
} {
  const calls: string[][] = [];
  const collector: ProfileCollector = async (links, logger, options) => {
    calls.push([...links]);
    return base(links, logger, options);
  };
  return { collector, calls };
}

test('sends every URL to Bebity, symbol slugs included, and adapts its raw records', async () => {
  const harvestTracker = trackCalls(fakeCollector(harvestRawProfile));

  const result = await collectHybridProfiles(
    [ASCII_URL_A, ASCII_URL_B, SYMBOL_URL],
    undefined,
    {},
    undefined,
    {
      collectBebity: fakeCollector(bebityRawProfile),
      collectHarvest: harvestTracker.collector,
    },
  );

  // Harvest is never called: nothing is held back from Bebity up front, and
  // Bebity failed on nothing, so there is nothing to retry.
  assert.deepEqual(harvestTracker.calls, []);
  assert.equal(result.profiles.length, 3);

  const adaptedBebityProfile = result.profiles.find(
    (profile) => profile['linkedinUrl'] === ASCII_URL_A,
  );
  assert.equal(adaptedBebityProfile?.['about'], 'A Bebity-shaped bio.');
  assert.equal(adaptedBebityProfile?.['summary'], undefined);
});

test('retries a Bebity failure through Harvest, and only that failure', async () => {
  const harvestTracker = trackCalls(fakeCollector(harvestRawProfile));

  const result = await collectHybridProfiles(
    [ASCII_URL_A, SYMBOL_URL],
    undefined,
    {},
    undefined,
    {
      collectBebity: fakeCollector(bebityRawProfile, [ASCII_URL_A]),
      collectHarvest: harvestTracker.collector,
    },
  );

  // One Harvest call carrying only the URL Bebity failed on — the symbol URL
  // Bebity handled never reaches the more expensive provider.
  assert.deepEqual(harvestTracker.calls, [[ASCII_URL_A]]);
  assert.equal(result.failures.length, 0);
  assert.equal(result.profiles.length, 2);
});

test('a wrong-person record Bebity returns still reaches Harvest as a failure', async () => {
  // The name check in the shared matching engine turns a mismatched record
  // into an ordinary failure, so a slug-truncation regression costs a slower
  // profile rather than a wrong one. That is what makes routing symbol slugs
  // to Bebity safe without the old up-front carve-out.
  const harvestTracker = trackCalls(fakeCollector(harvestRawProfile));

  const result = await collectHybridProfiles(
    [SYMBOL_URL],
    undefined,
    {},
    undefined,
    {
      collectBebity: fakeCollector(bebityRawProfile, [SYMBOL_URL]),
      collectHarvest: harvestTracker.collector,
    },
  );

  assert.deepEqual(harvestTracker.calls, [[SYMBOL_URL]]);
  assert.equal(result.failures.length, 0);
  assert.equal(result.profiles[0]?.['about'], 'A Harvest-shaped bio.');
});

test('a failure that persists through Harvest is the only final failure, not duplicated', async () => {
  const result = await collectHybridProfiles(
    [ASCII_URL_A, ASCII_URL_B],
    undefined,
    {},
    undefined,
    {
      collectBebity: fakeCollector(bebityRawProfile, [ASCII_URL_A]),
      collectHarvest: fakeCollector(harvestRawProfile, [ASCII_URL_A]),
    },
  );

  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0]?.linkedinUrl, ASCII_URL_A);
  assert.equal(result.profiles.length, 1);
});

test('requestedProfiles reflects the true input count, not a sum that double-counts a retried URL', async () => {
  const result = await collectHybridProfiles(
    [ASCII_URL_A, SYMBOL_URL],
    undefined,
    {},
    undefined,
    {
      collectBebity: fakeCollector(bebityRawProfile, [ASCII_URL_A]),
      collectHarvest: fakeCollector(harvestRawProfile),
    },
  );

  assert.equal(result.stats.requestedProfiles, 2);
});

test('returns each provider\'s own stats untouched, alongside the merged totals', async () => {
  const result = await collectHybridProfiles(
    [ASCII_URL_A, SYMBOL_URL],
    undefined,
    {},
    undefined,
    {
      collectBebity: fakeCollector(bebityRawProfile, [ASCII_URL_A]),
      collectHarvest: fakeCollector(harvestRawProfile),
    },
  );

  // Bebity is asked for the whole batch; Harvest sees only the one it lost.
  assert.equal(result.providerBreakdown.bebity.requestedProfiles, 2);
  assert.equal(result.providerBreakdown.bebity.collectedProfiles, 1);
  assert.equal(result.providerBreakdown.harvest.requestedProfiles, 1);
  assert.equal(result.providerBreakdown.harvest.collectedProfiles, 1);
});

test('never calls Harvest when Bebity collects the whole batch', async () => {
  const result = await collectHybridProfiles(
    [ASCII_URL_A, ASCII_URL_B],
    undefined,
    {},
    undefined,
    {
      collectBebity: fakeCollector(bebityRawProfile),
      collectHarvest: unreachableCollector,
    },
  );

  assert.equal(result.profiles.length, 2);
  assert.equal(result.providerBreakdown.harvest.requestedProfiles, 0);
});

test('rejects an empty input instead of silently returning a no-op result', async () => {
  await assert.rejects(
    () =>
      collectHybridProfiles([], undefined, {}, undefined, {
        collectBebity: unreachableCollector,
        collectHarvest: unreachableCollector,
      }),
    /at least one linkedin profile url is required/i,
  );
});
