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
} from '../evaluation_context.js';
import type {
  ApparentAgeBracket,
  ApparentAgeConfidence,
} from '../../image_extractor/index.js';
import { validImageAssessment } from '../../test_support/image_assessment_fixtures.js';

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

/** Builds a compact profile whose image analysis reports one apparent-age bracket. */
function profileWithApparentAge(
  bracket: ApparentAgeBracket,
  confidence: ApparentAgeConfidence = 'medium',
): EvaluationProfileData {
  return profile('profile-1', {
    imageAnalysis: {
      ...validImageAssessment(),
      apparentAge: { bracket, confidence },
    },
  });
}

test('excludes a profile that matches a reject-list keyword', () => {
  const criteria: FullEvaluationCriteria = {
    keywordLists: [{ list: ['intern', 'estagiario'], match: CRITERIA_MATCH.any }],
    ...prompts(),
  };

  const evaluation = evaluateBroadCriteria(
    profile('profile-1', {
      headline: 'Marketing Intern',
      experience: [
        {
          position: 'Marketing Intern',
          companyName: 'Example Company',
        },
      ],
    }),
    criteria,
  );

  assert.equal(evaluation.decision, BROAD_DECISION.Failed);
  assert.equal(evaluation.results[0]?.outcome, BROAD_OUTCOME.matched);
  assert.equal(evaluation.results[0]?.excludes, true);
});

test('sends a profile to AI when reject-list keywords do not match', () => {
  const criteria: FullEvaluationCriteria = {
    keywordLists: [{ list: ['intern', 'trainee'], match: CRITERIA_MATCH.any }],
    ...prompts(),
  };

  const evaluation = evaluateBroadCriteria(profile('profile-1'), criteria);

  assert.equal(evaluation.decision, BROAD_DECISION.NextPhase);
  assert.equal(evaluation.results[0]?.outcome, BROAD_OUTCOME.notMatched);
  assert.equal(evaluation.results[0]?.excludes, false);
});

test('excludes a profile whose current location is known not to match', () => {
  const criteria: FullEvaluationCriteria = {
    location: {
      locations: ['São Paulo'],
      fields: ['state'],
      match: CRITERIA_MATCH.any,
    },
    ...prompts(),
  };

  const evaluation = evaluateBroadCriteria(profile('profile-1'), criteria);

  assert.equal(evaluation.decision, BROAD_DECISION.Failed);
  assert.equal(evaluation.results[0]?.outcome, BROAD_OUTCOME.notMatched);
  assert.equal(evaluation.results[0]?.excludes, true);
});

test('sends a profile to AI when location is uncertain', () => {
  const criteria: FullEvaluationCriteria = {
    location: {
      locations: ['Brasil'],
      fields: ['country'],
      match: CRITERIA_MATCH.any,
    },
    ...prompts(),
  };

  const candidate = profile('profile-1');
  delete candidate.location;

  const evaluation = evaluateBroadCriteria(candidate, criteria);

  assert.equal(evaluation.decision, BROAD_DECISION.NextPhase);
  assert.equal(evaluation.results[0]?.outcome, BROAD_OUTCOME.unknown);
  assert.equal(evaluation.results[0]?.excludes, false);
});

test('excludes people who are open to work when the campaign requires the opposite', () => {
  const criteria: FullEvaluationCriteria = {
    openToWork: false,
    ...prompts(),
  };

  const evaluation = evaluateBroadCriteria(
    profile('profile-1', { openToWork: true }),
    criteria,
  );

  assert.equal(evaluation.decision, BROAD_DECISION.Failed);
  assert.match(evaluation.decisionMessage, /Open to work: true/);
  assert.equal(evaluation.results[0]?.outcome, BROAD_OUTCOME.notMatched);
});

test('excludes people who are not open to work when the campaign requires it', () => {
  const criteria: FullEvaluationCriteria = {
    openToWork: true,
    ...prompts(),
  };

  const evaluation = evaluateBroadCriteria(profile('profile-1'), criteria);

  assert.equal(evaluation.decision, BROAD_DECISION.Failed);
  assert.equal(evaluation.results[0]?.outcome, BROAD_OUTCOME.notMatched);
});

test('sends a profile to AI when open-to-work is configured but unknown', () => {
  const criteria: FullEvaluationCriteria = {
    openToWork: true,
    ...prompts(),
  };

  const candidate = profile('profile-1');
  delete candidate.openToWork;

  const evaluation = evaluateBroadCriteria(candidate, criteria);

  assert.equal(evaluation.decision, BROAD_DECISION.NextPhase);
  assert.equal(evaluation.results[0]?.outcome, BROAD_OUTCOME.unknown);
});

test('removes profiles without photos when that exclusion is configured', () => {
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
    [BROAD_DECISION.Failed, BROAD_DECISION.NextPhase],
  );
  assert.match(result.evaluations[0]?.decisionMessage ?? '', /No profile photo/);
  assert.deepEqual(
    result.profilesForAi.map((candidate) => candidate.profileId),
    ['with-photo'],
  );
});

test('keeps profiles without photos when the photo cut is omitted', () => {
  const criteria: FullEvaluationCriteria = {
    ...prompts(),
  };

  const evaluation = evaluateBroadCriteria(
    profile('without-photo', { hasPhoto: false }),
    criteria,
  );

  assert.equal(evaluation.decision, BROAD_DECISION.NextPhase);
  assert.equal(evaluation.results.length, 0);
});

test('keeps an apparent-age bracket that only fits because of the filter margin', () => {
  const criteria: FullEvaluationCriteria = {
    age: { minimumAge: 30, maximumAge: 40 },
    ...prompts(),
  };

  const evaluation = evaluateBroadCriteria(
    profileWithApparentAge('45_54'),
    criteria,
  );

  assert.equal(evaluation.decision, BROAD_DECISION.NextPhase);
  assert.equal(evaluation.results[0]?.excludes, false);
});

test('excludes an apparent-age bracket that is still outside after the filter margin', () => {
  const criteria: FullEvaluationCriteria = {
    age: { minimumAge: 30, maximumAge: 40 },
    ...prompts(),
  };

  const evaluation = evaluateBroadCriteria(
    profileWithApparentAge('55_64'),
    criteria,
  );

  assert.equal(evaluation.decision, BROAD_DECISION.Failed);
  assert.equal(evaluation.results[0]?.outcome, BROAD_OUTCOME.notMatched);
  assert.equal(evaluation.results[0]?.excludes, true);
});

test('sends a profile to AI when apparent age is missing or unreliable', () => {
  const criteria: FullEvaluationCriteria = {
    age: { minimumAge: 30, maximumAge: 40 },
    ...prompts(),
  };

  const missingAge = evaluateBroadCriteria(profile('profile-1'), criteria);
  const lowConfidence = evaluateBroadCriteria(
    profileWithApparentAge('65_plus', 'low'),
    criteria,
  );

  assert.equal(missingAge.decision, BROAD_DECISION.NextPhase);
  assert.equal(missingAge.results[0]?.outcome, BROAD_OUTCOME.unknown);
  assert.equal(lowConfidence.decision, BROAD_DECISION.NextPhase);
  assert.equal(lowConfidence.results[0]?.outcome, BROAD_OUTCOME.unknown);
});

test('keeps older apparent ages when the age cut is omitted', () => {
  const evaluation = evaluateBroadCriteria(
    profileWithApparentAge('65_plus'),
    prompts(),
  );

  assert.equal(evaluation.decision, BROAD_DECISION.NextPhase);
  assert.equal(evaluation.results.length, 0);
});
