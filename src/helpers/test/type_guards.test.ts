import assert from 'node:assert/strict';
import test from 'node:test';

import {
  asHttpStatus,
  asRecord,
  asString,
} from '../type_guards.js';

test('asRecord accepts plain objects and returns the same object', () => {
  const value = { a: 1 };

  // Identity, not equality: callers index into the returned object directly.
  assert.equal(asRecord(value), value);
});

test('asRecord rejects arrays, null, and primitives', () => {
  assert.equal(asRecord([]), undefined);
  assert.equal(asRecord([1, 2]), undefined);
  assert.equal(asRecord(null), undefined);
  assert.equal(asRecord(undefined), undefined);
  assert.equal(asRecord('text'), undefined);
  assert.equal(asRecord(7), undefined);
  assert.equal(asRecord(true), undefined);
});

test('asString trims and rejects blank strings', () => {
  assert.equal(asString('  value  '), 'value');
  assert.equal(asString('value'), 'value');
  assert.equal(asString(''), undefined);
  assert.equal(asString('   '), undefined);
  assert.equal(asString('\t\n'), undefined);
});

test('asString rejects non-strings, including numbers', () => {
  assert.equal(asString(42), undefined);
  assert.equal(asString(null), undefined);
  assert.equal(asString(undefined), undefined);
  assert.equal(asString({}), undefined);
});

test('asHttpStatus accepts finite numbers unchanged', () => {
  assert.equal(asHttpStatus(404), 404);
  assert.equal(asHttpStatus(500), 500);

  // Any finite number passes when it arrives already typed as a number, even
  // one that is not a valid HTTP status.
  assert.equal(asHttpStatus(0), 0);
  assert.equal(asHttpStatus(-1), -1);
});

test('asHttpStatus rejects non-finite numbers', () => {
  assert.equal(asHttpStatus(Number.NaN), undefined);
  assert.equal(asHttpStatus(Number.POSITIVE_INFINITY), undefined);
});

test('asHttpStatus parses only three-digit strings', () => {
  assert.equal(asHttpStatus('404'), 404);
  assert.equal(asHttpStatus('  429  '), 429);
  assert.equal(asHttpStatus('42'), undefined);
  assert.equal(asHttpStatus('4040'), undefined);
  assert.equal(asHttpStatus('4o4'), undefined);
  assert.equal(asHttpStatus(''), undefined);
});

test('asHttpStatus rejects other types', () => {
  assert.equal(asHttpStatus(null), undefined);
  assert.equal(asHttpStatus(undefined), undefined);
  assert.equal(asHttpStatus({ status: 404 }), undefined);
  assert.equal(asHttpStatus(['404']), undefined);
});
