import assert from 'node:assert/strict';
import test from 'node:test';

import type { DecisionPolicyCriteria } from '../criterias/index.js';
import {
  MODEL_EVALUATION_DECISION,
  decisionForMatchPercent,
} from '../model/index.js';

const MANUAL_REVIEW_PERCENT = 50;
const APPROVAL_PERCENT = 75;

/** Builds the automatic score bands shared by boundary assertions. */
function automaticPolicy(): DecisionPolicyCriteria {
  return {
    mode: 'automatic',
    minimumManualReviewPercent: MANUAL_REVIEW_PERCENT,
    minimumApprovalPercent: APPROVAL_PERCENT,
  };
}

test('maps automatic score bands at both configured boundaries', () => {
  const policy = automaticPolicy();

  assert.equal(
    decisionForMatchPercent(APPROVAL_PERCENT, policy),
    MODEL_EVALUATION_DECISION.approved,
  );
  assert.equal(
    decisionForMatchPercent(MANUAL_REVIEW_PERCENT, policy),
    MODEL_EVALUATION_DECISION.manualReview,
  );
  assert.equal(
    decisionForMatchPercent(MANUAL_REVIEW_PERCENT - 1, policy),
    MODEL_EVALUATION_DECISION.rejected,
  );
});

test('keeps every score in manual review when automatic decisions are off', () => {
  const manualPolicy: DecisionPolicyCriteria = { mode: 'manual' };

  assert.equal(
    decisionForMatchPercent(APPROVAL_PERCENT, manualPolicy),
    MODEL_EVALUATION_DECISION.manualReview,
  );
  assert.equal(
    decisionForMatchPercent(MANUAL_REVIEW_PERCENT - 1, undefined),
    MODEL_EVALUATION_DECISION.manualReview,
  );
});
