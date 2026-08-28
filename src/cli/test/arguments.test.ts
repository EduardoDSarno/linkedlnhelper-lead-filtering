import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLICATION_MODE,
  ApplicationArgumentsError,
  parseApplicationArguments,
} from '../arguments.js';

test('parses import, collection, and review invocations independently', () => {
  assert.deepEqual(parseApplicationArguments(['profiles.csv']), {
    mode: APPLICATION_MODE.importCsv,
    csvPath: 'profiles.csv',
  });
  assert.deepEqual(
    parseApplicationArguments(['--collect', 'profiles.csv']),
    {
      mode: APPLICATION_MODE.collectProfiles,
      csvPath: 'profiles.csv',
    },
  );
  assert.deepEqual(
    parseApplicationArguments([
      '--review',
      'profiles.csv',
      'criteria.json',
    ]),
    {
      mode: APPLICATION_MODE.reviewProfiles,
      csvPath: 'profiles.csv',
      criteriaPath: 'criteria.json',
    },
  );
});

test('keeps the Apify collection alias compatible', () => {
  assert.deepEqual(
    parseApplicationArguments(['--collect-apify', 'profiles.csv']),
    {
      mode: APPLICATION_MODE.collectProfiles,
      csvPath: 'profiles.csv',
    },
  );
});

test('rejects missing, extra, conflicting, and unknown arguments', () => {
  const invalidArguments = [
    [],
    ['profiles.csv', 'unexpected.json'],
    ['--review', 'profiles.csv'],
    ['--review', 'profiles.csv', 'criteria.json', 'unexpected.json'],
    ['--review', '--collect', 'profiles.csv', 'criteria.json'],
    ['--unknown', 'profiles.csv'],
  ];

  for (const arguments_ of invalidArguments) {
    assert.throws(
      () => parseApplicationArguments(arguments_),
      ApplicationArgumentsError,
    );
  }
});
