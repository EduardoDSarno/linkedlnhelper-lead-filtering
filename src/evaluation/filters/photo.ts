import type { EvaluationProfileData } from '../context.js';
import { criterionOutcome } from './helpers.js';
import type { BroadCriterionResult } from './types.js';

/**
 * Records whether a required profile photo is present, without excluding on it.
 *
 * This used to be a hard cut, and it was removing real candidates: a scraper
 * reads a profile anonymously, so a photo restricted to members or connections
 * looks identical to no photo at all. On one campaign it withheld 95 of 615
 * profiles from the model, including people whose pictures were current and
 * visible to the operator. The campaign's preference is now applied where the
 * evidence can actually be weighed — the model sees `requirePhoto` alongside
 * the photo itself and ranks accordingly.
 */
export function evaluatePhoto(profile: EvaluationProfileData): BroadCriterionResult {
  return {
    criterion: 'requirePhoto',
    outcome: criterionOutcome(profile.hasPhoto),
    excludes: false,
    evidence: [
      profile.hasPhoto
        ? 'A profile photo is available.'
        : 'No profile photo is available; ranked by the model rather than cut.',
    ],
  };
}
