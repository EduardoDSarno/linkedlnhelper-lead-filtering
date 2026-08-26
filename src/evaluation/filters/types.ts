import type { EvaluationProfileData } from '../evaluation_context.js';
import type {
  BroadCriterionOutcome,
  BroadEvaluationDecision,
} from './constants.js';

/** One direct criterion result and the profile evidence used to reach it. */
export interface BroadCriterionResult {
  criterion: string;
  outcome: BroadCriterionOutcome;
  excludes: boolean;
  evidence: string[];
}

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
