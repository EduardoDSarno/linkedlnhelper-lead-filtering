import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROFILE_IMAGE_DEFAULTS,
  PROFILE_IMAGE_LIMITS,
  resolveProfileImageBatchConcurrency,
  resolveProfileImageExtractionOptions,
} from '../config.js';

test('resolves the documented image defaults when options are absent', () => {
  assert.deepEqual(resolveProfileImageExtractionOptions(), {
    model: PROFILE_IMAGE_DEFAULTS.model,
    resolution: PROFILE_IMAGE_DEFAULTS.resolution,
    requestTimeoutMs: PROFILE_IMAGE_DEFAULTS.requestTimeoutMs,
    imageDownloadTimeoutMs: PROFILE_IMAGE_DEFAULTS.downloadTimeoutMs,
    maxImageBytes: PROFILE_IMAGE_DEFAULTS.maximumBytes,
    maxRetries: PROFILE_IMAGE_DEFAULTS.maxRetries,
  });
});

test('normalizes valid extraction options into SDK-safe values', () => {
  assert.deepEqual(
    resolveProfileImageExtractionOptions({
      model: '  configured-model  ',
      resolution: 'high',
      requestTimeoutMs: 1_500.9,
      imageDownloadTimeoutMs: 700.5,
      maxImageBytes: 2_048.7,
      maxRetries: 2.9,
    }),
    {
      model: 'configured-model',
      resolution: 'high',
      requestTimeoutMs: 1_500,
      imageDownloadTimeoutMs: 700,
      maxImageBytes: 2_048,
      maxRetries: 2,
    },
  );
});

test('falls back when extraction limits are unusable at runtime', () => {
  assert.deepEqual(
    resolveProfileImageExtractionOptions({
      model: ' ',
      requestTimeoutMs: Number.NaN,
      imageDownloadTimeoutMs: -1,
      maxImageBytes: 0.4,
      maxRetries: -1,
    }),
    {
      model: PROFILE_IMAGE_DEFAULTS.model,
      resolution: PROFILE_IMAGE_DEFAULTS.resolution,
      requestTimeoutMs: PROFILE_IMAGE_DEFAULTS.requestTimeoutMs,
      imageDownloadTimeoutMs: PROFILE_IMAGE_DEFAULTS.downloadTimeoutMs,
      maxImageBytes: PROFILE_IMAGE_DEFAULTS.maximumBytes,
      maxRetries: PROFILE_IMAGE_DEFAULTS.maxRetries,
    },
  );
});

test('bounds batch concurrency through the shared image configuration', () => {
  assert.equal(
    resolveProfileImageBatchConcurrency(undefined),
    PROFILE_IMAGE_DEFAULTS.batchConcurrency,
  );
  assert.equal(resolveProfileImageBatchConcurrency(0), 1);
  assert.equal(
    resolveProfileImageBatchConcurrency(Number.POSITIVE_INFINITY),
    PROFILE_IMAGE_DEFAULTS.batchConcurrency,
  );
  assert.equal(
    resolveProfileImageBatchConcurrency(PROFILE_IMAGE_LIMITS.batchConcurrency + 1),
    PROFILE_IMAGE_LIMITS.batchConcurrency,
  );
});
