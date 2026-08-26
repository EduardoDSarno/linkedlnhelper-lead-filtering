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

/**
 * Years of slack applied to each configured age bound during the first pass.
 *
 * Apparent age is a model guess in coarse brackets, so the filter only excludes
 * profiles whose bracket sits entirely outside the padded campaign range.
 */
export const BROAD_FILTER_AGE_MARGIN_YEARS = 7;

/**
 * Location field compared with substring matching because it holds the full
 * human-readable place string.
 */
export const LOCATION_TEXT_FIELD = 'text' as const;
