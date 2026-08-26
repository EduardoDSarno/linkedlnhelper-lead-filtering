import type { EvaluationProfileData } from '../evaluation_context.js';
import type {
  BroadCriterionOutcome,
  BroadEvaluationDecision,
} from './constants.js';

/** One direct criterion result and the profile evidence used to reach it. */
export interface BroadCriterionResult {
  readonly criterion: string;
  readonly outcome: BroadCriterionOutcome;
  readonly excludes: boolean;
  readonly evidence: readonly string[];
}

/** The direct evaluation results and next action for one compact profile. */
export interface ProfileBroadEvaluation {
  readonly profileId: string;
  readonly decision: BroadEvaluationDecision;
  readonly decisionMessage: string;
  readonly results: readonly BroadCriterionResult[];
}

/** The profiles retained for AI plus every broad-filter decision. */
export interface BroadFilterBatchResult {
  readonly profilesForAi: readonly EvaluationProfileData[];
  readonly evaluations: readonly ProfileBroadEvaluation[];
}
