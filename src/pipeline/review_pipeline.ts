import type { ImportedCsvData } from '../dataCollector/csvdata.js';
import type { FullEvaluationCriteria } from '../evaluation/criterias/index.js';
import {
  createEvaluationBatchContext,
  evaluateProfiles,
} from '../evaluation/index.js';
import type { Logger } from '../logging/index.js';
import { DEFAULT_REVIEW_PIPELINE_DEPENDENCIES } from './config.js';
import { runFullProfilePipelineWithDependencies } from './full_profile_pipeline.js';
import {
  logBroadFilterDecisions,
  logModelDecisions,
} from './profile_decision_logging.js';
import type {
  ReviewPipelineDependencies,
  ReviewPipelineOptions,
  ReviewPipelineResult,
} from './types.js';

/** Runs the production CSV-to-profile-to-evaluation workflow. */
export async function runReviewPipeline(
  importedData: ImportedCsvData,
  criteria: FullEvaluationCriteria,
  logger: Logger,
  options: ReviewPipelineOptions = {},
): Promise<ReviewPipelineResult> {
  return runReviewPipelineWithDependencies(
    importedData,
    criteria,
    logger,
    DEFAULT_REVIEW_PIPELINE_DEPENDENCIES,
    options,
  );
}

/**
 * Connects acquisition and evaluation while keeping their implementations
 * independent and their paid boundaries replaceable in deterministic tests.
 */
export async function runReviewPipelineWithDependencies(
  importedData: ImportedCsvData,
  criteria: FullEvaluationCriteria,
  logger: Logger,
  dependencies: ReviewPipelineDependencies,
  options: ReviewPipelineOptions = {},
): Promise<ReviewPipelineResult> {
  logger.info(
    { importedProfiles: importedData.total_profiles },
    'Starting profile review pipeline.',
  );

  const profilePipeline = await runFullProfilePipelineWithDependencies(
    importedData,
    logger,
    dependencies.profilePipeline,
    options.profilePipeline,
  );
  const context = createEvaluationBatchContext(
    profilePipeline.profiles,
    criteria,
  );
  const evaluation = await evaluateProfiles(
    context,
    options.modelEvaluation,
  );
  const evaluationRun = {
    id: dependencies.createRunId(),
    createdAt: dependencies.now().toISOString(),
    criteria,
    evaluation,
  };
  logBroadFilterDecisions(
    logger,
    profilePipeline.profiles,
    evaluationRun.id,
    evaluation,
  );
  logModelDecisions(
    logger,
    profilePipeline.profiles,
    evaluationRun.id,
    evaluation,
  );
  const db = dependencies.openDatabase();

  try {
    dependencies.insertEvaluationRun(evaluationRun, db);
  } finally {
    db.close();
  }

  logger.info(
    {
      evaluationRunId: evaluationRun.id,
      evaluatedProfiles: evaluation.broadFilter.evaluations.length,
      profilesSentToModel: evaluation.modelEvaluation.requestedProfiles,
      failedModelProfiles: evaluation.modelEvaluation.failedProfiles,
    },
    'Completed profile review pipeline.',
  );

  return { profilePipeline, evaluationRun };
}
