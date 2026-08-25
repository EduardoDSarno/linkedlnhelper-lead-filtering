import type {
  EvaluationEffect,
  FullEvaluationCriteria,
  KeywordList,
  LocationCriteria,
  PhotoReviewCriteria,
} from './criterias/index.js';
import type {
  EvaluationBatchContext,
  EvaluationProfileData,
} from './evaluation_context.js';

/** A criterion's deterministic result before the AI evaluation stage. */
export type BroadCriterionOutcome =
  | 'matched'
  | 'not_matched'
  | 'unknown';

/** One direct criterion result and the profile evidence used to reach it. */
export interface BroadCriterionResult {
  criterion: string;
  effect: EvaluationEffect;
  outcome: BroadCriterionOutcome;
  evidence: string[];
}

/** The broad filter's routing decision for one profile. */
export type BroadEvaluationDecision = 'excluded' | 'send_to_ai';

/** The direct evaluation results and next action for one compact profile. */
export interface ProfileBroadEvaluation {
  profileId: string;
  decision: BroadEvaluationDecision;
  decisionMessage: string;
  results: BroadCriterionResult[];
}

/** The profiles retained for AI plus every broad-filter decision. */
export interface BroadFilterBatchResult {
  profilesForAi: EvaluationProfileData[];
  evaluations: ProfileBroadEvaluation[];
}

const LOW_CONFIDENCE_AGE_VALUES = new Set(['low', 'unassessable']);

const APPARENT_AGE_RANGES = {
  under_25: { minimum: 0, maximum: 24 },
  '25_34': { minimum: 25, maximum: 34 },
  '35_44': { minimum: 35, maximum: 44 },
  '45_54': { minimum: 45, maximum: 54 },
  '55_64': { minimum: 55, maximum: 64 },
  '65_plus': { minimum: 65, maximum: Infinity },
} as const;

/** Normalizes text so direct comparisons ignore casing, accents, and spacing. */
function normalizedText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
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
function evaluateLocation(
  profile: EvaluationProfileData,
  criteria: LocationCriteria,
): BroadCriterionResult {
  if (!profile.location) {
    return {
      criterion: 'location',
      effect: criteria.effect,
      outcome: 'unknown',
      evidence: ['The profile has no reported current location.'],
    };
  }

  const fieldResults = criteria.fields.map((field) => {
    const value = profile.location?.[field];
    const matched = value
      ? criteria.locations.some((configuredLocation) =>
          locationMatches(value, configuredLocation, field === 'text'),
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
  const outcome =
    criteria.match === 'any'
      ? matched.length > 0
        ? 'matched'
        : knownResults.length === fieldResults.length
          ? 'not_matched'
          : 'unknown'
      : notMatched.length > 0
        ? 'not_matched'
        : knownResults.length === fieldResults.length
          ? 'matched'
          : 'unknown';

  return {
    criterion: 'location',
    effect: criteria.effect,
    outcome,
    evidence: fieldResults.flatMap(({ field, value, matched: fieldMatched }) =>
      value
        ? [`${field}: ${value}${fieldMatched ? ' (matched)' : ''}`]
        : [`${field}: unavailable`],
    ),
  };
}

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

/** Evaluates one configured keyword list against every compact text field. */
function evaluateKeywordList(
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
      effect: criteria.effect,
      outcome: 'unknown',
      evidence: [
        terms.length === 0
          ? 'The configured keyword list is empty.'
          : 'The profile has no searchable text.',
      ],
    };
  }

  const matchedTerms = terms.filter((term) =>
    text.some(({ value }) => normalizedText(value).includes(term)),
  );
  const outcome =
    criteria.match === 'any'
      ? matchedTerms.length > 0
        ? 'matched'
        : 'not_matched'
      : criteria.match === 'all'
        ? matchedTerms.length === terms.length
          ? 'matched'
          : 'not_matched'
        : matchedTerms.length === 0
          ? 'matched'
          : 'not_matched';

  return {
    criterion: `keywordLists[${index}]`,
    effect: criteria.effect,
    outcome,
    evidence:
      matchedTerms.length > 0
        ? matchedTerms.flatMap((term) =>
            text
              .filter(({ value }) => normalizedText(value).includes(term))
              .map(({ source }) => `"${term}" matched ${source}.`),
          )
        : ['No configured terms matched the compact profile text.'],
  };
}

/** Evaluates the existing apparent-age range when it is reliable enough to use. */
function evaluateAge(
  profile: EvaluationProfileData,
  criteria: NonNullable<FullEvaluationCriteria['age']>,
): BroadCriterionResult {
  const apparentAge = profile.imageAnalysis?.apparentAge;

  if (
    !apparentAge ||
    apparentAge.bracket === 'unknown' ||
    LOW_CONFIDENCE_AGE_VALUES.has(apparentAge.confidence)
  ) {
    return {
      criterion: 'age',
      effect: criteria.effect,
      outcome: 'unknown',
      evidence: ['No reliable apparent-age estimate is available.'],
    };
  }

  const range = APPARENT_AGE_RANGES[apparentAge.bracket];
  const isOutsideRange =
    (criteria.minimumAge !== undefined && range.maximum < criteria.minimumAge) ||
    (criteria.maximumAge !== undefined && range.minimum > criteria.maximumAge);
  const isEntirelyInsideRange =
    (criteria.minimumAge === undefined || range.minimum >= criteria.minimumAge) &&
    (criteria.maximumAge === undefined || range.maximum <= criteria.maximumAge);

  return {
    criterion: 'age',
    effect: criteria.effect,
    outcome: isOutsideRange
      ? 'not_matched'
      : isEntirelyInsideRange
        ? 'matched'
        : 'unknown',
    evidence: [
      `Apparent age: ${apparentAge.bracket} (${apparentAge.confidence} confidence).`,
    ],
  };
}

/** Combines the individual checks that form one photo-review criterion. */
function combineOutcomes(outcomes: BroadCriterionOutcome[]): BroadCriterionOutcome {
  if (outcomes.includes('not_matched')) return 'not_matched';
  if (outcomes.includes('unknown')) return 'unknown';
  return 'matched';
}

/** Evaluates photo availability and the existing image-review requirement. */
function evaluatePhotoReview(
  profile: EvaluationProfileData,
  criteria: PhotoReviewCriteria,
): BroadCriterionResult {
  const outcomes: BroadCriterionOutcome[] = [];
  const evidence: string[] = [];

  if (criteria.requirePhoto !== undefined) {
    outcomes.push(
      profile.hasPhoto === criteria.requirePhoto ? 'matched' : 'not_matched',
    );
    evidence.push(profile.hasPhoto ? 'A profile photo is available.' : 'No profile photo is available.');
  }

  if (criteria.requireReview !== undefined) {
    if (!profile.imageAnalysis) {
      outcomes.push('unknown');
      evidence.push('No image analysis is available.');
    } else {
      outcomes.push(
        profile.imageAnalysis.reviewRequired === criteria.requireReview
          ? 'matched'
          : 'not_matched',
      );
      evidence.push(
        profile.imageAnalysis.reviewRequired
          ? 'Image analysis requires review.'
          : 'Image analysis does not require review.',
      );
    }
  }

  return {
    criterion: 'photoReview',
    effect: criteria.effect,
    outcome: outcomes.length > 0 ? combineOutcomes(outcomes) : 'unknown',
    evidence:
      evidence.length > 0
        ? evidence
        : ['No photo-review requirement is configured.'],
  };
}

/** Evaluates the profile's reported open-to-work value. */
function evaluateOpenToWork(
  profile: EvaluationProfileData,
  criteria: NonNullable<FullEvaluationCriteria['openToWork']>,
): BroadCriterionResult {
  if (profile.openToWork === undefined) {
    return {
      criterion: 'openToWork',
      effect: criteria.effect,
      outcome: 'unknown',
      evidence: ['The profile does not report an open-to-work value.'],
    };
  }

  return {
    criterion: 'openToWork',
    effect: criteria.effect,
    outcome:
      profile.openToWork === criteria.expectedValue ? 'matched' : 'not_matched',
    evidence: [`Open to work: ${profile.openToWork}.`],
  };
}

/** Describes the first evidence item that supports one criterion result. */
function resultEvidence(result: BroadCriterionResult): string {
  return result.evidence[0] ?? `The ${result.criterion} criterion has no evidence.`;
}

/** Decides whether direct evidence is sufficient to exclude one profile. */
function broadDecision(results: BroadCriterionResult[]): {
  decision: BroadEvaluationDecision;
  message: string;
} {
  const matchedExclusion = results.find(
    (result) => result.effect === 'exclude' && result.outcome === 'matched',
  );

  if (matchedExclusion) {
    return {
      decision: 'excluded',
      message: `Excluded because ${matchedExclusion.criterion} matched an exclusion criterion: ${resultEvidence(matchedExclusion)}`,
    };
  }

  const includeResults = results.filter((result) => result.effect === 'include');
  const hasMatchedInclude = includeResults.some(
    (result) => result.outcome === 'matched',
  );
  const hasUnknownInclude = includeResults.some(
    (result) => result.outcome === 'unknown',
  );

  if (includeResults.length > 0 && !hasMatchedInclude && !hasUnknownInclude) {
    return {
      decision: 'excluded',
      message: `Excluded because no include criterion matched: ${includeResults
        .map((result) => `${result.criterion} (${resultEvidence(result)})`)
        .join('; ')}`,
    };
  }

  const matchedReview = results.find(
    (result) => result.effect === 'review' && result.outcome === 'matched',
  );
  if (matchedReview) {
    return {
      decision: 'send_to_ai',
      message: `Sent to AI because ${matchedReview.criterion} requires review: ${resultEvidence(matchedReview)}`,
    };
  }

  const unknownResult = results.find((result) => result.outcome === 'unknown');
  if (unknownResult) {
    return {
      decision: 'send_to_ai',
      message: `Sent to AI because ${unknownResult.criterion} is uncertain: ${resultEvidence(unknownResult)}`,
    };
  }

  const matchedInclude = includeResults.find(
    (result) => result.outcome === 'matched',
  );
  if (matchedInclude) {
    return {
      decision: 'send_to_ai',
      message: `Sent to AI because ${matchedInclude.criterion} matched an include criterion: ${resultEvidence(matchedInclude)}`,
    };
  }

  return {
    decision: 'send_to_ai',
    message: 'Sent to AI because no direct criterion determined an exclusion.',
  };
}

/** Evaluates every deterministic criterion configured for one compact profile. */
export function evaluateBroadCriteria(
  profile: EvaluationProfileData,
  criteria: FullEvaluationCriteria,
): ProfileBroadEvaluation {
  const results: BroadCriterionResult[] = [];

  if (criteria.location) results.push(evaluateLocation(profile, criteria.location));

  for (const [index, keywordList] of (criteria.keywordLists ?? []).entries()) {
    results.push(evaluateKeywordList(profile, keywordList, index));
  }

  if (criteria.age) results.push(evaluateAge(profile, criteria.age));
  if (criteria.photoReview) {
    results.push(evaluatePhotoReview(profile, criteria.photoReview));
  }
  if (criteria.openToWork) {
    results.push(evaluateOpenToWork(profile, criteria.openToWork));
  }

  const broadFilterDecision = broadDecision(results);

  return {
    profileId: profile.profileId,
    decision: broadFilterDecision.decision,
    decisionMessage: broadFilterDecision.message,
    results,
  };
}

/** Filters a shared-criteria batch down to profiles that still need AI evaluation. */
export function filterEvaluationBatch(
  batch: EvaluationBatchContext,
): BroadFilterBatchResult {
  const evaluations = batch.profiles.map((profile) =>
    evaluateBroadCriteria(profile, batch.criteria),
  );
  const profilesForAi = batch.profiles.filter(
    (_profile, index) => evaluations[index]?.decision === 'send_to_ai',
  );

  return { profilesForAi, evaluations };
}
