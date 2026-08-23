import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import pino from 'pino';

import type {
  ApifyCollectionStats,
  ApifyProfileFailure,
  RawApifyProfile,
} from '../../../data/apify_profile_collector/index.js';
import {
  runApifyBenchmark,
  validateApifyBenchmarkCollection,
} from '../apify_benchmark_runner.js';
import type {
  ApifyBenchmarkCollector,
  ApifyBenchmarkDependencies,
} from '../types.js';

const TEST_TIME = new Date('2026-08-23T12:00:00.000Z');

/** Creates a silent structured logger so tests never write application logs. */
function testLogger(): pino.Logger {
  return pino({ level: 'silent' });
}

/** Returns a deterministic clock suitable for benchmark duration assertions. */
function fixedClock(): Date {
  return new Date(TEST_TIME);
}

/** Builds internally consistent aggregate statistics for a fake collection. */
function collectionStats(
  requestedProfiles: number,
  collectedProfiles: number,
  failedProfiles: number,
): ApifyCollectionStats {
  return {
    requestedProfiles,
    collectedProfiles,
    failedProfiles,
    permanentFailures: failedProfiles,
    exhaustedTransientFailures: 0,
    retriedProfiles: 0,
    totalProfileAttempts: requestedProfiles,
    roundsCompleted: 1,
    retryRounds: 0,
    actorRuns: 1,
    batchSize: requestedProfiles,
    batchConcurrency: 1,
    unexpectedProviderRecords: 0,
  };
}

test('dry run writes a plan without invoking the paid collector', async () => {
  const outputDirectory = await mkdtemp(
    join(tmpdir(), 'apify-benchmark-dry-run-'),
  );
  let collectorCalls = 0;

  /** Records an invalid paid call so the test can enforce the dry-run boundary. */
  const collectProfiles: ApifyBenchmarkCollector = async () => {
    collectorCalls += 1;
    throw new Error('Dry run invoked the paid collector.');
  };
  const dependencies: ApifyBenchmarkDependencies = {
    collectProfiles,
    environment: {},
    now: fixedClock,
  };
  const links = Array.from(
    { length: 60 },
    (_, index) => `https://linkedin.com/in/profile-${index}`,
  );
  links.push(`${links[0]}/`);

  try {
    const result = await runApifyBenchmark(
      {
        runId: 'dry-run',
        sourceKind: 'direct_links',
        sourcePath: 'profiles.csv',
        profileLinks: links,
        execute: false,
        offset: 5,
        limit: 50,
        outputDirectory,
      },
      testLogger(),
      dependencies,
    );

    assert.equal(collectorCalls, 0);
    assert.equal(result.summary.status, 'dry_run');
    assert.equal(result.plan.availableProfiles, 60);
    assert.equal(result.plan.selectedProfiles, 50);
    assert.deepEqual(result.plan.selectedProfileLinks, links.slice(5, 55));
    assert.equal(result.plan.plannedInitialActorRuns, 1);
    assert.equal(result.plan.plannedInitialWaves, 1);
    assert.deepEqual(result.profiles, []);
    assert.deepEqual(result.failures, []);

    const persistedPlan = JSON.parse(
      await readFile(result.artifacts.plan, 'utf8'),
    ) as { mode: string; selectedProfiles: number };
    assert.deepEqual(persistedPlan, {
      ...result.plan,
    });
    assert.equal(persistedPlan.mode, 'dry_run');
    assert.equal(persistedPlan.selectedProfiles, 50);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test('paid execution persists successes, expected failures, and validation', async () => {
  const outputDirectory = await mkdtemp(
    join(tmpdir(), 'apify-benchmark-execute-'),
  );
  const links = [
    'https://linkedin.com/in/alpha',
    'https://linkedin.com/in/bravo',
    'https://linkedin.com/in/missing',
  ];
  let receivedLinks: readonly string[] = [];

  /** Returns a deterministic mix of successful and permanently failed profiles. */
  const collectProfiles: ApifyBenchmarkCollector = async (profileLinks) => {
    receivedLinks = [...profileLinks];
    const profiles: RawApifyProfile[] = [
      { linkedinUrl: profileLinks[0], fullName: 'Alpha Person' },
      { linkedinUrl: profileLinks[1], fullName: 'Actual Bravo' },
    ];
    const failures: ApifyProfileFailure[] = [
      {
        linkedinUrl: profileLinks[2]!,
        inputIndex: 2,
        category: 'not_found',
        error: 'Profile not found',
        attempts: 1,
        retryable: false,
        retryExhausted: false,
        status: 404,
      },
    ];
    return {
      profiles,
      failures,
      stats: collectionStats(profileLinks.length, profiles.length, failures.length),
    };
  };

  try {
    const result = await runApifyBenchmark(
      {
        runId: 'execute',
        sourceKind: 'linked_helper_csv',
        sourcePath: 'profiles.csv',
        profileLinks: links,
        expectedIdentities: [
          { linkedinUrl: links[0]!, fullName: 'Alpha Person' },
          { linkedinUrl: links[1]!, fullName: 'Expected Bravo' },
        ],
        execute: true,
        offset: 0,
        outputDirectory,
      },
      testLogger(),
      {
        collectProfiles,
        environment: {},
        now: fixedClock,
      },
    );

    assert.deepEqual(receivedLinks, links);
    assert.equal(result.summary.status, 'completed');
    assert.equal(result.summary.validation?.passed, true);
    assert.deepEqual(result.summary.identityComparison, {
      comparedProfiles: 2,
      matchingProfiles: 1,
      mismatches: [
        {
          linkedinUrl: links[1],
          expectedName: 'Expected Bravo',
          actualName: 'Actual Bravo',
        },
      ],
    });
    assert.equal(result.profiles.length, 2);
    assert.equal(result.failures.length, 1);

    const persistedProfiles = JSON.parse(
      await readFile(result.artifacts.profiles, 'utf8'),
    ) as RawApifyProfile[];
    const persistedFailures = JSON.parse(
      await readFile(result.artifacts.failures, 'utf8'),
    ) as ApifyProfileFailure[];
    assert.deepEqual(persistedProfiles, result.profiles);
    assert.deepEqual(persistedFailures, result.failures);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test('validation detects lost and duplicated provider results', () => {
  const requestedLinks = [
    'https://linkedin.com/in/alpha',
    'https://linkedin.com/in/bravo',
  ];
  const duplicateProfile = { linkedinUrl: requestedLinks[0] };
  const validation = validateApifyBenchmarkCollection(requestedLinks, {
    profiles: [duplicateProfile, duplicateProfile],
    failures: [],
    stats: collectionStats(requestedLinks.length, 2, 0),
  });

  assert.equal(validation.passed, false);
  assert.equal(validation.noDuplicateProfiles, false);
  assert.equal(validation.noMissingInputs, false);
  assert.deepEqual(validation.missingProfileLinks, [
    'https://www.linkedin.com/in/bravo',
  ]);
});

test('validation matches encoded inputs with decoded provider profile URLs', () => {
  const encodedUrl =
    'https://www.linkedin.com/in/jo%C3%A3o-leite-20415836';
  const decodedUrl = 'https://www.linkedin.com/in/joão-leite-20415836';
  const validation = validateApifyBenchmarkCollection([encodedUrl], {
    profiles: [{ linkedinUrl: decodedUrl }],
    failures: [],
    stats: collectionStats(1, 1, 0),
  });

  assert.equal(validation.passed, true);
  assert.equal(validation.noMissingInputs, true);
  assert.equal(validation.noUnexpectedResults, true);
  assert.deepEqual(validation.missingProfileLinks, []);
  assert.deepEqual(validation.unexpectedProfileLinks, []);
});
