import type { EvaluationRunResult } from '../evaluation/index.js';
import type { Logger } from '../logging/index.js';
import type { FullProfile } from '../profile/index.js';
import type { ProfileImageAnalysisOutcome } from './types.js';

/** Stable status labels used by per-profile image-analysis log entries. */
export const PROFILE_IMAGE_LOG_STATUS = {
  succeeded: 'succeeded',
  failed: 'failed',
  skippedMissingPhoto: 'skipped_missing_photo',
} as const;

const MISSING_PHOTO_REASON = 'No profile photo is available.';
const MISSING_IMAGE_RESULT_REASON =
  'Image analysis did not return a successful result.';

/** Builds a profile lookup for attaching persisted links to evaluation results. */
function profilesById(
  profiles: readonly FullProfile[],
): ReadonlyMap<string, FullProfile> {
  return new Map(profiles.map((profile) => [profile.id, profile]));
}

/** Associates image failures with profile links before database IDs may change. */
function imageFailuresByLink(
  outcome: ProfileImageAnalysisOutcome,
): ReadonlyMap<string, string> {
  const linksBySourceId = new Map(
    outcome.fullProfiles.map((profile) => [profile.id, profile.linkedinUrl]),
  );
  const failures = outcome.failures.flatMap((failure) => {
    const linkedinUrl = linksBySourceId.get(failure.profileId);
    return linkedinUrl ? [[linkedinUrl, failure.error] as const] : [];
  });

  return new Map(failures);
}

/** Resolves one profile's compact image-processing status and optional reason. */
function imageLogResult(
  profile: FullProfile,
  failureReason: string | undefined,
): { status: string; reason?: string } {
  if (!profile.photo) {
    return {
      status: PROFILE_IMAGE_LOG_STATUS.skippedMissingPhoto,
      reason: MISSING_PHOTO_REASON,
    };
  }
  if (failureReason) {
    return { status: PROFILE_IMAGE_LOG_STATUS.failed, reason: failureReason };
  }
  if (!profile.imageAnalysis) {
    return {
      status: PROFILE_IMAGE_LOG_STATUS.failed,
      reason: MISSING_IMAGE_RESULT_REASON,
    };
  }
  return { status: PROFILE_IMAGE_LOG_STATUS.succeeded };
}

/** Logs one compact image-analysis outcome for every persisted profile. */
export function logProfileImageOutcomes(
  logger: Logger,
  profiles: readonly FullProfile[],
  outcome: ProfileImageAnalysisOutcome,
): void {
  const failuresByLink = imageFailuresByLink(outcome);

  for (const profile of profiles) {
    const result = imageLogResult(
      profile,
      failuresByLink.get(profile.linkedinUrl),
    );
    const payload = {
      profileId: profile.id,
      linkedinUrl: profile.linkedinUrl,
      ...result,
    };

    if (result.status === PROFILE_IMAGE_LOG_STATUS.failed) {
      logger.warn(payload, 'Profile image analysis outcome.');
    } else {
      logger.info(payload, 'Profile image analysis outcome.');
    }
  }
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

/** Logs successful Gemini decisions without duplicating stored profile details. */
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
        reasons: result.reasons,
        evidence: result.evidence,
        uncertainties: result.uncertainties,
      },
      'Gemini profile decision.',
    );
  }
}

/** Logs one compact failure for every profile in an unsuccessful Gemini group. */
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
        'Gemini profile evaluation failed.',
      );
    }
  }
}

/** Logs every successful or failed Gemini outcome with stable profile references. */
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
