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
  apifyCollectionResult,
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
const REVIEW_MINIMUM_MANUAL_REVIEW_PERCENT = 50;
const REVIEW_MINIMUM_APPROVAL_PERCENT = 75;
const REVIEW_MODEL_MATCH_PERCENT = 85;

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
    // Photo analysis now defaults to skipped; these tests exercise the full
    // acquisition path (including the injected extractImages dependency), so
    // they opt back in explicitly.
    skipImageAnalysis: false,
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
    writeJson: recordingWriter().writeJson,
    openDatabase: () => openDatabase(':memory:'),
    insertProfile: (profile) => insertStableProfile(profile),
    now: steppingClock(),
    ...overrides,
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

test('connects stable full profiles to broad filtering, the model, and SQLite', async () => {
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
        generateContent: async (request: unknown) => {
          modelCalls += 1;
          return successfulModelResponse(requestedProfileId(request));
        },
      },
    },
  );

  assert.deepEqual(
    result.profilePipeline.profiles.map((profile) => profile.id),
    [PROFILE_WITH_PHOTO_ID, PROFILE_WITHOUT_PHOTO_ID],
  );
  assert.deepEqual(
    result.profilePipeline.profiles.map(
      (profile) => profile.linkedHelperPublicId,
    ),
    ['imported-0', 'imported-1'],
  );
  // Both profiles now reach the model: a missing photo is ranked, not cut.
  assert.equal(modelCalls, 2);
  assert.equal(result.evaluationRun.id, REVIEW_RUN_ID);
  assert.equal(result.evaluationRun.createdAt, REVIEW_RUN_TIME);
  assert.equal(result.evaluationRun.evaluation.broadFilter.evaluations.length, 2);
  assert.deepEqual(
    result.evaluationRun.evaluation.broadFilter.evaluations.map(
      (evaluation) => evaluation.linkedHelperPublicId,
    ),
    ['imported-0', 'imported-1'],
  );
  assert.deepEqual(
    result.evaluationRun.evaluation.broadFilter.profilesForAi.map(
      (profile) => profile.profileId,
    ),
    [PROFILE_WITH_PHOTO_ID, PROFILE_WITHOUT_PHOTO_ID],
  );
  assert.equal(
    result.evaluationRun.evaluation.modelEvaluation.evaluations[0]
      ?.compensationRangeMatch?.outcome,
    'matched',
  );
  assert.equal(
    result.evaluationRun.evaluation.modelEvaluation.evaluations[0]
      ?.linkedHelperPublicId,
    'imported-0',
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
        status: 'skipped_by_criteria',
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
  assert.equal(broadLogs[1]?.['decision'], 'NextPhase');

  const modelLogs = payloadsFor(logger, 'Model profile decision.');
  assert.equal(modelLogs.length, 2);
  assert.equal(modelLogs[0]?.['profileId'], PROFILE_WITH_PHOTO_ID);
  assert.equal(modelLogs[0]?.['linkedinUrl'], urls[0]);
  assert.equal(modelLogs[0]?.['decision'], 'approved');
  assert.equal(modelLogs[0]?.['matchPercent'], 85);
});

test('skips photo analysis by default when the criterion is omitted', async () => {
  const urls = ['https://linkedin.com/in/profile-with-photo'];
  const logger = recordingLogger();
  let extractCalls = 0;

  await runReviewPipelineWithDependencies(
    importedCsvDataFor(urls),
    {
      systemPrompt: 'Grade experienced commercial profiles for this campaign.',
      decisionPolicy: { mode: 'manual' },
      // skipImageAnalysis intentionally omitted: must default to skipped.
    },
    logger,
    reviewDependencies(
      profilePipelineDependencies({}),
      () => undefined,
    ),
    { modelEvaluation: { generateContent: async () => successfulModelResponse() } },
  );

  assert.equal(extractCalls, 0);

  const imageLogs = payloadsFor(logger, 'Profile image analysis outcome.');
  assert.equal(imageLogs[0]?.['status'], 'skipped_by_criteria');
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
        generateContent: async () => ({ text: '{invalid-json' }),
      },
    },
  );

  // Both profiles reach the model now, so an unparseable reply fails both —
  // reported as one failure per request group rather than one per profile.
  assert.equal(result.evaluationRun.evaluation.modelEvaluation.failedProfiles, 2);
  assert.equal(result.evaluationRun.evaluation.modelEvaluation.failures.length, 1);
  assert.deepEqual(storedRun, result.evaluationRun);

  const failureLogs = payloadsFor(
    logger,
    'Model profile evaluation failed.',
  );
  assert.equal(failureLogs.length, 2);
  assert.equal(failureLogs[0]?.['profileId'], PROFILE_WITH_PHOTO_ID);
  assert.equal(
    failureLogs[0]?.['linkedinUrl'],
    'https://linkedin.com/in/profile-with-photo',
  );
  assert.match(String(failureLogs[0]?.['reason']), /valid JSON/);
  assert.equal(failureLogs[0]?.['responseText'], '{invalid-json');
});

test('scores cached profiles without calling the collection provider', async () => {
  const urls = [
    'https://linkedin.com/in/profile-with-photo',
    'https://linkedin.com/in/profile-without-photo',
  ];
  let collectionCalls = 0;
  let modelCalls = 0;
  let readCacheCalls = 0;
  let storedRun: StoredEvaluationRun | undefined;

  const result = await runReviewPipelineWithDependencies(
    importedCsvDataFor(urls),
    criteria(),
    recordingLogger(),
    {
      ...reviewDependencies(
        profilePipelineDependencies({
          collectProfiles: async () => {
            collectionCalls += 1;
            throw new Error('Collection must not run when skipCollection is set.');
          },
        }),
        (run) => {
          storedRun = run;
        },
      ),
      readCachedProfiles: async () => {
        readCacheCalls += 1;
        throw new Error('In-memory cached profiles should skip the file read.');
      },
    },
    {
      skipCollection: true,
      cachedProfiles: [
        {
          id: 'cached-with-photo',
          linkedinUrl: urls[0]!,
          firstName: 'Photo',
          photo: 'https://example.invalid/profile-with-photo.jpg',
          experience: [],
          education: [],
          raw: {},
        },
        {
          id: 'cached-without-photo',
          linkedinUrl: urls[1]!,
          firstName: 'No Photo',
          experience: [],
          education: [],
          raw: {},
        },
      ],
      modelEvaluation: {
        generateContent: async (request: unknown) => {
          modelCalls += 1;
          return successfulModelResponse(requestedProfileId(request));
        },
      },
    },
  );

  assert.equal(collectionCalls, 0);
  assert.equal(readCacheCalls, 0);
  assert.equal(modelCalls, 2);
  assert.equal(result.profilePipeline.summary.providerCollection.actorRuns, 0);
  assert.equal(result.evaluationRun.evaluation.broadFilter.evaluations.length, 2);
  assert.deepEqual(storedRun, result.evaluationRun);
});

test('fails a cached review when the artifact does not cover the import', async () => {
  let collectionCalls = 0;

  await assert.rejects(
    () =>
      runReviewPipelineWithDependencies(
        importedCsvDataFor(['https://linkedin.com/in/profile-with-photo']),
        criteria(),
        recordingLogger(),
        reviewDependencies(
          profilePipelineDependencies({
            collectProfiles: async () => {
              collectionCalls += 1;
              throw new Error('Collection must not run when skipCollection is set.');
            },
          }),
          () => undefined,
        ),
        {
          skipCollection: true,
          cachedProfiles: [
            {
              id: 'other-cached-profile',
              linkedinUrl: 'https://linkedin.com/in/someone-else',
              experience: [],
              education: [],
              raw: {},
            },
          ],
        },
      ),
    /cover 0 of 1 imported LinkedIn URLs/,
  );

  assert.equal(collectionCalls, 0);
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
