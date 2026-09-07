import assert from 'node:assert/strict';
import test from 'node:test';

import { collectHybridProfiles } from '../orchestrator.js';
import type {
  ApifyCollectionResult,
  ApifyCollectionStats,
  ApifyProfileFailure,
  RawApifyProfile,
} from '../types.js';
import type { ProfileCollector } from '../provider.js';

const ASCII_URL_A = 'https://www.linkedin.com/in/jane-doe-123/';
const ASCII_URL_B = 'https://www.linkedin.com/in/john-smith-456/';
const NON_ASCII_URL = 'https://www.linkedin.com/in/josé-silva-789/';

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

test('sends only ASCII-compatible URLs to Bebity and adapts its raw records', async () => {
  const harvestTracker = trackCalls(fakeCollector(harvestRawProfile));

  const result = await collectHybridProfiles(
    [ASCII_URL_A, ASCII_URL_B, NON_ASCII_URL],
    undefined,
    {},
    {
      collectBebity: fakeCollector(bebityRawProfile),
      collectHarvest: harvestTracker.collector,
    },
  );

  // Exactly one Harvest call — the first pass for the non-ASCII URL. With no
  // Bebity failures, there is nothing for a second pass to retry.
  assert.deepEqual(harvestTracker.calls, [[NON_ASCII_URL]]);
  assert.equal(result.profiles.length, 3);

  const adaptedBebityProfile = result.profiles.find(
    (profile) => profile['linkedinUrl'] === ASCII_URL_A,
  );
  assert.equal(adaptedBebityProfile?.['about'], 'A Bebity-shaped bio.');
  assert.equal(adaptedBebityProfile?.['summary'], undefined);
});

test('retries a Bebity failure through Harvest as a separate second pass', async () => {
  const harvestTracker = trackCalls(fakeCollector(harvestRawProfile));

  const result = await collectHybridProfiles(
    [ASCII_URL_A, NON_ASCII_URL],
    undefined,
    {},
    {
      collectBebity: fakeCollector(bebityRawProfile, [ASCII_URL_A]),
      collectHarvest: harvestTracker.collector,
    },
  );

  // Two separate calls, not one combined batch: the first pass for the
  // ASCII-ineligible URL fires immediately, the second pass for the Bebity
  // failure only happens once Bebity is known to have failed on it.
  assert.deepEqual(harvestTracker.calls, [[NON_ASCII_URL], [ASCII_URL_A]]);
  assert.equal(result.failures.length, 0);
  assert.equal(result.profiles.length, 2);
});

test('launches Bebity and Harvest\'s first pass concurrently, not sequentially', async () => {
  const DELAY_MS = 60;
  const delayedCollector = (
    buildRawProfile: (url: string) => RawApifyProfile,
  ): ProfileCollector =>
    async (profileLinks) => {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      return fakeCollector(buildRawProfile)(profileLinks);
    };

  const startedAt = Date.now();
  await collectHybridProfiles(
    [ASCII_URL_A, NON_ASCII_URL],
    undefined,
    {},
    {
      collectBebity: delayedCollector(bebityRawProfile),
      collectHarvest: delayedCollector(harvestRawProfile),
    },
  );
  const durationMs = Date.now() - startedAt;

  // Sequential (Bebity fully finished, then Harvest's first pass started)
  // would take roughly 2x DELAY_MS. Concurrent should take roughly 1x.
  assert.ok(
    durationMs < DELAY_MS * 2,
    `expected the first passes to overlap, took ${durationMs}ms`,
  );
});

test('a failure that persists through Harvest is the only final failure, not duplicated', async () => {
  const result = await collectHybridProfiles(
    [ASCII_URL_A, ASCII_URL_B],
    undefined,
    {},
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
    [ASCII_URL_A, NON_ASCII_URL],
    undefined,
    {},
    {
      collectBebity: fakeCollector(bebityRawProfile, [ASCII_URL_A]),
      collectHarvest: fakeCollector(harvestRawProfile),
    },
  );

  assert.equal(result.stats.requestedProfiles, 2);
});

test('returns each provider\'s own stats untouched, alongside the merged totals', async () => {
  const result = await collectHybridProfiles(
    [ASCII_URL_A, NON_ASCII_URL],
    undefined,
    {},
    {
      collectBebity: fakeCollector(bebityRawProfile),
      collectHarvest: fakeCollector(harvestRawProfile),
    },
  );

  assert.equal(result.providerBreakdown.bebity.requestedProfiles, 1);
  assert.equal(result.providerBreakdown.bebity.collectedProfiles, 1);
  assert.equal(result.providerBreakdown.harvest.requestedProfiles, 1);
  assert.equal(result.providerBreakdown.harvest.collectedProfiles, 1);
});

test('never calls Harvest when every URL is Bebity-compatible and none fail', async () => {
  const result = await collectHybridProfiles(
    [ASCII_URL_A, ASCII_URL_B],
    undefined,
    {},
    {
      collectBebity: fakeCollector(bebityRawProfile),
      collectHarvest: unreachableCollector,
    },
  );

  assert.equal(result.profiles.length, 2);
  assert.equal(result.providerBreakdown.harvest.requestedProfiles, 0);
});

test('never calls Bebity when every URL requires Harvest', async () => {
  const result = await collectHybridProfiles(
    [NON_ASCII_URL],
    undefined,
    {},
    {
      collectBebity: unreachableCollector,
      collectHarvest: fakeCollector(harvestRawProfile),
    },
  );

  assert.equal(result.profiles.length, 1);
  assert.equal(result.providerBreakdown.bebity.requestedProfiles, 0);
});

test('rejects an empty input instead of silently returning a no-op result', async () => {
  await assert.rejects(
    () =>
      collectHybridProfiles([], undefined, {}, {
        collectBebity: unreachableCollector,
        collectHarvest: unreachableCollector,
      }),
    /at least one linkedin profile url is required/i,
  );
});
