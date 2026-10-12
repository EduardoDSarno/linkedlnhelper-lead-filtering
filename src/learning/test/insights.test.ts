import assert from 'node:assert/strict';
import test from 'node:test';

import { agreement } from '../insights.js';

test('agreement separates too-loose, too-strict and unsure verdicts from agreements', () => {
  assert.deepEqual(
    agreement([
      { model: 'approved', person: 'approved' },
      { model: 'rejected', person: 'rejected' },
      { model: 'approved', person: 'rejected' },
      { model: 'rejected', person: 'approved' },
      { model: 'manual_review', person: 'approved' },
      { model: null, person: 'rejected' },
    ]),
    { total: 5, agreed: 2, aiTooLoose: 1, aiTooStrict: 1, aiUnsure: 1, agreementRate: 0.4 },
  );
});

test('agreement with nothing judged has no rate', () => {
  assert.equal(agreement([{ model: null, person: 'approved' }]).agreementRate, null);
});
