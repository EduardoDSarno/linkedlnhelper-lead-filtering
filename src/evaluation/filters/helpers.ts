import { BROAD_OUTCOME, type BroadCriterionOutcome } from './constants.js';

/** Maps a definite yes/no check onto the shared criterion outcome constants. */
export function criterionOutcome(matched: boolean): BroadCriterionOutcome {
  return matched ? BROAD_OUTCOME.matched : BROAD_OUTCOME.notMatched;
}

