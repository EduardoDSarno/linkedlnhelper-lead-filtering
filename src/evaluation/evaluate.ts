import type { EvaluationBatchContext } from './context.js';
import { filterEvaluationBatch } from './filters/broad_filter.js';
import type { BroadFilterBatchResult } from './filters/types.js';
import { evaluateProfilesWithModel } from './model/index.js';
import type {
  ModelEvaluationOptions,
  ModelEvaluationOutcome,
} from './model/index.js';

/** The deterministic and model-assisted results of one evaluation run. */
export interface EvaluationRunResult {
  readonly broadFilter: BroadFilterBatchResult;
  readonly modelEvaluation: ModelEvaluationOutcome;
}

/**
 * Runs deterministic exclusions before requesting professional-fit evaluations.
 *
 * Profiles already excluded by direct criteria never consume Gemini tokens.
 * The model stage isolates request-group failures and preserves every broad
 * result regardless of downstream availability.
 */
export async function evaluateProfiles(
  context: EvaluationBatchContext,
  options: ModelEvaluationOptions = {},
): Promise<EvaluationRunResult> {
  const broadFilter = filterEvaluationBatch(context);
  const modelEvaluation = await evaluateProfilesWithModel(
    broadFilter.profilesForAi,
    context.criteria,
    options,
  );

  return { broadFilter, modelEvaluation };
}
