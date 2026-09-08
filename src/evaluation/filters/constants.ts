/**
 * First-pass routing for one profile.
 *
 * `Failed` means a hard exclude. `NextPhase` means the profile proceeds to AI.
 */
export const BROAD_DECISION = {
  Failed: 'Failed',
  NextPhase: 'NextPhase',
} as const;

/** The broad filter's routing decision for one profile. */
export type BroadEvaluationDecision =
  (typeof BROAD_DECISION)[keyof typeof BROAD_DECISION];

/** Result of one first-pass check against a profile. */
export const BROAD_OUTCOME = {
  matched: 'matched',
  notMatched: 'not_matched',
  unknown: 'unknown',
} as const;

/** A criterion's deterministic result before the AI evaluation stage. */
export type BroadCriterionOutcome =
  (typeof BROAD_OUTCOME)[keyof typeof BROAD_OUTCOME];

/** How a location or keyword list must match before the first pass will exclude. */
export const CRITERIA_MATCH = {
  any: 'any',
  all: 'all',
} as const;

/** Match mode shared by location and keyword reject-lists. */
export type CriteriaMatch = (typeof CRITERIA_MATCH)[keyof typeof CRITERIA_MATCH];

