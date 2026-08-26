import { type KeywordList } from '../criterias/index.js';
import type { EvaluationProfileData } from '../evaluation_context.js';
import { BROAD_OUTCOME, CRITERIA_MATCH } from './constants.js';
import {
  containsNormalizedTerm,
  criterionOutcome,
  normalizedText,
} from './helpers.js';
import type { BroadCriterionResult } from './types.js';

/** Collects the compact profile text available to direct keyword matching. */
function searchableText(profile: EvaluationProfileData): Array<{
  source: string;
  value: string;
}> {
  return [
    ...(profile.headline ? [{ source: 'headline', value: profile.headline }] : []),
    ...(profile.location?.text
      ? [{ source: 'current location', value: profile.location.text }]
      : []),
    ...(profile.about ? [{ source: 'about', value: profile.about }] : []),
    ...profile.experience.flatMap((experience) => [
      { source: 'job title', value: experience.position },
      { source: 'company', value: experience.companyName },
      ...(experience.location
        ? [{ source: 'job location', value: experience.location }]
        : []),
    ]),
    ...(profile.workDetails ?? []).flatMap((details) => [
      ...(details.description
        ? [{ source: 'job description', value: details.description }]
        : []),
      ...(details.employmentType
        ? [{ source: 'employment type', value: details.employmentType }]
        : []),
      ...(details.workplaceType
        ? [{ source: 'workplace type', value: details.workplaceType }]
        : []),
    ]),
  ];
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
