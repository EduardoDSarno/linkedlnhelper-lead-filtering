import { type AgeCriteria } from '../criterias/index.js';
import type { EvaluationProfileData } from '../evaluation_context.js';
import type { ApparentAgeBracket, ApparentAgeConfidence } from '../../image_extractor/index.js';
import { BROAD_FILTER_AGE_MARGIN_YEARS, BROAD_OUTCOME } from './constants.js';
import { criterionOutcome } from './helpers.js';
import type { BroadCriterionResult } from './types.js';

/** Apparent-age confidence values that are too weak to use as a first-pass exclude. */
const UNRELIABLE_AGE_CONFIDENCE: ReadonlySet<ApparentAgeConfidence> = new Set([
  'low',
  'unassessable',
]);

/** Numeric bounds implied by each apparent-age bracket name. */
const APPARENT_AGE_BRACKET_RANGES: Record<
  Exclude<ApparentAgeBracket, 'unknown'>,
  { minimum: number; maximum: number }
> = {
  under_25: { minimum: 0, maximum: 24 },
  '25_34': { minimum: 25, maximum: 34 },
  '35_44': { minimum: 35, maximum: 44 },
  '45_54': { minimum: 45, maximum: 54 },
  '55_64': { minimum: 55, maximum: 64 },
  '65_plus': { minimum: 65, maximum: Infinity },
};

/** Reports whether an apparent-age bracket sits entirely outside the padded campaign range. */
function isBracketOutsidePaddedRange(
  range: { minimum: number; maximum: number },
  criteria: AgeCriteria,
): boolean {
  const paddedMinimum =
    criteria.minimumAge === undefined
      ? undefined
      : criteria.minimumAge - BROAD_FILTER_AGE_MARGIN_YEARS;
  const paddedMaximum =
    criteria.maximumAge === undefined
      ? undefined
      : criteria.maximumAge + BROAD_FILTER_AGE_MARGIN_YEARS;

  return (
    (paddedMinimum !== undefined && range.maximum < paddedMinimum) ||
    (paddedMaximum !== undefined && range.minimum > paddedMaximum)
  );
}

/** Evaluates apparent age against the campaign range, excluding only clear misses. */
export function evaluateAge(
  profile: EvaluationProfileData,
  criteria: AgeCriteria,
): BroadCriterionResult {
  const apparentAge = profile.imageAnalysis?.apparentAge;

  if (
    !apparentAge ||
    apparentAge.bracket === 'unknown' ||
    UNRELIABLE_AGE_CONFIDENCE.has(apparentAge.confidence)
  ) {
    return {
      criterion: 'age',
      outcome: BROAD_OUTCOME.unknown,
      excludes: false,
      evidence: ['No reliable apparent-age estimate is available.'],
    };
  }

  const range = APPARENT_AGE_BRACKET_RANGES[apparentAge.bracket];
  const excludes = isBracketOutsidePaddedRange(range, criteria);

  return {
    criterion: 'age',
    outcome: criterionOutcome(!excludes),
    excludes,
    evidence: [
      `Apparent age: ${apparentAge.bracket} (${apparentAge.confidence} confidence).`,
    ],
  };
}
