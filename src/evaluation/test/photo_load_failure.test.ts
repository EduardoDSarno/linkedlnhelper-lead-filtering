import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateProfiles } from '../evaluate.js';
import type { EvaluationBatchContext, EvaluationProfileData } from '../context.js';
import type { FullEvaluationCriteria } from '../criterias/index.js';
import type { ModelPart, ModelRequest } from '../../llm/index.js';
import type { loadProfileImage } from '../photos/index.js';

/** A photo URL whose signature LinkedIn has already stopped honouring. */
const EXPIRED_PHOTO_URL =
  'https://media.licdn.com/dms/image/v2/expired/profile-framedphoto-shrink_100_100/0/1?e=1&v=beta&t=x';

const PROFILE_ID = 'expired-photo';

/** Criteria that ask for a photo, so the flag reaches the model unchanged. */
function criteria(): FullEvaluationCriteria {
  return {
    requirePhoto: true,
    systemPrompt: 'Evaluate the profile using the selected criteria.',
    userPrompt: 'Return a structured evaluation.',
  };
}

/** Builds compact profile data that claims a photo the loader may not fetch. */
function profileClaimingAPhoto(): EvaluationProfileData {
  return {
    profileId: PROFILE_ID,
    headline: 'Customer Success Manager',
    openToWork: false,
    hasPhoto: true,
    photoConfirmedByProvider: false,
    photoUrl: EXPIRED_PHOTO_URL,
    experience: [],
    education: [],
    careerTimeline: { academicEntries: [] },
  };
}

/** Builds one structurally valid evaluation so the run completes normally. */
function modelReply(): { text: string } {
  return {
    text: JSON.stringify({
      evaluations: [
        {
          profileId: PROFILE_ID,
          matchPercent: 50,
          positives: [],
          negatives: [],
          summary: 'The profile matches the campaign fixture.',
        },
      ],
    }),
  };
}

/**
 * Reads back the profile JSON the request actually carried.
 *
 * Each profile occupies its own text part, so the block is located per part
 * rather than across the joined prompt.
 */
function sentProfileJson(parts: readonly ModelPart[]): Record<string, unknown> {
  for (const part of parts) {
    if (!('text' in part)) continue;
    const match = /^\{.*"profileId".*\}$/m.exec(part.text);
    if (match) return JSON.parse(match[0]) as Record<string, unknown>;
  }

  assert.fail('the request should carry a profile JSON block');
}

/** Runs one evaluation against a loader with the supplied outcome. */
async function evaluateWithLoader(
  loadPhoto: typeof loadProfileImage,
): Promise<{ request: ModelRequest; failures: number }> {
  let request: ModelRequest | undefined;
  const context: EvaluationBatchContext = {
    criteria: criteria(),
    profiles: [profileClaimingAPhoto()],
  };

  const result = await evaluateProfiles(
    context,
    {
      generateContent: async (received) => {
        request = received;
        return modelReply();
      },
    },
    { loadPhoto },
  );

  assert.ok(request, 'the evaluator should have issued a model request');
  return { request, failures: result.photoLoadFailures.length };
}

test('tells the model no photo exists when the photo could not be downloaded', async () => {
  const { request, failures } = await evaluateWithLoader(async () => {
    throw new Error('403 Forbidden');
  });

  const sent = sentProfileJson(request.parts);
  assert.equal(sent['hasPhoto'], false);
  assert.equal(sent['photoUrl'], undefined);
  assert.equal(sent['photoConfirmedByProvider'], undefined);
  assert.ok(
    !request.parts.some((part) => 'image' in part),
    'no image should be attached when the download failed',
  );
  assert.equal(failures, 1);
});

test('leaves the photo fields alone when the download succeeds', async () => {
  const { request, failures } = await evaluateWithLoader(async () => ({
    data: Uint8Array.from([1, 2, 3]),
    mimeType: 'image/jpeg',
  }));

  const sent = sentProfileJson(request.parts);
  assert.equal(sent['hasPhoto'], true);
  assert.equal(sent['photoConfirmedByProvider'], false);
  assert.ok(
    request.parts.some((part) => 'image' in part),
    'the downloaded photo should be attached',
  );
  assert.equal(failures, 0);
});
