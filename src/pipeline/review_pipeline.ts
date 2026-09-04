import type { ImportedCsvData } from '../dataCollector/csv/csvdata.js';
import type { FullEvaluationCriteria } from '../evaluation/criterias/index.js';
import {
  createEvaluationBatchContext,
  evaluateProfiles,
} from '../evaluation/index.js';
import type { Logger } from '../logging/index.js';
import type { FullProfile } from '../profile/index.js';
import {
  buildCachedProfilePipelineResult,
  readCachedProfilesFile,
  resolveCachedProfilesForImport,
} from './cached_profiles.js';
import { DEFAULT_REVIEW_PIPELINE_DEPENDENCIES } from './config.js';
import { runFullProfilePipelineWithDependencies } from './full_profile_pipeline.js';
import {
  logBroadFilterDecisions,
  logModelDecisions,
} from './profile_decision_logging.js';
import type {
  FullProfilePipelineResult,
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
    {
      importedProfiles: importedData.total_profiles,
      skipCollection: options.skipCollection === true,
    },
    'Starting profile review pipeline.',
  );

  const profilePipeline = await acquireProfilesForReview(
    importedData,
    logger,
    dependencies,
    options,
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

/**
 * Returns full profiles from a fresh collection or from the cached artifact.
 *
 * Collection stays the default path. The cached path exists so an operator can
 * re-score already-enriched people without paying Apify or the image model.
 */
async function acquireProfilesForReview(
  importedData: ImportedCsvData,
  logger: Logger,
  dependencies: ReviewPipelineDependencies,
  options: ReviewPipelineOptions,
): Promise<FullProfilePipelineResult> {
  if (options.skipCollection !== true) {
    return runFullProfilePipelineWithDependencies(
      importedData,
      logger,
      dependencies.profilePipeline,
      options.profilePipeline,
    );
  }

  const cachedProfiles = await resolveCachedProfilesForImport(importedData, {
    ...(options.cachedProfiles ? { cachedProfiles: options.cachedProfiles } : {}),
    ...(options.cachedProfilesPath
      ? { cachedProfilesPath: options.cachedProfilesPath }
      : {}),
    readCachedProfiles:
      dependencies.readCachedProfiles ?? readCachedProfilesFile,
  });
  const profiles = persistCachedProfiles(
    cachedProfiles,
    dependencies.profilePipeline,
  );

  logger.info(
    {
      cachedProfiles: profiles.length,
      successfulImageAnalyses: profiles.filter(
        (profile) => profile.imageAnalysis !== undefined,
      ).length,
    },
    'Loaded cached full profiles for review.',
  );

  return buildCachedProfilePipelineResult(profiles, dependencies.now());
}

/**
 * Upserts cached profiles so the review list can load them by LinkedIn identity.
 *
 * A new processing run still needs rows in the profile table even when Apify
 * was skipped; the insert restores the stable database id on each profile.
 */
function persistCachedProfiles(
  profiles: readonly FullProfile[],
  profilePipeline: ReviewPipelineDependencies['profilePipeline'],
): FullProfile[] {
  const db = profilePipeline.openDatabase();

  try {
    return profiles.map((profile) =>
      profilePipeline.insertProfile(profile, db),
    );
  } finally {
    db.close();
  }
}
