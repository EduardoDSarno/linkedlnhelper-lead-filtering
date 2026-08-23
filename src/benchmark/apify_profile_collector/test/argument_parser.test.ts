import assert from 'node:assert/strict';
import test from 'node:test';

import { parseApifyBenchmarkArguments } from '../argument_parser.js';

test('defaults to dry-run mode with no collector overrides', () => {
  assert.deepEqual(parseApifyBenchmarkArguments(['profiles.csv']), {
    inputPath: 'profiles.csv',
    profileLinks: [],
    execute: false,
    offset: 0,
    collectorOptions: {},
  });
});

test('parses paid execution, selection, and collector overrides', () => {
  assert.deepEqual(
    parseApifyBenchmarkArguments([
      'profiles.csv',
      '--execute',
      '--offset',
      '10',
      '--limit',
      '50',
      '--label',
      'full-batch',
      '--batch-size',
      '25',
      '--concurrency',
      '5',
      '--max-attempts',
      '2',
    ]),
    {
      inputPath: 'profiles.csv',
      profileLinks: [],
      execute: true,
      offset: 10,
      limit: 50,
      label: 'full-batch',
      collectorOptions: {
        batchSize: 25,
        concurrency: 5,
        maxAttempts: 2,
      },
    },
  );
});

test('accepts repeated direct profile URLs without an input file', () => {
  assert.deepEqual(
    parseApifyBenchmarkArguments([
      '--url',
      'https://www.linkedin.com/in/alpha',
      '--url',
      'https://www.linkedin.com/in/bravo',
      '--limit',
      '2',
    ]),
    {
      profileLinks: [
        'https://www.linkedin.com/in/alpha',
        'https://www.linkedin.com/in/bravo',
      ],
      execute: false,
      offset: 0,
      limit: 2,
      collectorOptions: {},
    },
  );
});

test('rejects conflicting modes and invalid flags before any provider call', () => {
  assert.throws(
    () =>
      parseApifyBenchmarkArguments([
        'profiles.csv',
        '--execute',
        '--dry-run',
      ]),
    /either paid execution or dry-run mode/,
  );
  assert.throws(
    () => parseApifyBenchmarkArguments(['profiles.csv', '--limit', '0']),
    /--limit must be an integer/,
  );
  assert.throws(
    () => parseApifyBenchmarkArguments(['profiles.csv', '--unknown']),
    /Unknown benchmark flag/,
  );
  assert.throws(
    () =>
      parseApifyBenchmarkArguments([
        'profiles.csv',
        '--url',
        'https://www.linkedin.com/in/alpha',
      ]),
    /either an input file or direct --url values/,
  );
});
