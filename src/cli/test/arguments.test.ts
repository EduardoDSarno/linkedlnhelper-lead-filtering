import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLICATION_MODE,
  ApplicationArgumentsError,
  parseApplicationArguments,
} from '../arguments.js';

test('parses import and review invocations independently', () => {
  assert.deepEqual(parseApplicationArguments(['profiles.csv']), {
    mode: APPLICATION_MODE.importCsv,
    csvPath: 'profiles.csv',
  });
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

test('rejects missing, extra, conflicting, and unknown arguments', () => {
  const invalidArguments = [
    [],
    ['profiles.csv', 'unexpected.json'],
    ['--review', 'profiles.csv'],
    ['--review', 'profiles.csv', 'criteria.json', 'unexpected.json'],
    ['--review', '--review', 'profiles.csv', 'criteria.json'],
    ['--collect', 'profiles.csv'],
    ['--unknown', 'profiles.csv'],
  ];

  for (const arguments_ of invalidArguments) {
    assert.throws(
      () => parseApplicationArguments(arguments_),
      ApplicationArgumentsError,
    );
  }
});
