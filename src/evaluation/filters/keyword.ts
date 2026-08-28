import { type KeywordList } from '../criterias/index.js';
import type { EvaluationProfileData } from '../context.js';
import { BROAD_OUTCOME, CRITERIA_MATCH } from './constants.js';
import {
  containsNormalizedTerm,
  criterionOutcome,
  normalizedText,
} from './helpers.js';
import type { BroadCriterionResult } from './types.js';

/** Provider value that identifies an experience as current. */
const CURRENT_EXPERIENCE_END_DATE = 'present';

/** Reports whether an experience is explicitly marked as current. */
function isCurrentExperience(
  experience: EvaluationProfileData['experience'][number],
): boolean {
  return (
    normalizedText(experience.endDate?.text ?? '') ===
    CURRENT_EXPERIENCE_END_DATE
  );
}

/**
 * Collects current-role titles for hard rejection.
 *
 * Headline is used only when the provider did not identify a current
 * experience. Historical roles must not trigger a current-role exclusion.
 */
function searchableText(profile: EvaluationProfileData): Array<{
  source: string;
  value: string;
}> {
  const currentRoleTitles = profile.experience
    .filter(isCurrentExperience)
    .map(({ position }) => ({ source: 'current job title', value: position }));

  if (currentRoleTitles.length > 0) return currentRoleTitles;

  return profile.headline
    ? [{ source: 'headline used as current-role fallback', value: profile.headline }]
    : [];
}

/** Evaluates one reject-list against every compact text field. */
export function evaluateKeywordList(
  profile: EvaluationProfileData,
  criteria: KeywordList,
  index: number,
): BroadCriterionResult {
  const terms = (criteria.list ?? [])
    .map((term) => normalizedText(term))
    .filter((term) => term.length > 0);
  const text = searchableText(profile);

  if (terms.length === 0 || text.length === 0) {
    return {
      criterion: `keywordLists[${index}]`,
      outcome: BROAD_OUTCOME.unknown,
      excludes: false,
      evidence: [
        terms.length === 0
          ? 'The configured keyword list is empty.'
          : 'The profile has no searchable text.',
      ],
    };
  }

  const matchedTerms = terms.filter((term) =>
    text.some(({ value }) => containsNormalizedTerm(value, term)),
  );
  const outcome =
    criteria.match === CRITERIA_MATCH.any
      ? criterionOutcome(matchedTerms.length > 0)
      : criterionOutcome(matchedTerms.length === terms.length);

  return {
    criterion: `keywordLists[${index}]`,
    outcome,
    excludes: outcome === BROAD_OUTCOME.matched,
    evidence:
      matchedTerms.length > 0
        ? matchedTerms.flatMap((term) =>
            text
              .filter(({ value }) => containsNormalizedTerm(value, term))
              .map(({ source }) => `"${term}" matched ${source}.`),
          )
        : ['No configured terms matched the compact profile text.'],
  };
}
