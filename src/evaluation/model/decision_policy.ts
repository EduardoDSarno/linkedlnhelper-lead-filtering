import {
  DECISION_POLICY_MODE,
  type DecisionPolicyCriteria,
} from '../criterias/index.js';
import {
  MODEL_EVALUATION_DECISION,
  type ModelEvaluationDecision,
  type ProfileModelAssessment,
  type ProfileModelEvaluation,
} from './types.js';

/**
 * Maps one validated match percentage to the campaign's deterministic outcome.
 *
 * An omitted or manual policy retains every successfully scored profile for a
 * person to decide.
 */
export function decisionForMatchPercent(
  matchPercent: number,
  policy: DecisionPolicyCriteria | undefined,
): ModelEvaluationDecision {
  if (!policy || policy.mode === DECISION_POLICY_MODE.manual) {
    return MODEL_EVALUATION_DECISION.manualReview;
  }
  if (matchPercent >= policy.minimumApprovalPercent) {
    return MODEL_EVALUATION_DECISION.approved;
  }
  if (matchPercent >= policy.minimumManualReviewPercent) {
    return MODEL_EVALUATION_DECISION.manualReview;
  }
  return MODEL_EVALUATION_DECISION.rejected;
}

/** Adds the application-owned decision without changing Gemini's assessment. */
export function applyDecisionPolicy(
  assessment: ProfileModelAssessment,
  policy: DecisionPolicyCriteria | undefined,
): ProfileModelEvaluation {
  return {
    ...assessment,
    decision: decisionForMatchPercent(assessment.matchPercent, policy),
  };
}
