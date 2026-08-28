import assert from 'node:assert/strict';
import test from 'node:test';

import type { DesiredMonthlyCompensationCriteria } from '../criterias/index.js';
import {
  COMPENSATION_RANGE_OUTCOME,
  MINIMUM_COMPENSATION_OVERLAP_RATIO,
  evaluateCompensationRangeMatch,
} from '../model/index.js';
import type {
  EstimatedTotalMonthlyCompensation,
  EstimatedTotalMonthlyCompensationRange,
} from '../model/index.js';

const ESTIMATED_MINIMUM = 5_000;
const ESTIMATED_MAXIMUM = 10_000;
const DESIRED_MINIMUM = 7_000;
const DESIRED_MAXIMUM = 15_000;
const EXPECTED_OVERLAP_RATIO = 0.6;

/** Builds a supported compensation estimate without repeating response metadata. */
function estimatedCompensation(
  minimumMonthlyCompensation: number,
  maximumMonthlyCompensation: number,
): EstimatedTotalMonthlyCompensationRange {
  return {
    status: 'estimated',
    currency: 'BRL',
    minimumMonthlyCompensation,
    maximumMonthlyCompensation,
    confidence: 'medium',
    basis: ['Deterministic test fixture.'],
  };
}

/** Builds an estimate refusal used to verify unknown deterministic outcomes. */
function insufficientCompensation(): EstimatedTotalMonthlyCompensation {
  return {
    status: 'insufficient_evidence',
    reasons: ['The fixture intentionally omits compensation evidence.'],
  };
}

/** Builds the desired campaign range used by the primary overlap example. */
function desiredCompensation(): DesiredMonthlyCompensationCriteria {
  return {
    minimumMonthlyCompensation: DESIRED_MINIMUM,
    maximumMonthlyCompensation: DESIRED_MAXIMUM,
  };
}

test('matches when more than half of the estimated range overlaps the desired range', () => {
  const result = evaluateCompensationRangeMatch(
    estimatedCompensation(ESTIMATED_MINIMUM, ESTIMATED_MAXIMUM),
    desiredCompensation(),
  );

  assert.equal(result.outcome, COMPENSATION_RANGE_OUTCOME.matched);
  assert.equal(result.overlapRatio, EXPECTED_OVERLAP_RATIO);
});

test('does not match when overlap is exactly the configured threshold', () => {
  const estimatedWidth = ESTIMATED_MAXIMUM - ESTIMATED_MINIMUM;
  const exactThresholdMinimum =
    ESTIMATED_MAXIMUM - estimatedWidth * MINIMUM_COMPENSATION_OVERLAP_RATIO;
  const result = evaluateCompensationRangeMatch(
    estimatedCompensation(ESTIMATED_MINIMUM, ESTIMATED_MAXIMUM),
    { minimumMonthlyCompensation: exactThresholdMinimum },
  );

  assert.equal(result.outcome, COMPENSATION_RANGE_OUTCOME.notMatched);
  assert.equal(result.overlapRatio, MINIMUM_COMPENSATION_OVERLAP_RATIO);
});

test('matches a fully contained estimate and rejects a disjoint estimate', () => {
  const contained = evaluateCompensationRangeMatch(
    estimatedCompensation(ESTIMATED_MINIMUM, ESTIMATED_MAXIMUM),
    {
      minimumMonthlyCompensation: ESTIMATED_MINIMUM,
      maximumMonthlyCompensation: ESTIMATED_MAXIMUM,
    },
  );
  const disjoint = evaluateCompensationRangeMatch(
    estimatedCompensation(ESTIMATED_MINIMUM, ESTIMATED_MAXIMUM),
    { minimumMonthlyCompensation: ESTIMATED_MAXIMUM + 1 },
  );

  assert.equal(contained.outcome, COMPENSATION_RANGE_OUTCOME.matched);
  assert.equal(contained.overlapRatio, 1);
  assert.equal(disjoint.outcome, COMPENSATION_RANGE_OUTCOME.notMatched);
  assert.equal(disjoint.overlapRatio, 0);
});

test('supports independently open minimum and maximum desired bounds', () => {
  const minimumOnly = evaluateCompensationRangeMatch(
    estimatedCompensation(ESTIMATED_MINIMUM, ESTIMATED_MAXIMUM),
    { minimumMonthlyCompensation: DESIRED_MINIMUM },
  );
  const maximumOnly = evaluateCompensationRangeMatch(
    estimatedCompensation(ESTIMATED_MINIMUM, ESTIMATED_MAXIMUM),
    { maximumMonthlyCompensation: 8_000 },
  );

  assert.equal(minimumOnly.outcome, COMPENSATION_RANGE_OUTCOME.matched);
  assert.equal(minimumOnly.overlapRatio, EXPECTED_OVERLAP_RATIO);
  assert.equal(maximumOnly.outcome, COMPENSATION_RANGE_OUTCOME.matched);
  assert.equal(maximumOnly.overlapRatio, EXPECTED_OVERLAP_RATIO);
});

test('treats a point estimate as either completely inside or outside', () => {
  const inside = evaluateCompensationRangeMatch(
    estimatedCompensation(DESIRED_MINIMUM, DESIRED_MINIMUM),
    desiredCompensation(),
  );
  const outside = evaluateCompensationRangeMatch(
    estimatedCompensation(
      DESIRED_MAXIMUM + 1,
      DESIRED_MAXIMUM + 1,
    ),
    desiredCompensation(),
  );

  assert.equal(inside.outcome, COMPENSATION_RANGE_OUTCOME.matched);
  assert.equal(inside.overlapRatio, 1);
  assert.equal(outside.outcome, COMPENSATION_RANGE_OUTCOME.notMatched);
  assert.equal(outside.overlapRatio, 0);
});

test('returns unknown when the estimate or desired range cannot be compared', () => {
  const insufficient = evaluateCompensationRangeMatch(
    insufficientCompensation(),
    desiredCompensation(),
  );
  const unconfigured = evaluateCompensationRangeMatch(
    estimatedCompensation(ESTIMATED_MINIMUM, ESTIMATED_MAXIMUM),
    {},
  );
  const inverted = evaluateCompensationRangeMatch(
    estimatedCompensation(ESTIMATED_MINIMUM, ESTIMATED_MAXIMUM),
    {
      minimumMonthlyCompensation: DESIRED_MAXIMUM,
      maximumMonthlyCompensation: DESIRED_MINIMUM,
    },
  );

  assert.equal(insufficient.outcome, COMPENSATION_RANGE_OUTCOME.unknown);
  assert.equal(insufficient.overlapRatio, undefined);
  assert.equal(unconfigured.outcome, COMPENSATION_RANGE_OUTCOME.unknown);
  assert.equal(unconfigured.overlapRatio, undefined);
  assert.equal(inverted.outcome, COMPENSATION_RANGE_OUTCOME.unknown);
  assert.equal(inverted.overlapRatio, undefined);
});
