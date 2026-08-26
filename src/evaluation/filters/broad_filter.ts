import type { FullEvaluationCriteria } from '../criterias/index.js';
import type {
  EvaluationBatchContext,
  EvaluationProfileData,
} from '../evaluation_context.js';
import { evaluateAge } from './age.js';
import {
  BROAD_DECISION,
  type BroadEvaluationDecision,
} from './constants.js';
import { evaluateKeywordList } from './keyword.js';
import { evaluateLocation } from './location.js';
import { evaluateOpenToWork } from './open_to_work.js';
import { evaluatePhoto } from './photo.js';
import type {
  BroadCriterionResult,
  BroadFilterBatchResult,
  ProfileBroadEvaluation,
} from './types.js';

export {
  BROAD_DECISION,
  BROAD_FILTER_AGE_MARGIN_YEARS,
  BROAD_OUTCOME,
  CRITERIA_MATCH,
} from './constants.js';
export type {
  BroadCriterionOutcome,
  BroadEvaluationDecision,
  CriteriaMatch,
} from './constants.js';
export type {
  BroadCriterionResult,
  BroadFilterBatchResult,
  ProfileBroadEvaluation,
} from './types.js';

/** Describes the first evidence item that supports one criterion result. */
function resultEvidence(result: BroadCriterionResult): string {
  return result.evidence[0] ?? `The ${result.criterion} criterion has no evidence.`;
}

/** Fails a profile when any first-pass check is a hard no; otherwise sends it to the next phase. */
function broadDecision(results: BroadCriterionResult[]): {
  decision: BroadEvaluationDecision;
  message: string;
} {
  const exclusion = results.find((result) => result.excludes);

  if (exclusion) {
    return {
      decision: BROAD_DECISION.Failed,
      message: `Failed because ${exclusion.criterion}: ${resultEvidence(exclusion)}`,
    };
  }

  return {
    decision: BROAD_DECISION.NextPhase,
    message: 'Next phase because no direct criterion determined an exclusion.',
  };
}

/** Evaluates every first-pass hard-exclude check configured for one compact profile. */
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
  if (criteria.requirePhoto) results.push(evaluatePhoto(profile));
  if (criteria.openToWork !== undefined) {
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
    (_profile, index) => evaluations[index]?.decision === BROAD_DECISION.NextPhase,
  );

  return { profilesForAi, evaluations };
}
