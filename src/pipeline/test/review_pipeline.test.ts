import assert from 'node:assert/strict';
import test from 'node:test';

import type { GenerateContentResponse } from '@google/genai';

import {
  dbGetEvaluationRunById,
  dbInsertEvaluationRun,
  openDatabase,
} from '../../database/index.js';
import type { StoredEvaluationRun } from '../../database/index.js';
import type { FullEvaluationCriteria } from '../../evaluation/index.js';
import type { FullProfile } from '../../profile/index.js';
import {
  apifyCollectionResult,
  imageExtractionResult,
  importedCsvDataFor,
  recordingLogger,
  recordingWriter,
  steppingClock,
} from '../../test_support/pipeline_fakes.js';
import type { RecordingLogger } from '../../test_support/pipeline_fakes.js';
import { runReviewPipelineWithDependencies } from '../review_pipeline.js';
import type {
  FullProfilePipelineDependencies,
  ReviewPipelineDependencies,
} from '../types.js';

const PROFILE_WITH_PHOTO_ID = 'stable-profile-with-photo';
const PROFILE_WITHOUT_PHOTO_ID = 'stable-profile-without-photo';
const REVIEW_RUN_ID = 'review-run-id';
const REVIEW_RUN_TIME = '2026-08-27T12:00:00.000Z';

/** Reads object payloads recorded for one exact log message. */
function payloadsFor(
  logger: RecordingLogger,
  message: string,
): Array<Record<string, unknown>> {
  return logger.entries
    .filter((entry) => entry.message === message)
    .map((entry) => entry.payload as Record<string, unknown>);
}

/** Builds campaign criteria that exercise broad filtering and model approval. */
function criteria(): FullEvaluationCriteria {
  return {
    requirePhoto: true,
    desiredMonthlyCompensation: {
      minimumMonthlyCompensation: 7_000,
      maximumMonthlyCompensation: 15_000,
    },
    modelApproval: {
      enabled: true,
      minimumMatchPercent: 75,
    },
    systemPrompt: 'Approve experienced commercial profiles for this campaign.',
  };
}

/** Assigns deterministic persisted IDs after the profile database upsert stage. */
function insertStableProfile(profile: FullProfile): FullProfile {
  return {
    ...profile,
    id: profile.photo ? PROFILE_WITH_PHOTO_ID : PROFILE_WITHOUT_PHOTO_ID,
  };
}

/** Builds the isolated acquisition boundaries used by review tests. */
function profilePipelineDependencies(
  overrides: Partial<FullProfilePipelineDependencies> = {},
): FullProfilePipelineDependencies {
  return {
    collectProfiles: async () =>
      apifyCollectionResult([
        {
          linkedinUrl: 'https://linkedin.com/in/profile-with-photo',
          firstName: 'Photo',
          photo: 'https://example.invalid/profile-with-photo.jpg',
        },
        {
          linkedinUrl: 'https://linkedin.com/in/profile-without-photo',
          firstName: 'No Photo',
          photo: '',
        },
      ]),
    extractImages: async (jobs) =>
      jobs.map((job) => ({
        id: job.id,
        status: 'fulfilled' as const,
        result: imageExtractionResult(),
      })),
    writeJson: recordingWriter().writeJson,
    openDatabase: () => openDatabase(':memory:'),
    insertProfile: (profile) => insertStableProfile(profile),
    now: steppingClock(),
    ...overrides,
  };
}

/** Builds a valid structured model response for the profile that reaches AI. */
function successfulModelResponse(): GenerateContentResponse {
  return {
    text: JSON.stringify({
      evaluations: [
        {
          profileId: PROFILE_WITH_PHOTO_ID,
          matchPercent: 85,
          decision: 'approved',
          estimatedTotalMonthlyCompensation: {
            status: 'estimated',
            currency: 'BRL',
            minimumMonthlyCompensation: 8_000,
            maximumMonthlyCompensation: 12_000,
            confidence: 'medium',
            basis: ['The test profile contains commercial experience.'],
          },
          reasons: ['The profile matches the test campaign.'],
          evidence: ['The supplied fixture has relevant experience.'],
          uncertainties: [],
        },
      ],
    }),
    usageMetadata: {
      promptTokenCount: 100,
      candidatesTokenCount: 40,
      totalTokenCount: 140,
    },
  } as GenerateContentResponse;
}

/** Builds review dependencies and captures the SQLite round trip before close. */
function reviewDependencies(
  profilePipeline: FullProfilePipelineDependencies,
  capture: (run: StoredEvaluationRun) => void,
): ReviewPipelineDependencies {
  return {
    profilePipeline,
    openDatabase: () => openDatabase(':memory:'),
    insertEvaluationRun: (run, db) => {
      dbInsertEvaluationRun(run, db);
      const stored = dbGetEvaluationRunById(run.id, db);
      assert.ok(stored);
      capture(stored);
      return run;
    },
    createRunId: () => REVIEW_RUN_ID,
    now: () => new Date(REVIEW_RUN_TIME),
  };
}

test('connects stable full profiles to broad filtering, Gemini, and SQLite', async () => {
  const urls = [
    'https://linkedin.com/in/profile-with-photo',
    'https://linkedin.com/in/profile-without-photo',
  ];
  let storedRun: StoredEvaluationRun | undefined;
  let modelCalls = 0;
  const logger = recordingLogger();

  const result = await runReviewPipelineWithDependencies(
    importedCsvDataFor(urls),
    criteria(),
    logger,
    reviewDependencies(profilePipelineDependencies(), (run) => {
      storedRun = run;
    }),
    {
      modelEvaluation: {
        generateContent: async () => {
          modelCalls += 1;
          return successfulModelResponse();
        },
      },
    },
  );

  assert.deepEqual(
    result.profilePipeline.profiles.map((profile) => profile.id),
    [PROFILE_WITH_PHOTO_ID, PROFILE_WITHOUT_PHOTO_ID],
  );
  assert.equal(modelCalls, 1);
  assert.equal(result.evaluationRun.id, REVIEW_RUN_ID);
  assert.equal(result.evaluationRun.createdAt, REVIEW_RUN_TIME);
  assert.equal(result.evaluationRun.evaluation.broadFilter.evaluations.length, 2);
  assert.deepEqual(
    result.evaluationRun.evaluation.broadFilter.profilesForAi.map(
      (profile) => profile.profileId,
    ),
    [PROFILE_WITH_PHOTO_ID],
  );
  assert.equal(
    result.evaluationRun.evaluation.modelEvaluation.evaluations[0]
      ?.compensationRangeMatch?.outcome,
    'matched',
  );
  assert.deepEqual(storedRun, result.evaluationRun);

  const imageLogs = payloadsFor(logger, 'Profile image analysis outcome.');
  assert.equal(imageLogs.length, 2);
  assert.deepEqual(
    imageLogs.map(({ profileId, linkedinUrl, status }) => ({
      profileId,
      linkedinUrl,
      status,
    })),
    [
      {
        profileId: PROFILE_WITH_PHOTO_ID,
        linkedinUrl: urls[0],
        status: 'succeeded',
      },
      {
        profileId: PROFILE_WITHOUT_PHOTO_ID,
        linkedinUrl: urls[1],
        status: 'skipped_missing_photo',
      },
    ],
  );

  const broadLogs = payloadsFor(logger, 'Broad-filter profile decision.');
  assert.equal(broadLogs.length, 2);
  assert.equal(broadLogs[1]?.['profileId'], PROFILE_WITHOUT_PHOTO_ID);
  assert.equal(broadLogs[1]?.['linkedinUrl'], urls[1]);
  assert.equal(broadLogs[1]?.['decision'], 'Failed');
  assert.match(String(broadLogs[1]?.['reason']), /No profile photo/);

  const modelLogs = payloadsFor(logger, 'Gemini profile decision.');
  assert.equal(modelLogs.length, 1);
  assert.equal(modelLogs[0]?.['profileId'], PROFILE_WITH_PHOTO_ID);
  assert.equal(modelLogs[0]?.['linkedinUrl'], urls[0]);
  assert.equal(modelLogs[0]?.['decision'], 'approved');
  assert.equal(modelLogs[0]?.['matchPercent'], 85);
});

test('persists isolated model failures as a completed review run', async () => {
  let storedRun: StoredEvaluationRun | undefined;
  const logger = recordingLogger();

  const result = await runReviewPipelineWithDependencies(
    importedCsvDataFor([
      'https://linkedin.com/in/profile-with-photo',
      'https://linkedin.com/in/profile-without-photo',
    ]),
    criteria(),
    logger,
    reviewDependencies(profilePipelineDependencies(), (run) => {
      storedRun = run;
    }),
    {
      modelEvaluation: {
        generateContent: async () =>
          ({ text: '{invalid-json' }) as GenerateContentResponse,
      },
    },
  );

  assert.equal(result.evaluationRun.evaluation.modelEvaluation.failedProfiles, 1);
  assert.equal(result.evaluationRun.evaluation.modelEvaluation.failures.length, 1);
  assert.deepEqual(storedRun, result.evaluationRun);

  const failureLogs = payloadsFor(
    logger,
    'Gemini profile evaluation failed.',
  );
  assert.equal(failureLogs.length, 1);
  assert.equal(failureLogs[0]?.['profileId'], PROFILE_WITH_PHOTO_ID);
  assert.equal(
    failureLogs[0]?.['linkedinUrl'],
    'https://linkedin.com/in/profile-with-photo',
  );
  assert.match(String(failureLogs[0]?.['reason']), /valid JSON/);
});

test('does not create an evaluation run when profile acquisition fails', async () => {
  let databaseCalls = 0;

  await assert.rejects(
    () =>
      runReviewPipelineWithDependencies(
        importedCsvDataFor(['https://linkedin.com/in/profile-with-photo']),
        criteria(),
        recordingLogger(),
        {
          ...reviewDependencies(
            profilePipelineDependencies({
              collectProfiles: async () => {
                throw new Error('The provider is unavailable.');
              },
            }),
            () => undefined,
          ),
          openDatabase: () => {
            databaseCalls += 1;
            return openDatabase(':memory:');
          },
        },
      ),
    /provider is unavailable/,
  );

  assert.equal(databaseCalls, 0);
});

test('closes SQLite when persisting the evaluation run fails', async () => {
  const db = openDatabase(':memory:');

  await assert.rejects(
    () =>
      runReviewPipelineWithDependencies(
        importedCsvDataFor([
          'https://linkedin.com/in/profile-with-photo',
          'https://linkedin.com/in/profile-without-photo',
        ]),
        criteria(),
        recordingLogger(),
        {
          profilePipeline: profilePipelineDependencies(),
          openDatabase: () => db,
          insertEvaluationRun: () => {
            throw new Error('Could not save the evaluation run.');
          },
          createRunId: () => REVIEW_RUN_ID,
          now: () => new Date(REVIEW_RUN_TIME),
        },
        {
          modelEvaluation: {
            generateContent: async () => successfulModelResponse(),
          },
        },
      ),
    /Could not save the evaluation run/,
  );

  assert.equal(db.isOpen, false);
});
