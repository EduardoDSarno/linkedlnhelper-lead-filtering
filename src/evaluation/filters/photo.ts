import type { EvaluationProfileData } from '../evaluation_context.js';
import { criterionOutcome } from './helpers.js';
import type { BroadCriterionResult } from './types.js';

/** Evaluates whether a required profile photo is present. */
export function evaluatePhoto(profile: EvaluationProfileData): BroadCriterionResult {
  return {
    criterion: 'requirePhoto',
    outcome: criterionOutcome(profile.hasPhoto),
    excludes: !profile.hasPhoto,
    evidence: [
      profile.hasPhoto
        ? 'A profile photo is available.'
        : 'No profile photo is available.',
    ],
  };
}
