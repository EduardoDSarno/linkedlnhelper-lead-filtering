import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateBroadCriteria,
  filterEvaluationBatch,
} from '../broad_filter.js';
import type { FullEvaluationCriteria } from '../criterias/index.js';
import type {
  EvaluationBatchContext,
  EvaluationProfileData,
} from '../evaluation_context.js';

/** Creates the required prompts for a small criteria fixture. */
function prompts(): Pick<FullEvaluationCriteria, 'systemPrompt' | 'userPrompt'> {
  return {
    systemPrompt: 'Evaluate the profile using the selected criteria.',
    userPrompt: 'Return a structured evaluation.',
  };
}

/** Builds compact profile data with realistic text fields for broad-filter tests. */
function profile(
  profileId: string,
  overrides: Partial<EvaluationProfileData> = {},
): EvaluationProfileData {
  return {
    profileId,
    headline: 'Customer Success Manager',
    location: {
      text: 'Goiânia, Goiás, Brasil',
      city: 'Goiânia',
      state: 'Goiás',
      country: 'Brasil',
    },
    openToWork: false,
    hasPhoto: true,
    experience: [
      {
        position: 'Customer Success Manager',
        companyName: 'Example Company',
        location: 'Goiânia, Goiás, Brasil',
      },
    ],
    about: 'Builds commercial relationships with enterprise customers.',
    ...overrides,
  };
}

test('keeps a profile that matches any configured include criterion', () => {
  const criteria: FullEvaluationCriteria = {
    location: {
      locations: ['Brasília'],
      fields: ['city'],
      match: 'any',
      effect: 'include',
    },
    keywordLists: [
      { list: ['commercial relationships'], match: 'any', effect: 'include' },
    ],
    ...prompts(),
  };

  const evaluation = evaluateBroadCriteria(profile('profile-1'), criteria);

  assert.equal(evaluation.decision, 'send_to_ai');
  assert.equal(evaluation.results[0]?.outcome, 'not_matched');
  assert.equal(evaluation.results[1]?.outcome, 'matched');
});

test('excludes a profile that matches an exclusion criterion', () => {
  const criteria: FullEvaluationCriteria = {
    openToWork: { expectedValue: true, effect: 'exclude' },
    ...prompts(),
  };

  const evaluation = evaluateBroadCriteria(
    profile('profile-1', { openToWork: true }),
    criteria,
  );

  assert.equal(evaluation.decision, 'excluded');
  assert.equal(evaluation.results[0]?.outcome, 'matched');
});

test('excludes a profile that definitively fails every include criterion', () => {
  const criteria: FullEvaluationCriteria = {
    keywordLists: [
      { list: ['investments'], match: 'any', effect: 'include' },
    ],
    ...prompts(),
  };

  const evaluation = evaluateBroadCriteria(profile('profile-1'), criteria);

  assert.equal(evaluation.decision, 'excluded');
  assert.equal(evaluation.results[0]?.outcome, 'not_matched');
});

test('keeps a profile for AI when an apparent-age range is unavailable', () => {
  const criteria: FullEvaluationCriteria = {
    age: { minimumAge: 25, maximumAge: 40, effect: 'include' },
    ...prompts(),
  };

  const evaluation = evaluateBroadCriteria(profile('profile-1'), criteria);

  assert.equal(evaluation.decision, 'send_to_ai');
  assert.equal(evaluation.results[0]?.outcome, 'unknown');
});

test('removes profiles without photos when that exclusion is configured', () => {
  const criteria: FullEvaluationCriteria = {
    photoReview: { requirePhoto: false, effect: 'exclude' },
    ...prompts(),
  };

  const batch: EvaluationBatchContext = {
    criteria,
    profiles: [profile('without-photo', { hasPhoto: false }), profile('with-photo')],
  };

  const result = filterEvaluationBatch(batch);

  assert.deepEqual(
    result.evaluations.map((evaluation) => evaluation.decision),
    ['excluded', 'send_to_ai'],
  );
  assert.deepEqual(
    result.profilesForAi.map((profile) => profile.profileId),
    ['with-photo'],
  );
});
