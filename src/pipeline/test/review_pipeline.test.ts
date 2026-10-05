import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dbGetEvaluationRunById,
  dbInsertEvaluationRun,
  openDatabase,
} from '../../database/index.js';
import type { StoredEvaluationRun } from '../../database/index.js';
import type { FullEvaluationCriteria } from '../../evaluation/index.js';
import type { FullProfile } from '../../profile/index.js';
import {
  importedCsvDataFor,
  recordingLogger,
} from '../../test_support/pipeline_fakes.js';
import type { RecordingLogger } from '../../test_support/pipeline_fakes.js';
import { runReviewPipelineWithDependencies } from '../review_pipeline.js';
import type { ReviewPipelineDependencies } from '../types.js';

const PROFILE_WITH_PHOTO_ID = 'stable-profile-with-photo';
const PROFILE_WITHOUT_PHOTO_ID = 'stable-profile-without-photo';
const REVIEW_RUN_ID = 'review-run-id';
const REVIEW_RUN_TIME = '2026-08-27T12:00:00.000Z';
const REVIEW_MINIMUM_MANUAL_REVIEW_PERCENT = 50;
const REVIEW_MINIMUM_APPROVAL_PERCENT = 75;
const REVIEW_MODEL_MATCH_PERCENT = 85;

/** Two imported people: one whose export carries a photo, one without. */
const PEOPLE = [
  {
    profileUrl: 'https://linkedin.com/in/profile-with-photo',
    avatarUrl: 'https://example.invalid/profile-with-photo.jpg',
  },
  { profileUrl: 'https://linkedin.com/in/profile-without-photo' },
];

/** Reads object payloads recorded for one exact log message. */
function payloadsFor(
  logger: RecordingLogger,
  message: string,
): Array<Record<string, unknown>> {
  return logger.entries
    .filter((entry) => entry.message === message)
    .map((entry) => entry.payload as Record<string, unknown>);
}

/** Builds campaign criteria that exercise broad filtering and score decisions. */
function criteria(): FullEvaluationCriteria {
  return {
    requirePhoto: true,
    // Photos stay out of the request so no test downloads one.
    skipImageAnalysis: true,
    desiredMonthlyCompensation: {
      minimumMonthlyCompensation: 7_000,
      maximumMonthlyCompensation: 15_000,
    },
    decisionPolicy: {
      mode: 'automatic',
      minimumManualReviewPercent: REVIEW_MINIMUM_MANUAL_REVIEW_PERCENT,
      minimumApprovalPercent: REVIEW_MINIMUM_APPROVAL_PERCENT,
    },
    systemPrompt: 'Grade experienced commercial profiles for this campaign.',
  };
}

/** Assigns deterministic persisted IDs, as the profile upsert would. */
function insertStableProfile(profile: FullProfile): FullProfile {
  return {
    ...profile,
    id: profile.photo ? PROFILE_WITH_PHOTO_ID : PROFILE_WITHOUT_PHOTO_ID,
  };
}

/** Reads the profile ID out of a request so a stub can answer about it. */
function requestedProfileId(request: unknown): string {
  const parts = (request as { parts?: { text?: string }[] })?.parts ?? [];
  for (const part of parts) {
    const found = /--- PROFILE ([^\s]+) ---/.exec(part.text ?? '');
    if (found) return found[1]!;
  }
  return PROFILE_WITH_PHOTO_ID;
}

/**
 * Builds a valid structured response for whichever profile was sent.
 *
 * Answers per request rather than naming one fixed profile, because every
 * profile now reaches the model — a missing photo is ranked, not excluded.
 */
function successfulModelResponse(profileId: string = PROFILE_WITH_PHOTO_ID) {
  return {
    text: JSON.stringify({
      evaluations: [
        {
          profileId,
          matchPercent: REVIEW_MODEL_MATCH_PERCENT,
          estimatedTotalMonthlyCompensation: {
            status: 'estimated',
            currency: 'BRL',
            minimumMonthlyCompensation: 8_000,
            maximumMonthlyCompensation: 12_000,
            confidence: 'medium',
            basis: ['The test profile contains commercial experience.'],
          },
          positives: ['The profile matches the test campaign.'],
          negatives: [],
          summary: 'The profile matches the test campaign.',
        },
      ],
    }),
    usage: {
      promptTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
    },
  };
}

/** Builds review dependencies and captures the SQLite round trip before close. */
function reviewDependencies(
  capture: (run: StoredEvaluationRun) => void = () => undefined,
  overrides: Partial<ReviewPipelineDependencies> = {},
): ReviewPipelineDependencies {
  return {
    openDatabase: () => openDatabase(':memory:'),
    insertProfile: (profile) => insertStableProfile(profile),
    insertEvaluationRun: (run, db) => {
      dbInsertEvaluationRun(run, db);
      const stored = dbGetEvaluationRunById(run.id, db);
      assert.ok(stored);
      capture(stored);
      return run;
    },
    createRunId: () => REVIEW_RUN_ID,
    now: () => new Date(REVIEW_RUN_TIME),
    ...overrides,
  };
}

test('connects imported CSV profiles to broad filtering, the model, and SQLite', async () => {
  let storedRun: StoredEvaluationRun | undefined;
  let modelCalls = 0;
  const logger = recordingLogger();

  const result = await runReviewPipelineWithDependencies(
    importedCsvDataFor(PEOPLE),
    criteria(),
    logger,
    reviewDependencies((run) => {
      storedRun = run;
    }),
    {
      modelEvaluation: {
        generateContent: async (request: unknown) => {
          modelCalls += 1;
          return successfulModelResponse(requestedProfileId(request));
        },
      },
    },
  );

  assert.deepEqual(
    result.profiles.map((profile) => profile.id),
    [PROFILE_WITH_PHOTO_ID, PROFILE_WITHOUT_PHOTO_ID],
  );
  assert.deepEqual(
    result.profiles.map((profile) => profile.linkedHelperPublicId),
    ['imported-0', 'imported-1'],
  );
  assert.equal(result.profiles[0]?.experience[0]?.position, 'Account Executive');
  // Both profiles reach the model: a missing photo is ranked, not cut.
  assert.equal(modelCalls, 2);
  assert.equal(result.evaluationRun.id, REVIEW_RUN_ID);
  assert.equal(result.evaluationRun.createdAt, REVIEW_RUN_TIME);
  assert.deepEqual(
    result.evaluationRun.evaluation.broadFilter.evaluations.map(
      (evaluation) => evaluation.linkedHelperPublicId,
    ),
    ['imported-0', 'imported-1'],
  );
  assert.equal(
    result.evaluationRun.evaluation.modelEvaluation.evaluations[0]
      ?.compensationRangeMatch?.outcome,
    'matched',
  );
  assert.deepEqual(storedRun, result.evaluationRun);

  const broadLogs = payloadsFor(logger, 'Broad-filter profile decision.');
  assert.equal(broadLogs.length, 2);
  assert.equal(broadLogs[1]?.['profileId'], PROFILE_WITHOUT_PHOTO_ID);
  assert.equal(broadLogs[1]?.['linkedinUrl'], PEOPLE[1]?.profileUrl);
  assert.equal(broadLogs[1]?.['decision'], 'NextPhase');

  const modelLogs = payloadsFor(logger, 'Model profile decision.');
  assert.equal(modelLogs.length, 2);
  assert.equal(modelLogs[0]?.['profileId'], PROFILE_WITH_PHOTO_ID);
  assert.equal(modelLogs[0]?.['decision'], 'approved');
  assert.equal(modelLogs[0]?.['matchPercent'], REVIEW_MODEL_MATCH_PERCENT);
});

test('skips a row that cannot be saved and scores the rest', async () => {
  const logger = recordingLogger();

  const result = await runReviewPipelineWithDependencies(
    importedCsvDataFor(PEOPLE),
    criteria(),
    logger,
    reviewDependencies(undefined, {
      insertProfile: (profile) => {
        if (!profile.photo) throw new Error('Cannot save this profile.');
        return insertStableProfile(profile);
      },
    }),
    {
      modelEvaluation: {
        generateContent: async (request: unknown) =>
          successfulModelResponse(requestedProfileId(request)),
      },
    },
  );

  assert.deepEqual(result.profiles.map((profile) => profile.id), [PROFILE_WITH_PHOTO_ID]);
  assert.deepEqual(payloadsFor(logger, 'Could not import a CSV profile.'), [
    { publicId: 'imported-1', error: 'Cannot save this profile.' },
  ]);
});

test('persists isolated model failures as a completed review run', async () => {
  let storedRun: StoredEvaluationRun | undefined;
  const logger = recordingLogger();

  const result = await runReviewPipelineWithDependencies(
    importedCsvDataFor(PEOPLE),
    criteria(),
    logger,
    reviewDependencies((run) => {
      storedRun = run;
    }),
    {
      modelEvaluation: {
        generateContent: async () => ({ text: '{invalid-json' }),
      },
    },
  );

  // Both profiles reach the model, so an unparseable reply fails both,
  // reported as one failure per request group rather than one per profile.
  assert.equal(result.evaluationRun.evaluation.modelEvaluation.failedProfiles, 2);
  assert.equal(result.evaluationRun.evaluation.modelEvaluation.failures.length, 1);
  assert.deepEqual(storedRun, result.evaluationRun);

  const failureLogs = payloadsFor(logger, 'Model profile evaluation failed.');
  assert.equal(failureLogs.length, 2);
  assert.equal(failureLogs[0]?.['profileId'], PROFILE_WITH_PHOTO_ID);
  assert.match(String(failureLogs[0]?.['reason']), /valid JSON/);
  assert.equal(failureLogs[0]?.['responseText'], '{invalid-json');
});

test('refuses a CSV without career columns before saving or scoring anything', async () => {
  const imported = importedCsvDataFor(PEOPLE);
  for (const record of Object.values(imported.records)) {
    record.raw = { public_id: record.summary.publicId, profile_url: record.summary.profileUrl };
  }
  let databaseCalls = 0;

  await assert.rejects(
    () =>
      runReviewPipelineWithDependencies(
        imported,
        criteria(),
        recordingLogger(),
        reviewDependencies(undefined, {
          openDatabase: () => {
            databaseCalls += 1;
            return openDatabase(':memory:');
          },
        }),
      ),
    /no career columns/,
  );

  assert.equal(databaseCalls, 0);
});

test('closes SQLite when persisting the evaluation run fails', async () => {
  const db = openDatabase(':memory:');
  // The import closes its own connection first; the run is saved on the second.
  const connections = [openDatabase(':memory:'), db];

  await assert.rejects(
    () =>
      runReviewPipelineWithDependencies(
        importedCsvDataFor(PEOPLE),
        criteria(),
        recordingLogger(),
        reviewDependencies(undefined, {
          openDatabase: () => connections.shift() ?? db,
          insertEvaluationRun: () => {
            throw new Error('Could not save the evaluation run.');
          },
        }),
        {
          modelEvaluation: {
            generateContent: async (request: unknown) =>
              successfulModelResponse(requestedProfileId(request)),
          },
        },
      ),
    /Could not save the evaluation run/,
  );

  assert.equal(db.isOpen, false);
});
