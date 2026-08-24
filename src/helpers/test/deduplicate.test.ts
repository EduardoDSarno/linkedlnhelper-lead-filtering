import assert from 'node:assert/strict';
import test from 'node:test';

import { deduplicateBy } from '../deduplicate.js';

test('keeps the first item for each key and counts the rest', () => {
  const result = deduplicateBy(['a', 'b', 'a', 'c', 'b', 'a'], (item) => item);

  assert.deepEqual(result.uniqueItems, ['a', 'b', 'c']);
  assert.equal(result.duplicateCount, 3);
});

test('preserves first-seen order rather than sorting', () => {
  const result = deduplicateBy(['c', 'a', 'b'], (item) => item);

  assert.deepEqual(result.uniqueItems, ['c', 'a', 'b']);
});

test('keeps the first object when later objects share a key', () => {
  const first = { id: 1, label: 'first' };
  const later = { id: 1, label: 'later' };
  const result = deduplicateBy([first, later], (item) => item.id);

  assert.equal(result.uniqueItems.length, 1);

  // Object identity: the winner is the original item, not a copy or the later
  // duplicate. Callers rely on this to keep the earliest provider record.
  assert.equal(result.uniqueItems[0], first);
});

test('treats distinct keys from equal-looking items as distinct', () => {
  const result = deduplicateBy(
    [
      { id: 1, label: 'same' },
      { id: 2, label: 'same' },
    ],
    (item) => item.id,
  );

  assert.equal(result.uniqueItems.length, 2);
  assert.equal(result.duplicateCount, 0);
});

test('returns an empty result for an empty list', () => {
  const result = deduplicateBy([], (item: string) => item);

  assert.deepEqual(result.uniqueItems, []);
  assert.equal(result.duplicateCount, 0);
});

test('does not mutate the supplied list', () => {
  const items = ['a', 'a', 'b'];
  deduplicateBy(items, (item) => item);

  assert.deepEqual(items, ['a', 'a', 'b']);
});

test('separates numeric and string keys that look alike', () => {
  // Set membership compares by value and type, so 1 and '1' stay separate.
  const result = deduplicateBy(
    [{ key: 1 }, { key: '1' }],
    (item) => item.key as string | number,
  );

  assert.equal(result.uniqueItems.length, 2);
});
