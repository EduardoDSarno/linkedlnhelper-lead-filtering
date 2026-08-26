import { type LocationCriteria } from '../criterias/index.js';
import type { EvaluationProfileData } from '../evaluation_context.js';
import {
  BROAD_OUTCOME,
  CRITERIA_MATCH,
  LOCATION_TEXT_FIELD,
  type BroadCriterionOutcome,
  type CriteriaMatch,
} from './constants.js';
import { normalizedText } from './helpers.js';
import type { BroadCriterionResult } from './types.js';

/** Resolves location matching when some selected fields may be missing. */
function locationOutcome(
  match: CriteriaMatch,
  matchedCount: number,
  notMatchedCount: number,
  allFieldsKnown: boolean,
): BroadCriterionOutcome {
  if (match === CRITERIA_MATCH.any) {
    if (matchedCount > 0) return BROAD_OUTCOME.matched;
    return allFieldsKnown ? BROAD_OUTCOME.notMatched : BROAD_OUTCOME.unknown;
  }

  if (notMatchedCount > 0) return BROAD_OUTCOME.notMatched;
  return allFieldsKnown ? BROAD_OUTCOME.matched : BROAD_OUTCOME.unknown;
}

/** Checks whether one selected location field matches one configured location. */
function locationMatches(
  value: string,
  configuredLocation: string,
  includesLocationText: boolean,
): boolean {
  const normalizedValue = normalizedText(value);
  const normalizedConfiguredLocation = normalizedText(configuredLocation);

  if (!normalizedValue || !normalizedConfiguredLocation) return false;

  return includesLocationText
    ? normalizedValue.includes(normalizedConfiguredLocation)
    : normalizedValue === normalizedConfiguredLocation;
}

/** Evaluates a profile's reported current location against one location criterion. */
export function evaluateLocation(
  profile: EvaluationProfileData,
  criteria: LocationCriteria,
): BroadCriterionResult {
  if (!profile.location) {
    return {
      criterion: 'location',
      outcome: BROAD_OUTCOME.unknown,
      excludes: false,
      evidence: ['The profile has no reported current location.'],
    };
  }

  const fieldResults = criteria.fields.map((field) => {
    const value = profile.location?.[field];
    const matched = value
      ? criteria.locations.some((configuredLocation) =>
          locationMatches(value, configuredLocation, field === LOCATION_TEXT_FIELD),
        )
      : undefined;

    return { field, value, matched };
  });
  const knownResults = fieldResults.filter(
    (result): result is typeof result & { matched: boolean } =>
      result.matched !== undefined,
  );
  const matched = knownResults.filter((result) => result.matched);
  const notMatched = knownResults.filter((result) => !result.matched);
  const outcome = locationOutcome(
    criteria.match,
    matched.length,
    notMatched.length,
    knownResults.length === fieldResults.length,
  );

  return {
    criterion: 'location',
    outcome,
    excludes: outcome === BROAD_OUTCOME.notMatched,
    evidence: fieldResults.flatMap(({ field, value, matched: fieldMatched }) =>
      value
        ? [`${field}: ${value}${fieldMatched ? ' (matched)' : ''}`]
        : [`${field}: unavailable`],
    ),
  };
}
