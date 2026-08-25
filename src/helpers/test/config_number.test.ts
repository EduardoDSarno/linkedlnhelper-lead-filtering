import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONFIG_NUMBER_MINIMUMS,
  resolveConfigNumber,
} from '../config_number.js';

const DEFAULT_VALUE = 25;
const MAXIMUM_VALUE = 50;

test('uses the fallback for missing and blank values', () => {
  for (const value of [undefined, null, '', '   ', '\t\n']) {
    assert.equal(
      resolveConfigNumber(value, { fallback: DEFAULT_VALUE }),
      DEFAULT_VALUE,
    );
  }
});

test('accepts finite numbers and numeric strings', () => {
  assert.equal(resolveConfigNumber(4, { fallback: DEFAULT_VALUE }), 4);
  assert.equal(resolveConfigNumber(' 7.5 ', { fallback: DEFAULT_VALUE }), 7.5);
});

test('rejects non-numeric and non-finite values', () => {
  for (const value of ['invalid', Number.NaN, Infinity, true, [], {}]) {
    assert.equal(
      resolveConfigNumber(value, { fallback: DEFAULT_VALUE }),
      DEFAULT_VALUE,
    );
  }
});

test('floors a valid value when an integer is required', () => {
  assert.equal(
    resolveConfigNumber(7.9, { fallback: DEFAULT_VALUE, integer: true }),
    7,
  );
});

test('can either reject or clamp values below the minimum', () => {
  const rules = {
    fallback: DEFAULT_VALUE,
    integer: true,
    minimum: CONFIG_NUMBER_MINIMUMS.positive,
  } as const;

  assert.equal(resolveConfigNumber(0, rules), DEFAULT_VALUE);
  assert.equal(resolveConfigNumber(0, { ...rules, clampMinimum: true }), 1);
});

test('can either reject or clamp values above the maximum', () => {
  const rules = {
    fallback: DEFAULT_VALUE,
    integer: true,
    maximum: MAXIMUM_VALUE,
  } as const;

  assert.equal(resolveConfigNumber(100, rules), DEFAULT_VALUE);
  assert.equal(
    resolveConfigNumber(100, { ...rules, clampMaximum: true }),
    MAXIMUM_VALUE,
  );
});
