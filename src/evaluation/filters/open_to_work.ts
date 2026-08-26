import type { EvaluationProfileData } from '../evaluation_context.js';
import { BROAD_OUTCOME } from './constants.js';
import { criterionOutcome } from './helpers.js';
import type { BroadCriterionResult } from './types.js';

/** Evaluates the profile's reported open-to-work value against the campaign cut. */
export function evaluateOpenToWork(
  profile: EvaluationProfileData,
  expectedValue: boolean,
): BroadCriterionResult {
  if (profile.openToWork === undefined) {
    return {
      criterion: 'openToWork',
      outcome: BROAD_OUTCOME.unknown,
      excludes: false,
      evidence: ['The profile does not report an open-to-work value.'],
    };
  }

  const matched = profile.openToWork === expectedValue;

  return {
    criterion: 'openToWork',
    outcome: criterionOutcome(matched),
    excludes: !matched,
    evidence: [`Open to work: ${profile.openToWork}.`],
  };
}
