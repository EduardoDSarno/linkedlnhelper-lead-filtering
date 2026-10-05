import type { ImportedCsvData } from '../dataCollector/csv/csvdata.js';
import type { FullEvaluationCriteria } from '../evaluation/criterias/index.js';
import {
  createEvaluationBatchContext,
  evaluateProfiles,
} from '../evaluation/index.js';
import type { Logger } from '../logging/index.js';
import { DEFAULT_REVIEW_PIPELINE_DEPENDENCIES } from './config.js';
import { importCsvProfiles } from './csv_profiles.js';
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
 * Connects the CSV import and evaluation while keeping the paid model call
 * and the database replaceable in deterministic tests.
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

  const { profiles } = importCsvProfiles(importedData, logger, dependencies);
  const context = createEvaluationBatchContext(profiles, criteria);
  const evaluation = await evaluateProfiles(
    context,
    { ...options.modelEvaluation, logger },
    // The campaign's skipImageAnalysis choice now decides whether photos are
    // attached to the evaluation request, since there is no separate image stage.
    { logger, ...(criteria.skipImageAnalysis ? { skipPhotos: true } : {}) },
  );
  const evaluationRun = {
    id: dependencies.createRunId(),
    createdAt: dependencies.now().toISOString(),
    criteria,
    evaluation,
  };
  logBroadFilterDecisions(
    logger,
    profiles,
    evaluationRun.id,
    evaluation,
  );
  logModelDecisions(
    logger,
    profiles,
    evaluationRun.id,
    evaluation,
  );
  const db = dependencies.openDatabase();

  try {
    dependencies.insertEvaluationRun(evaluationRun, db);
  } finally {
    db.close();
  }

  const usage = evaluation.modelEvaluation.tokenUsage;

  logger.info(
    {
      evaluationRunId: evaluationRun.id,
      evaluatedProfiles: evaluation.broadFilter.evaluations.length,
      profilesSentToModel: evaluation.modelEvaluation.requestedProfiles,
      failedModelProfiles: evaluation.modelEvaluation.failedProfiles,
      promptTokens: usage.promptTokens,
      outputTokens: usage.outputTokens,
      // Every request repeats the same instruction layer and campaign prompt.
      // A backend that recognizes that prefix bills it at a fraction of the
      // usual rate, but routing spreads requests across backends that differ
      // in whether they cache at all. Reported so the share is measured rather
      // than assumed; a flat zero means no backend served this run from cache.
      cachedPromptTokens: usage.cachedPromptTokens,
      cachedPromptPercent:
        usage.promptTokens > 0
          ? Math.round((100 * usage.cachedPromptTokens) / usage.promptTokens)
          : 0,
    },
    'Completed profile review pipeline.',
  );

  return { profiles, evaluationRun };
}
