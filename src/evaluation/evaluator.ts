import {
  evaluateBroadCriteria,
  filterEvaluationBatch,
} from './broad_filter.js';
import type {
  BroadFilterBatchResult,
  ProfileBroadEvaluation,
} from './broad_filter.js';
import type {
  EvaluationBatchContext,
  EvaluationContext,
} from './evaluation_context.js';

/** Runs the direct broad criteria for one compact profile evaluation context. */
export function run_evaluation(
  context: EvaluationContext,
): ProfileBroadEvaluation {
  return evaluateBroadCriteria(context.profile, context.criteria);
}

/** Filters a shared-criteria profile batch down to the profiles needing AI. */
export function run_gross_evaluation(
  context: EvaluationBatchContext,
): BroadFilterBatchResult {
  return filterEvaluationBatch(context);
}
