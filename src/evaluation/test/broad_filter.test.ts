import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROAD_DECISION,
  BROAD_OUTCOME,
  CRITERIA_MATCH,
  evaluateBroadCriteria,
  filterEvaluationBatch,
} from '../filters/broad_filter.js';
import type { FullEvaluationCriteria } from '../criterias/index.js';
import type {
  EvaluationBatchContext,
  EvaluationProfileData,
} from '../context.js';

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
    education: [],
    careerTimeline: { academicEntries: [] },
    about: 'Builds commercial relationships with enterprise customers.',
    ...overrides,
  };
}

test('keeps profiles without photos, recording the gap instead of cutting them', () => {
  // A scraper reads a profile anonymously, so a photo restricted to members or
  // connections is indistinguishable from no photo. Excluding here threw away
  // real candidates; the model ranks them instead.
  const criteria: FullEvaluationCriteria = {
    requirePhoto: true,
    ...prompts(),
  };

  const batch: EvaluationBatchContext = {
    criteria,
    profiles: [profile('without-photo', { hasPhoto: false }), profile('with-photo')],
  };

  const result = filterEvaluationBatch(batch);

  assert.deepEqual(
    result.evaluations.map((evaluation) => evaluation.decision),
    [BROAD_DECISION.NextPhase, BROAD_DECISION.NextPhase],
  );
  assert.match(result.evaluations[0]?.results[0]?.evidence[0] ?? '', /No profile photo/);
  assert.deepEqual(
    result.profilesForAi.map((candidate) => candidate.profileId),
    ['without-photo', 'with-photo'],
  );
});

test('keeps profiles without photos when the photo cut is omitted', () => {
  const evaluation = evaluateBroadCriteria(
    profile('without-photo', { hasPhoto: false }),
    prompts(),
  );

  assert.equal(evaluation.decision, BROAD_DECISION.NextPhase);
  assert.equal(evaluation.results.length, 0);
});

test('reports the photo cut as met when a photo is present', () => {
  const evaluation = evaluateBroadCriteria(profile('with-photo'), {
    requirePhoto: true,
    ...prompts(),
  });

  assert.equal(evaluation.decision, BROAD_DECISION.NextPhase);
  assert.equal(evaluation.results[0]?.outcome, BROAD_OUTCOME.matched);
});

test('no longer excludes on location, age, keyword, or open-to-work', () => {
  // Every value here would have been a hard exclude before those cuts moved to
  // model scoring: a Goiás profile against a São Paulo campaign, an apparent
  // age far outside the range, a matching reject-list term in the current
  // role, and the opposite open-to-work value.
  const criteria: FullEvaluationCriteria = {
    location: {
      locations: ['São Paulo, SP'],
      fields: ['text'],
      match: CRITERIA_MATCH.any,
    },
    age: { minimumAge: 25, maximumAge: 30 },
    keywordLists: [{ list: ['customer success'], match: CRITERIA_MATCH.any }],
    openToWork: true,
    ...prompts(),
  };

  const evaluation = evaluateBroadCriteria(profile('profile-1'), criteria);

  assert.equal(evaluation.decision, BROAD_DECISION.NextPhase);
  assert.equal(evaluation.results.length, 0);
});

test('reports only the photo criterion when the retired criteria are also configured', () => {
  const criteria: FullEvaluationCriteria = {
    location: {
      locations: ['São Paulo, SP'],
      fields: ['text'],
      match: CRITERIA_MATCH.any,
    },
    openToWork: true,
    requirePhoto: true,
    ...prompts(),
  };

  const evaluation = evaluateBroadCriteria(
    profile('without-photo', { hasPhoto: false }),
    criteria,
  );

  assert.equal(evaluation.decision, BROAD_DECISION.NextPhase);
  assert.equal(evaluation.results.length, 1);
  assert.equal(evaluation.results[0]?.criterion, 'requirePhoto');
  assert.equal(evaluation.results[0]?.excludes, false);
});
