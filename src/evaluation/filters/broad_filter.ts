import type { FullEvaluationCriteria } from '../criterias/index.js';
import type {
  EvaluationBatchContext,
  EvaluationProfileData,
} from '../context.js';
import {
  BROAD_DECISION,
  type BroadEvaluationDecision,
} from './constants.js';
import { evaluatePhoto } from './photo.js';
import type {
  BroadCriterionResult,
  BroadFilterBatchResult,
  ProfileBroadEvaluation,
} from './types.js';

export {
  BROAD_DECISION,
  BROAD_OUTCOME,
  CRITERIA_MATCH,
} from './constants.js';
export type {
  BroadCriterionOutcome,
  BroadEvaluationDecision,
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

/**
 * Evaluates the only first-pass hard exclude that remains: a missing photo.
 *
 * Location, age, keyword, and open-to-work cuts used to run here too. They
 * were dropped because Linked Helper already filters location and photo
 * upstream, and because the remaining signals are judgement calls rather than
 * hard facts — an unreliable open-to-work badge is often contradicted by a
 * profile's own bio or last role. Every one of those criteria still reaches
 * the model through `campaignCriteriaForModel` (model/prompt.ts), so they now
 * shape the score instead of silently removing a profile before scoring.
 *
 * Photo stays a hard cut because the upstream Linked Helper filter is known
 * to leak profiles with no picture, and the model would only score those
 * lower rather than reliably rejecting them.
 */
export function evaluateBroadCriteria(
  profile: EvaluationProfileData,
  criteria: FullEvaluationCriteria,
): ProfileBroadEvaluation {
  const results: BroadCriterionResult[] = [];

  if (criteria.requirePhoto) results.push(evaluatePhoto(profile));

  const broadFilterDecision = broadDecision(results);

  return {
    profileId: profile.profileId,
    ...(profile.linkedHelperPublicId
      ? { linkedHelperPublicId: profile.linkedHelperPublicId }
      : {}),
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
