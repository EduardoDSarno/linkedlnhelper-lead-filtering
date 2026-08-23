import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APIFY_COLLECTOR_DEFAULTS,
  APIFY_COLLECTOR_LIMITS,
  requireApifyApiKey,
  resolveApifyCollectorConfig,
} from '../config.js';

test('uses the Phase 1 production operating defaults', () => {
  assert.deepEqual(APIFY_COLLECTOR_DEFAULTS, {
    profilesPerActorRun: 50,
    actorRunConcurrency: 6,
    maxAttempts: 3,
    retryBaseDelayMs: 1_000,
  });
  assert.deepEqual(resolveApifyCollectorConfig({}, {}), {
    profilesPerActorRun: 50,
    actorRunConcurrency: 6,
    maxAttempts: 3,
    retryBaseDelayMs: 1_000,
  });
});

test('reads every supported collector setting from the environment', () => {
  const config = resolveApifyCollectorConfig(
    {},
    {
      APIFY_BATCH_SIZE: '75',
      APIFY_BATCH_CONCURRENCY: '20',
      APIFY_MAX_ATTEMPTS: '4',
      APIFY_RETRY_BASE_DELAY_MS: '2000',
    },
  );

  assert.deepEqual(config, {
    profilesPerActorRun: 75,
    actorRunConcurrency: 20,
    maxAttempts: 4,
    retryBaseDelayMs: 2_000,
  });
});

test('gives explicit options precedence and enforces safety ceilings', () => {
  const config = resolveApifyCollectorConfig(
    {
      batchSize: APIFY_COLLECTOR_LIMITS.profilesPerActorRun + 1,
      concurrency: APIFY_COLLECTOR_LIMITS.actorRunConcurrency + 1,
      maxAttempts: APIFY_COLLECTOR_LIMITS.maxAttempts + 1,
      retryBaseDelayMs: 0,
    },
    {
      APIFY_BATCH_SIZE: '25',
      APIFY_BATCH_CONCURRENCY: '5',
      APIFY_MAX_ATTEMPTS: '2',
      APIFY_RETRY_BASE_DELAY_MS: '5000',
    },
  );

  assert.deepEqual(config, {
    profilesPerActorRun: APIFY_COLLECTOR_LIMITS.profilesPerActorRun,
    actorRunConcurrency: APIFY_COLLECTOR_LIMITS.actorRunConcurrency,
    maxAttempts: APIFY_COLLECTOR_LIMITS.maxAttempts,
    retryBaseDelayMs: 0,
  });
});

test('falls back to defaults for unusable environment values', () => {
  const config = resolveApifyCollectorConfig(
    {},
    {
      APIFY_BATCH_SIZE: 'invalid',
      APIFY_BATCH_CONCURRENCY: '0',
      APIFY_MAX_ATTEMPTS: '-1',
      APIFY_RETRY_BASE_DELAY_MS: '-100',
    },
  );

  assert.deepEqual(config, {
    profilesPerActorRun: APIFY_COLLECTOR_DEFAULTS.profilesPerActorRun,
    actorRunConcurrency: APIFY_COLLECTOR_DEFAULTS.actorRunConcurrency,
    maxAttempts: APIFY_COLLECTOR_DEFAULTS.maxAttempts,
    retryBaseDelayMs: APIFY_COLLECTOR_DEFAULTS.retryBaseDelayMs,
  });
});

test('keeps the API key separate and rejects a missing credential', () => {
  assert.equal(
    requireApifyApiKey({ APIFY_API_KEY: '  test-api-key  ' }),
    'test-api-key',
  );
  assert.throws(
    () => requireApifyApiKey({ APIFY_API_KEY: '   ' }),
    /APIFY_API_KEY is not configured/,
  );
  assert.equal('apiKey' in resolveApifyCollectorConfig({}, {}), false);
});
