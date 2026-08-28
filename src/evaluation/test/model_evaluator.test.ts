import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';

import type {
  GenerateContentParameters,
  GenerateContentResponse,
} from '@google/genai';

import { asRecord, asString } from '../../helpers/index.js';
import type { FullEvaluationCriteria } from '../criterias/index.js';
import type { EvaluationProfileData } from '../context.js';
import {
  COMPENSATION_RANGE_OUTCOME,
  MODEL_EVALUATION_DECISION,
  MODEL_EVALUATION_DEFAULTS,
  ModelEvaluationResponseError,
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
  promptTokenCount: 100,
  candidatesTokenCount: 40,
  thoughtsTokenCount: 20,
  totalTokenCount: 160,
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

/** Wraps response JSON in the narrow SDK shape consumed by the evaluator. */
function geminiResponse(
  profileIds: readonly string[],
  usage = TEST_TOKEN_USAGE,
): GenerateContentResponse {
  return {
    text: JSON.stringify({
      evaluations: profileIds.map((profileId) => evaluation(profileId)),
    }),
    usageMetadata: { ...usage },
  } as GenerateContentResponse;
}

/** Extracts the requested profile IDs from the generated Gemini user content. */
function requestedProfileIds(
  parameters: GenerateContentParameters,
): string[] {
  const contents = parameters.contents;
  assert.ok(Array.isArray(contents));

  const text = asString(asRecord(contents[0])?.['text']);
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
      return geminiResponse(profileIds);
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
    }) as GenerateContentResponse,
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
      return geminiResponse(requestedProfileIds(parameters));
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

      return geminiResponse(profileIds);
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

test('does not retry an invalid response and retains successful groups', async () => {
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
          usageMetadata: { ...TEST_TOKEN_USAGE },
        } as GenerateContentResponse;
      }

      return geminiResponse(profileIds);
    },
  });

  assert.equal(callsByFirstProfile.get(invalidGroupId), 1);
  assert.equal(result.successfulProfiles, profilesPerRequest);
  assert.equal(result.failedProfiles, profilesPerRequest);
  assert.equal(result.failures[0]?.retryable, false);
  assert.match(result.failures[0]?.error ?? '', /invalid JSON/);
});

test('rejects missing, duplicated, and unexpected response profile IDs', () => {
  const expectedProfileIds = ['profile-1', 'profile-2'];

  assert.throws(
    () =>
      parseModelEvaluationResponse(
        JSON.stringify({ evaluations: [evaluation('profile-1')] }),
        expectedProfileIds,
      ),
    ModelEvaluationResponseError,
  );
  assert.throws(
    () =>
      parseModelEvaluationResponse(
        JSON.stringify({
          evaluations: [
            evaluation('profile-1'),
            evaluation('profile-1'),
          ],
        }),
        expectedProfileIds,
      ),
    ModelEvaluationResponseError,
  );
  assert.throws(
    () =>
      parseModelEvaluationResponse(
        JSON.stringify({
          evaluations: [
            evaluation('profile-1'),
            evaluation('unexpected-profile'),
          ],
        }),
        expectedProfileIds,
      ),
    ModelEvaluationResponseError,
  );
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
        usageMetadata: { ...TEST_TOKEN_USAGE },
      } as GenerateContentResponse;
    },
  });

  assert.deepEqual(
    result.evaluations.map((item) => item.profileId),
    candidates.map((item) => item.profileId),
  );
  assert.deepEqual(result.tokenUsage, {
    promptTokens: TEST_TOKEN_USAGE.promptTokenCount * 2,
    outputTokens: TEST_TOKEN_USAGE.candidatesTokenCount * 2,
    thinkingTokens: TEST_TOKEN_USAGE.thoughtsTokenCount * 2,
    totalTokens: TEST_TOKEN_USAGE.totalTokenCount * 2,
  });
});
