import type { DesiredMonthlyCompensationCriteria } from '../criterias/index.js';
import {
  COMPENSATION_RANGE_OUTCOME,
  type CompensationRangeMatch,
  type EstimatedTotalMonthlyCompensation,
  type ProfileModelEvaluation,
} from './types.js';

/** Required share of an estimated range that must overlap the desired range. */
export const MINIMUM_COMPENSATION_OVERLAP_RATIO = 0.5;

/** Reports whether the configured desired range contains usable bounds. */
function hasDesiredCompensationBound(
  desired: DesiredMonthlyCompensationCriteria,
): boolean {
  return (
    desired.minimumMonthlyCompensation !== undefined ||
    desired.maximumMonthlyCompensation !== undefined
  );
}

/** Reports whether the configured desired bounds form a valid range. */
function hasValidDesiredCompensationRange(
  desired: DesiredMonthlyCompensationCriteria,
): boolean {
  const minimum = desired.minimumMonthlyCompensation;
  const maximum = desired.maximumMonthlyCompensation;
  return minimum === undefined || maximum === undefined || maximum >= minimum;
}

/** Reports whether a point estimate is inside an optional-bound desired range. */
function desiredRangeContainsPoint(
  point: number,
  desired: DesiredMonthlyCompensationCriteria,
): boolean {
  return (
    (desired.minimumMonthlyCompensation === undefined ||
      point >= desired.minimumMonthlyCompensation) &&
    (desired.maximumMonthlyCompensation === undefined ||
      point <= desired.maximumMonthlyCompensation)
  );
}

/** Calculates how much of a non-point estimate lies inside the desired range. */
function compensationOverlapRatio(
  minimumEstimate: number,
  maximumEstimate: number,
  desired: DesiredMonthlyCompensationCriteria,
): number {
  const estimatedWidth = maximumEstimate - minimumEstimate;
  if (estimatedWidth === 0) {
    return desiredRangeContainsPoint(minimumEstimate, desired) ? 1 : 0;
  }

  const overlapMinimum = Math.max(
    minimumEstimate,
    desired.minimumMonthlyCompensation ?? Number.NEGATIVE_INFINITY,
  );
  const overlapMaximum = Math.min(
    maximumEstimate,
    desired.maximumMonthlyCompensation ?? Number.POSITIVE_INFINITY,
  );
  const overlapWidth = Math.max(0, overlapMaximum - overlapMinimum);
  return overlapWidth / estimatedWidth;
}

/**
 * Compares one validated estimate with the desired campaign range.
 *
 * The comparison is unknown when either side lacks enough information. A
 * supported estimate matches only when its overlap exceeds the configured
 * share of the estimate's own width.
 */
export function evaluateCompensationRangeMatch(
  estimate: EstimatedTotalMonthlyCompensation,
  desired: DesiredMonthlyCompensationCriteria,
): CompensationRangeMatch {
  if (!hasDesiredCompensationBound(desired)) {
    return {
      outcome: COMPENSATION_RANGE_OUTCOME.unknown,
      explanation: 'The campaign did not configure a desired compensation range.',
    };
  }

  if (!hasValidDesiredCompensationRange(desired)) {
    return {
      outcome: COMPENSATION_RANGE_OUTCOME.unknown,
      explanation: 'The campaign configured an inverted compensation range.',
    };
  }

  if (estimate.status === 'insufficient_evidence') {
    return {
      outcome: COMPENSATION_RANGE_OUTCOME.unknown,
      explanation: 'The profile did not support a compensation estimate.',
    };
  }

  const overlapRatio = compensationOverlapRatio(
    estimate.minimumMonthlyCompensation,
    estimate.maximumMonthlyCompensation,
    desired,
  );
  const matches = overlapRatio > MINIMUM_COMPENSATION_OVERLAP_RATIO;

  return {
    outcome: matches
      ? COMPENSATION_RANGE_OUTCOME.matched
      : COMPENSATION_RANGE_OUTCOME.notMatched,
    overlapRatio,
    explanation: matches
      ? 'The estimated range overlaps more than the required share.'
      : 'The estimated range does not overlap more than the required share.',
  };
}

/** Attaches a deterministic compensation result without changing model decisions. */
export function attachCompensationRangeMatch(
  evaluation: ProfileModelEvaluation,
  desired: DesiredMonthlyCompensationCriteria,
): ProfileModelEvaluation {
  return {
    ...evaluation,
    compensationRangeMatch: evaluateCompensationRangeMatch(
      evaluation.estimatedTotalMonthlyCompensation,
      desired,
    ),
  };
}
