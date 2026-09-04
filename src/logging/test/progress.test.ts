import assert from 'node:assert/strict';
import test from 'node:test';

import { displayIndex, displayRange, elapsedMs } from '../progress.js';

test('converts 0-based indexes into the 1-based positions shown in logs', () => {
  assert.equal(displayIndex(0), 1);
  assert.equal(displayIndex(4), 5);
});

test('covers a request group as an inclusive 1-based range', () => {
  assert.deepEqual(displayRange(0, 5), { profileStart: 1, profileEnd: 5 });
  assert.deepEqual(displayRange(5, 2), { profileStart: 6, profileEnd: 7 });
  assert.deepEqual(displayRange(10, 0), { profileStart: 0, profileEnd: 0 });
});

test('reports elapsed milliseconds from a captured start', () => {
  assert.ok(elapsedMs(Date.now()) >= 0);
});
