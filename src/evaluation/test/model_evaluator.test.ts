import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';

import { asRecord, asString } from '../../helpers/index.js';
import {
  EVALUATION_PASS,
  PIPELINE_PROGRESS_MESSAGE,
} from '../../logging/index.js';
import type { ModelRequest, ModelResponse } from '../../models/index.js';
import { recordingLogger } from '../../test_support/pipeline_fakes.js';
import type { FullEvaluationCriteria } from '../criterias/index.js';
import type { EvaluationProfileData } from '../context.js';
import {
  COMPENSATION_RANGE_OUTCOME,
  MODEL_EVALUATION_DECISION,
  MODEL_EVALUATION_DEFAULTS,
  evaluateProfilesWithModel,
  parseModelEvaluationResponse,
} from '../model/index.js';

const TEST_MANUAL_REVIEW_PERCENT = 50;
const TEST_APPROVAL_PERCENT = 75;
const TEST_MATCH_PERCENT = 85;
const TEST_MONTHLY_COMPENSATION_MINIMUM = 8_000;
const TEST_MONTHLY_COMPENSATION_MAXIMUM = 12_000;
const TEST_DESIRED_COMPENSATION_MINIMUM = 7_000;
const TEST_DESIRED_COMPENSATION_MAXIMUM = 15_000;
const TEST_TOKEN_USAGE = {
  promptTokens: 100,
  outputTokens: 40,
  thinkingTokens: 20,
  totalTokens: 160,
} as const;
const PROFILE_JSON_MARKER = '=== PROFILES TO EVALUATE ===\n';
const PROFILE_JSON_END_MARKER = '\n\nReturn only';

/** Builds criteria that deterministically approve strong model scores. */
function criteria(): FullEvaluationCriteria {
  return {
    desiredMonthlyCompensation: {
      minimumMonthlyCompensation: TEST_DESIRED_COMPENSATION_MINIMUM,
      maximumMonthlyCompensation: TEST_DESIRED_COMPENSATION_MAXIMUM,
    },
    decisionPolicy: {
      mode: 'automatic',
      minimumManualReviewPercent: TEST_MANUAL_REVIEW_PERCENT,
      minimumApprovalPercent: TEST_APPROVAL_PERCENT,
    },
    systemPrompt: 'Evaluate professional fit for the campaign.',
    userPrompt: 'Prefer clear commercial experience.',
  };
}

/** Builds the minimum compact profile needed by the model evaluator. */
function profile(profileId: string): EvaluationProfileData {
  return {
    profileId,
    hasPhoto: true,
    experience: [],
    education: [],
  };
}

/** Builds a predictable sequence of compact profiles. */
function profiles(count: number): EvaluationProfileData[] {
  return Array.from({ length: count }, (_value, index) =>
    profile(`profile-${String(index)}`),
  );
}

/** Builds one structurally valid evaluation for a requested profile ID. */
function evaluation(profileId: string, matchPercent = TEST_MATCH_PERCENT) {
  return {
    profileId,
    matchPercent,
    estimatedTotalMonthlyCompensation: {
      status: 'estimated',
      currency: 'BRL',
      minimumMonthlyCompensation: TEST_MONTHLY_COMPENSATION_MINIMUM,
      maximumMonthlyCompensation: TEST_MONTHLY_COMPENSATION_MAXIMUM,
      confidence: 'medium',
      basis: ['The supplied fixture contains professional evidence.'],
    },
    reasons: ['The profile matches the campaign fixture.'],
    evidence: ['The supplied fixture contains professional evidence.'],
    uncertainties: [],
  };
}

/** Wraps response JSON in the provider-neutral shape consumed by the evaluator. */
function modelResponse(
  profileIds: readonly string[],
  usage = TEST_TOKEN_USAGE,
): ModelResponse {
  return {
    text: JSON.stringify({
      evaluations: profileIds.map((profileId) => evaluation(profileId)),
    }),
    usage: { ...usage },
  };
}

/** Extracts the requested profile IDs from the generated evaluation user content. */
function requestedProfileIds(request: ModelRequest): string[] {
  const text = request.parts[0] && 'text' in request.parts[0]
    ? request.parts[0].text
    : undefined;
  assert.ok(text, 'The model request must include text content.');

  const jsonStart = text.indexOf(PROFILE_JSON_MARKER);
  const jsonEnd = text.indexOf(
    PROFILE_JSON_END_MARKER,
    jsonStart + PROFILE_JSON_MARKER.length,
  );
  assert.notEqual(jsonStart, -1, 'The profile JSON marker must be present.');
  assert.notEqual(jsonEnd, -1, 'The profile JSON end marker must be present.');

  const parsed: unknown = JSON.parse(
    text.slice(jsonStart + PROFILE_JSON_MARKER.length, jsonEnd),
  );
  assert.ok(Array.isArray(parsed));

  return parsed.map((value) => {
    const profileId = asString(asRecord(value)?.['profileId']);
    assert.ok(profileId, 'Each requested profile must carry its ID.');
    return profileId;
  });
}

/** Builds an error carrying the HTTP status used by retry classification. */
function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${String(status)}`), { status });
}

/** Resolves on a later event-loop turn so concurrent workers overlap in tests. */
async function yieldEventLoop(): Promise<void> {
  await setImmediate();
}

test('groups profiles by the configured request size and keeps the final partial group', async () => {
  const profilesPerRequest = MODEL_EVALUATION_DEFAULTS.profilesPerRequest;
  const candidates = profiles(profilesPerRequest * 2 + 2);
  const requestedGroups: string[][] = [];

  const result = await evaluateProfilesWithModel(candidates, criteria(), {
    profilesPerRequest,
    concurrency: 1,
    generateContent: async (parameters) => {
      const profileIds = requestedProfileIds(parameters);
      requestedGroups.push(profileIds);
      return modelResponse(profileIds);
    },
  });

  assert.deepEqual(
    requestedGroups.map((group) => group.length),
    [profilesPerRequest, profilesPerRequest, 2],
  );
  assert.equal(result.successfulProfiles, candidates.length);
  assert.deepEqual(
    result.evaluations.map((item) => item.profileId),
    candidates.map((item) => item.profileId),
  );
  assert.ok(
    result.evaluations.every(
      (item) => item.decision === MODEL_EVALUATION_DECISION.approved,
    ),
  );
  assert.ok(
    result.evaluations.every(
      (item) =>
        item.compensationRangeMatch?.outcome ===
          COMPENSATION_RANGE_OUTCOME.matched &&
        item.compensationRangeMatch.overlapRatio === 1,
    ),
  );
});

test('retains model scores while routing every result to manual review', async () => {
  const candidate = profile('manual-profile');
  const manualMatchPercent = TEST_MANUAL_REVIEW_PERCENT - 1;
  const manualCriteria: FullEvaluationCriteria = {
    systemPrompt: 'Grade professional fit for the campaign.',
    decisionPolicy: { mode: 'manual' },
  };

  const result = await evaluateProfilesWithModel([candidate], manualCriteria, {
    generateContent: async () => ({
      text: JSON.stringify({
        evaluations: [evaluation(candidate.profileId, manualMatchPercent)],
      }),
    }),
  });

  assert.equal(result.evaluations[0]?.matchPercent, manualMatchPercent);
  assert.equal(
    result.evaluations[0]?.decision,
    MODEL_EVALUATION_DECISION.manualReview,
  );
});

test('never exceeds the configured concurrent model-request limit', async () => {
  const concurrency = MODEL_EVALUATION_DEFAULTS.concurrency;
  const profilesPerRequest = MODEL_EVALUATION_DEFAULTS.profilesPerRequest;
  const candidates = profiles((concurrency + 1) * profilesPerRequest);
  let activeRequests = 0;
  let peakRequests = 0;

  const result = await evaluateProfilesWithModel(candidates, criteria(), {
    profilesPerRequest,
    concurrency,
    generateContent: async (parameters) => {
      activeRequests += 1;
      peakRequests = Math.max(peakRequests, activeRequests);
      await yieldEventLoop();
      activeRequests -= 1;
      return modelResponse(requestedProfileIds(parameters));
    },
  });

  assert.equal(peakRequests, concurrency);
  assert.equal(result.successfulProfiles, candidates.length);
});

test('retries only the transiently failed group and preserves other successes', async () => {
  const profilesPerRequest = MODEL_EVALUATION_DEFAULTS.profilesPerRequest;
  const candidates = profiles(profilesPerRequest * 2);
  const callsByFirstProfile = new Map<string, number>();
  const retriedGroupId = candidates[0]?.profileId;
  assert.ok(retriedGroupId);

  const result = await evaluateProfilesWithModel(candidates, criteria(), {
    profilesPerRequest,
    concurrency: MODEL_EVALUATION_DEFAULTS.concurrency,
    maximumAttempts: 2,
    retryBaseDelayMs: 0,
    wait: async () => undefined,
    generateContent: async (parameters) => {
      const profileIds = requestedProfileIds(parameters);
      const firstProfileId = profileIds[0];
      assert.ok(firstProfileId);
      const calls = (callsByFirstProfile.get(firstProfileId) ?? 0) + 1;
      callsByFirstProfile.set(firstProfileId, calls);

      if (firstProfileId === retriedGroupId && calls === 1) {
        throw httpError(429);
      }

      return modelResponse(profileIds);
    },
  });

  assert.equal(callsByFirstProfile.get(retriedGroupId), 2);
  assert.equal(callsByFirstProfile.size, 2);
  assert.equal(
    [...callsByFirstProfile.values()].reduce((total, calls) => total + calls, 0),
    3,
  );
  assert.equal(result.successfulProfiles, candidates.length);
  assert.equal(result.failedProfiles, 0);
});

test('retries an invalid response exactly once and retains successful groups', async () => {
  const profilesPerRequest = MODEL_EVALUATION_DEFAULTS.profilesPerRequest;
  const candidates = profiles(profilesPerRequest * 2);
  const invalidGroupId = candidates[0]?.profileId;
  assert.ok(invalidGroupId);
  const callsByFirstProfile = new Map<string, number>();

  const result = await evaluateProfilesWithModel(candidates, criteria(), {
    profilesPerRequest,
    concurrency: MODEL_EVALUATION_DEFAULTS.concurrency,
    maximumAttempts: MODEL_EVALUATION_DEFAULTS.maximumAttempts,
    retryBaseDelayMs: 0,
    wait: async () => undefined,
    generateContent: async (parameters) => {
      const profileIds = requestedProfileIds(parameters);
      const firstProfileId = profileIds[0];
      assert.ok(firstProfileId);
      callsByFirstProfile.set(
        firstProfileId,
        (callsByFirstProfile.get(firstProfileId) ?? 0) + 1,
      );

      if (firstProfileId === invalidGroupId) {
        return {
          text: '{invalid-json',
          usage: { ...TEST_TOKEN_USAGE },
        };
      }

      return modelResponse(profileIds);
    },
  });

  // evaluateProfileGroup's own loop does not retry a non-retryable parse
  // error, but evaluateProfilesWithModel pools the whole failed group and
  // asks again exactly once, in its own request of the same size.
  assert.equal(callsByFirstProfile.get(invalidGroupId), 2);
  assert.equal(result.successfulProfiles, profilesPerRequest);
  assert.equal(result.failedProfiles, profilesPerRequest);
  assert.equal(result.failures[0]?.retryable, false);
  assert.match(result.failures[0]?.error ?? '', /invalid JSON/);
  assert.equal(result.failures[0]?.responseText, '{invalid-json');
});

test('retries a timed-out group and keeps the later success', async () => {
  const profilesPerRequest = MODEL_EVALUATION_DEFAULTS.profilesPerRequest;
  const candidates = profiles(profilesPerRequest);
  let calls = 0;

  const result = await evaluateProfilesWithModel(candidates, criteria(), {
    profilesPerRequest,
    concurrency: 1,
    maximumAttempts: 2,
    retryBaseDelayMs: 0,
    wait: async () => undefined,
    generateContent: async (parameters) => {
      calls += 1;
      if (calls === 1) {
        const timeout = new Error('The operation was aborted due to timeout');
        timeout.name = 'AbortError';
        throw timeout;
      }

      return modelResponse(requestedProfileIds(parameters));
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.successfulProfiles, candidates.length);
  assert.equal(result.failedProfiles, 0);
});

test('keeps sibling scores when one object in a group is malformed, then retries just that profile', async () => {
  const profilesPerRequest = MODEL_EVALUATION_DEFAULTS.profilesPerRequest;
  const candidates = profiles(profilesPerRequest); // a single request-sized group
  const requestSizes: number[] = [];

  const result = await evaluateProfilesWithModel(candidates, criteria(), {
    profilesPerRequest,
    concurrency: 1,
    maximumAttempts: 2,
    retryBaseDelayMs: 0,
    wait: async () => undefined,
    generateContent: async (parameters) => {
      const ids = requestedProfileIds(parameters);
      requestSizes.push(ids.length);
      // The person requested first in every call comes back malformed, so a
      // lone-profile retry request still fails the same way.
      const evaluations = ids.map((id, index) =>
        index === 0 ? { ...evaluation(id), reasons: [] } : evaluation(id),
      );
      return { text: JSON.stringify({ evaluations }), usage: { ...TEST_TOKEN_USAGE } };
    },
  });

  // A schema miss on one object does not retry within that group's own call,
  // but is pooled into a second, smaller request for just that one profile.
  assert.deepEqual(requestSizes, [profilesPerRequest, 1]);
  assert.equal(result.successfulProfiles, profilesPerRequest - 1);
  assert.equal(result.failedProfiles, 1);
  assert.equal(result.failures.length, 1);
  assert.deepEqual(result.failures[0]?.profileIds, ['profile-0']);
  // The retry's own reply is what gets captured for diagnosis.
  assert.ok(result.failures[0]?.responseText);
  assert.ok(result.failures[0]?.tokenUsage);
});

test('keeps present profiles and fails missing IDs at profile grain', () => {
  const expectedProfileIds = ['profile-1', 'profile-2'];

  // Only profile-1 returned: keep it, fail the omitted profile-2.
  {
    const { assessments, failures } = parseModelEvaluationResponse(
      JSON.stringify({ evaluations: [evaluation('profile-1')] }),
      expectedProfileIds,
    );
    assert.deepEqual(assessments.map((a) => a.profileId), ['profile-1']);
    assert.deepEqual(failures.map((f) => f.profileId), ['profile-2']);
  }

  // Duplicated profile-1, profile-2 absent: keep the first, fail profile-2.
  {
    const { assessments, failures } = parseModelEvaluationResponse(
      JSON.stringify({
        evaluations: [evaluation('profile-1'), evaluation('profile-1')],
      }),
      expectedProfileIds,
    );
    assert.deepEqual(assessments.map((a) => a.profileId), ['profile-1']);
    assert.deepEqual(failures.map((f) => f.profileId), ['profile-2']);
  }

  // Unexpected id ignored (no stolen row), profile-2 still absent -> failed.
  {
    const { assessments, failures } = parseModelEvaluationResponse(
      JSON.stringify({
        evaluations: [evaluation('profile-1'), evaluation('unexpected-profile')],
      }),
      expectedProfileIds,
    );
    assert.deepEqual(assessments.map((a) => a.profileId), ['profile-1']);
    assert.deepEqual(failures.map((f) => f.profileId), ['profile-2']);
  }
});

test('restores requested profile order and aggregates usage from every response', async () => {
  const profilesPerRequest = MODEL_EVALUATION_DEFAULTS.profilesPerRequest;
  const candidates = profiles(profilesPerRequest + 1);

  const result = await evaluateProfilesWithModel(candidates, criteria(), {
    profilesPerRequest,
    concurrency: MODEL_EVALUATION_DEFAULTS.concurrency,
    generateContent: async (parameters) => {
      const profileIds = requestedProfileIds(parameters);
      return {
        text: JSON.stringify({
          evaluations: [...profileIds]
            .reverse()
            .map((profileId) => evaluation(profileId)),
        }),
        usage: { ...TEST_TOKEN_USAGE },
      };
    },
  });

  assert.deepEqual(
    result.evaluations.map((item) => item.profileId),
    candidates.map((item) => item.profileId),
  );
  assert.deepEqual(result.tokenUsage, {
    promptTokens: TEST_TOKEN_USAGE.promptTokens * 2,
    outputTokens: TEST_TOKEN_USAGE.outputTokens * 2,
    thinkingTokens: TEST_TOKEN_USAGE.thinkingTokens * 2,
    totalTokens: TEST_TOKEN_USAGE.totalTokens * 2,
  });
});

test('never retries when every group scores on the main pass', async () => {
  const profilesPerRequest = MODEL_EVALUATION_DEFAULTS.profilesPerRequest;
  const candidates = profiles(profilesPerRequest * 2);
  let calls = 0;

  const result = await evaluateProfilesWithModel(candidates, criteria(), {
    profilesPerRequest,
    concurrency: MODEL_EVALUATION_DEFAULTS.concurrency,
    generateContent: async (parameters) => {
      calls += 1;
      return modelResponse(requestedProfileIds(parameters));
    },
  });

  assert.equal(calls, 2); // one call per main-pass group, no retry request
  assert.equal(result.successfulProfiles, candidates.length);
  assert.equal(result.failedProfiles, 0);
});

test('recovers a profile the model silently omitted, by retrying it alone', async () => {
  const profilesPerRequest = MODEL_EVALUATION_DEFAULTS.profilesPerRequest;
  const candidates = profiles(profilesPerRequest);
  const droppedId = candidates[candidates.length - 1]?.profileId;
  assert.ok(droppedId);
  const requestedIdsByCall: string[][] = [];

  const result = await evaluateProfilesWithModel(candidates, criteria(), {
    profilesPerRequest,
    concurrency: 1,
    generateContent: async (parameters) => {
      const ids = requestedProfileIds(parameters);
      requestedIdsByCall.push(ids);
      // Mirrors the observed GLM behavior: a complete, well-formed reply that
      // simply never includes one requested id, on either call.
      const present = ids.filter((id) => id !== droppedId);
      return modelResponse(present);
    },
  });

  assert.deepEqual(requestedIdsByCall, [
    candidates.map((profile) => profile.profileId),
    [droppedId],
  ]);
  assert.equal(result.successfulProfiles, profilesPerRequest - 1);
  assert.equal(result.failedProfiles, 1);
  assert.equal(result.failures[0]?.profileIds[0], droppedId);
  assert.match(result.failures[0]?.error ?? '', /omitted profile ID/);
});

test('rescues a profile on retry after its first attempt was dropped', async () => {
  const profilesPerRequest = MODEL_EVALUATION_DEFAULTS.profilesPerRequest;
  const candidates = profiles(profilesPerRequest);
  const droppedId = candidates[candidates.length - 1]?.profileId;
  assert.ok(droppedId);
  let attemptsForDroppedProfile = 0;

  const result = await evaluateProfilesWithModel(candidates, criteria(), {
    profilesPerRequest,
    concurrency: 1,
    generateContent: async (parameters) => {
      const ids = requestedProfileIds(parameters);
      if (ids.includes(droppedId)) attemptsForDroppedProfile += 1;
      // Omitted only the first time it was ever requested; present on retry.
      const present =
        attemptsForDroppedProfile === 1
          ? ids.filter((id) => id !== droppedId)
          : ids;
      return modelResponse(present);
    },
  });

  assert.equal(result.successfulProfiles, profilesPerRequest);
  assert.equal(result.failedProfiles, 0);
  assert.ok(result.evaluations.some((item) => item.profileId === droppedId));
});

test('logs evaluation group ranges and fail-now reply text', async () => {
  const logger = recordingLogger();
  const profilesPerRequest = 2;
  const candidates = profiles(3);

  await evaluateProfilesWithModel(candidates, criteria(), {
    profilesPerRequest,
    concurrency: 1,
    retryBaseDelayMs: 0,
    wait: async () => undefined,
    logger,
    generateContent: async (parameters) => {
      const ids = requestedProfileIds(parameters);
      if (ids.length === 2 && ids[0] === 'profile-0') {
        return { text: '{invalid-json' };
      }

      return modelResponse(ids);
    },
  });

  const started = logger.entries.filter(
    (entry) => entry.message === PIPELINE_PROGRESS_MESSAGE.evalStarted,
  );
  assert.equal(started.length, 1);
  const startedPayload = started[0]?.payload as Record<string, unknown>;
  assert.equal(startedPayload['requestedProfiles'], 3);
  assert.equal(startedPayload['totalGroups'], 2);

  const groupStarted = logger.entries.filter(
    (entry) => entry.message === PIPELINE_PROGRESS_MESSAGE.evalGroupStarted,
  );
  const firstGroup = groupStarted[0]?.payload as Record<string, unknown>;
  assert.equal(firstGroup['pass'], EVALUATION_PASS.primary);
  assert.equal(firstGroup['groupNumber'], 1);
  assert.equal(firstGroup['profileStart'], 1);
  assert.equal(firstGroup['profileEnd'], 2);
  assert.equal(firstGroup['profileTotal'], 3);

  const groupFailed = logger.entries.filter(
    (entry) => entry.message === PIPELINE_PROGRESS_MESSAGE.evalGroupFailed,
  );
  assert.ok(groupFailed.length >= 1);
  const failedPayload = groupFailed[0]?.payload as Record<string, unknown>;
  assert.equal(failedPayload['responseText'], '{invalid-json');
  assert.deepEqual(failedPayload['profileIds'], ['profile-0', 'profile-1']);
  assert.equal(typeof failedPayload['durationMs'], 'number');
  assert.ok((failedPayload['durationMs'] as number) >= 0);

  const retryStarted = logger.entries.filter(
    (entry) => entry.message === PIPELINE_PROGRESS_MESSAGE.evalRetryStarted,
  );
  assert.equal(retryStarted.length, 1);
  assert.equal(
    (retryStarted[0]?.payload as Record<string, unknown>)['requestedProfiles'],
    2,
  );
});

test('logs an omitted profile without repeating the batch reply on that line', async () => {
  const logger = recordingLogger();
  const candidates = profiles(2);

  await evaluateProfilesWithModel(candidates, criteria(), {
    profilesPerRequest: 2,
    concurrency: 1,
    logger,
    generateContent: async (parameters) => {
      const ids = requestedProfileIds(parameters);
      return modelResponse(ids.filter((id) => id !== 'profile-1'));
    },
  });

  const completed = logger.entries.filter(
    (entry) => entry.message === PIPELINE_PROGRESS_MESSAGE.evalGroupCompleted,
  );
  const primaryComplete = completed.find((entry) => {
    const payload = entry.payload as Record<string, unknown>;
    return payload['pass'] === EVALUATION_PASS.primary;
  });
  assert.ok(primaryComplete);
  const completePayload = primaryComplete.payload as Record<string, unknown>;
  assert.deepEqual(completePayload['failedProfileIds'], ['profile-1']);
  assert.ok(typeof completePayload['responseText'] === 'string');
  assert.equal(typeof completePayload['durationMs'], 'number');
  assert.ok((completePayload['durationMs'] as number) >= 0);

  const profileFailed = logger.entries.filter(
    (entry) =>
      entry.message === PIPELINE_PROGRESS_MESSAGE.evalProfileFailed &&
      (entry.payload as Record<string, unknown>)['pass'] ===
        EVALUATION_PASS.primary,
  );
  assert.equal(profileFailed.length, 1);
  const profilePayload = profileFailed[0]?.payload as Record<string, unknown>;
  assert.equal(profilePayload['profileId'], 'profile-1');
  assert.match(String(profilePayload['error']), /omitted profile ID/);
  assert.equal(profilePayload['responseText'], undefined);
});
