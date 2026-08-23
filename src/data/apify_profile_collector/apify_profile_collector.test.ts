import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { collectApifyProfilesWithExecutor } from './index.js';
import type {
  ApifyBatchExecutor,
  RawApifyProfile,
} from './index.js';

function successfulRecord(linkedinUrl: string): RawApifyProfile {
  return {
    linkedinUrl,
    originalQuery: linkedinUrl,
    firstName: 'Test',
  };
}

test('pools transient failures across batches and never retries permanent failures', async () => {
  const links = [
    'https://linkedin.com/in/alpha',
    'https://linkedin.com/in/bravo',
    'https://linkedin.com/in/charlie',
    'https://linkedin.com/in/delta',
  ];
  const calls: Array<{ round: number; links: readonly string[] }> = [];

  const executeBatch: ApifyBatchExecutor = async (batch, context) => {
    calls.push({ round: context.round, links: [...batch] });

    if (context.round === 1 && batch.includes(links[0]!)) {
      return {
        records: [
          successfulRecord(links[0]!),
          {
            originalQuery: links[1],
            error: 'Temporary upstream failure',
            status: 500,
          },
        ],
      };
    }

    if (context.round === 1) {
      return {
        records: [
          {
            originalQuery: links[2],
            error: 'Profile not found',
            status: 404,
          },
          {
            originalQuery: links[3],
            error: 'Too many requests',
            status: 429,
          },
        ],
      };
    }

    return { records: batch.map(successfulRecord) };
  };

  const result = await collectApifyProfilesWithExecutor(
    links,
    executeBatch,
    undefined,
    {
      batchSize: 2,
      concurrency: 2,
      maxAttempts: 3,
      retryBaseDelayMs: 0,
    },
  );

  assert.deepEqual(
    result.profiles.map((profile) => profile['linkedinUrl']),
    [links[0], links[1], links[3]],
  );
  assert.equal(result.failures.length, 1);
  assert.deepEqual(result.failures[0], {
    linkedinUrl: links[2],
    inputIndex: 2,
    category: 'not_found',
    error: 'Profile not found',
    attempts: 1,
    retryable: false,
    retryExhausted: false,
    status: 404,
    raw: {
      originalQuery: links[2],
      error: 'Profile not found',
      status: 404,
    },
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2], {
    round: 2,
    links: [links[1], links[3]],
  });
  assert.equal(calls[2]!.links.includes(links[0]!), false);
  assert.equal(calls[2]!.links.includes(links[2]!), false);
  assert.deepEqual(result.stats, {
    requestedProfiles: 4,
    collectedProfiles: 3,
    failedProfiles: 1,
    permanentFailures: 1,
    exhaustedTransientFailures: 0,
    retriedProfiles: 2,
    totalProfileAttempts: 6,
    roundsCompleted: 2,
    retryRounds: 1,
    actorRuns: 3,
    batchSize: 2,
    batchConcurrency: 2,
    unexpectedProviderRecords: 0,
  });
});

test('keeps Actor-run concurrency within the configured bound', async () => {
  const links = Array.from(
    { length: 25 },
    (_, index) => `https://linkedin.com/in/profile-${index + 1}`,
  );
  let activeRuns = 0;
  let maximumActiveRuns = 0;

  const executeBatch: ApifyBatchExecutor = async (batch) => {
    activeRuns += 1;
    maximumActiveRuns = Math.max(maximumActiveRuns, activeRuns);
    await delay(10);
    activeRuns -= 1;
    return { records: batch.map(successfulRecord) };
  };

  const result = await collectApifyProfilesWithExecutor(
    links,
    executeBatch,
    undefined,
    {
      batchSize: 10,
      concurrency: 2,
      maxAttempts: 1,
      retryBaseDelayMs: 0,
    },
  );

  assert.equal(maximumActiveRuns, 2);
  assert.equal(result.profiles.length, 25);
  assert.equal(result.failures.length, 0);
  assert.equal(result.stats.actorRuns, 3);
  assert.equal(result.stats.roundsCompleted, 1);
});

test('correlates out-of-order records by LinkedIn URL', async () => {
  const links = [
    'https://linkedin.com/in/first',
    'https://linkedin.com/in/second',
  ];

  const result = await collectApifyProfilesWithExecutor(
    links,
    async () => ({
      records: [
        { linkedinUrl: links[1], firstName: 'Second' },
        { linkedinUrl: links[0], firstName: 'First' },
      ],
    }),
    undefined,
    { retryBaseDelayMs: 0 },
  );

  assert.deepEqual(
    result.profiles.map((profile) => profile['firstName']),
    ['First', 'Second'],
  );
});

test('reports a transient failure after its retry budget is exhausted', async () => {
  const link = 'https://linkedin.com/in/unavailable';
  let calls = 0;

  const result = await collectApifyProfilesWithExecutor(
    [link],
    async () => {
      calls += 1;
      throw Object.assign(new Error('Provider is unavailable'), {
        statusCode: 503,
      });
    },
    undefined,
    {
      maxAttempts: 2,
      retryBaseDelayMs: 0,
    },
  );

  assert.equal(calls, 2);
  assert.equal(result.profiles.length, 0);
  assert.deepEqual(result.failures, [
    {
      linkedinUrl: link,
      inputIndex: 0,
      category: 'provider_unavailable',
      error: 'Provider is unavailable',
      attempts: 2,
      retryable: true,
      retryExhausted: true,
      status: 503,
    },
  ]);
});
