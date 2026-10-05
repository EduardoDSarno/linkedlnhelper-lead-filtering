import type { EvaluationRunResult } from '../evaluation/index.js';
import type { Logger } from '../logging/index.js';
import type { FullProfile } from '../profile/index.js';

/** Builds a profile lookup for attaching persisted links to evaluation results. */
function profilesById(
  profiles: readonly FullProfile[],
): ReadonlyMap<string, FullProfile> {
  return new Map(profiles.map((profile) => [profile.id, profile]));
}

/** Keeps only broad-filter evidence that directly caused an exclusion. */
function exclusionEvidence(
  evaluation: EvaluationRunResult['broadFilter']['evaluations'][number],
) {
  return evaluation.results
    .filter((result) => result.excludes)
    .map(({ criterion, evidence }) => ({ criterion, evidence }));
}

/** Logs every deterministic filter decision with its profile identity and reason. */
export function logBroadFilterDecisions(
  logger: Logger,
  profiles: readonly FullProfile[],
  evaluationRunId: string,
  evaluation: EvaluationRunResult,
): void {
  const profileLookup = profilesById(profiles);

  for (const result of evaluation.broadFilter.evaluations) {
    logger.info(
      {
        evaluationRunId,
        profileId: result.profileId,
        linkedinUrl: profileLookup.get(result.profileId)?.linkedinUrl,
        decision: result.decision,
        reason: result.decisionMessage,
        exclusionEvidence: exclusionEvidence(result),
      },
      'Broad-filter profile decision.',
    );
  }
}

/** Logs successful the model decisions without duplicating stored profile details. */
function logSuccessfulModelDecisions(
  logger: Logger,
  profileLookup: ReadonlyMap<string, FullProfile>,
  evaluationRunId: string,
  evaluation: EvaluationRunResult,
): void {
  for (const result of evaluation.modelEvaluation.evaluations) {
    logger.info(
      {
        evaluationRunId,
        profileId: result.profileId,
        linkedinUrl: profileLookup.get(result.profileId)?.linkedinUrl,
        decision: result.decision,
        matchPercent: result.matchPercent,
        positives: result.positives,
        negatives: result.negatives,
        summary: result.summary,
      },
      'Model profile decision.',
    );
  }
}

/** Logs one compact failure for every profile in an unsuccessful the model group. */
function logFailedModelDecisions(
  logger: Logger,
  profileLookup: ReadonlyMap<string, FullProfile>,
  evaluationRunId: string,
  evaluation: EvaluationRunResult,
): void {
  for (const failure of evaluation.modelEvaluation.failures) {
    for (const profileId of failure.profileIds) {
      logger.warn(
        {
          evaluationRunId,
          profileId,
          linkedinUrl: profileLookup.get(profileId)?.linkedinUrl,
          reason: failure.error,
          attempts: failure.attempts,
          ...(failure.responseText
            ? { responseText: failure.responseText }
            : {}),
        },
        'Model profile evaluation failed.',
      );
    }
  }
}

/** Logs every successful or failed the model outcome with stable profile references. */
export function logModelDecisions(
  logger: Logger,
  profiles: readonly FullProfile[],
  evaluationRunId: string,
  evaluation: EvaluationRunResult,
): void {
  const profileLookup = profilesById(profiles);
  logSuccessfulModelDecisions(
    logger,
    profileLookup,
    evaluationRunId,
    evaluation,
  );
  logFailedModelDecisions(logger, profileLookup, evaluationRunId, evaluation);
}
