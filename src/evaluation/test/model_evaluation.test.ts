import assert from 'node:assert/strict';
import test from 'node:test';

import { CRITERIA_MATCH } from '../filters/constants.js';
import type { FullEvaluationCriteria } from '../criterias/index.js';
import type { EvaluationProfileData } from '../context.js';
import { buildModelEvaluationPrompt } from '../model/prompt.js';
import {
  MODEL_EVALUATION_DECISION,
  parseModelEvaluationResponse,
  ModelEvaluationResponseError,
} from '../model/index.js';
import { validImageAssessment } from '../../test_support/image_assessment_fixtures.js';

/** Creates the required prompts for a small criteria fixture. */
function prompts(): Pick<FullEvaluationCriteria, 'systemPrompt' | 'userPrompt'> {
  return {
    systemPrompt: 'Evaluate the profile using the selected criteria.',
    userPrompt: 'Return a structured evaluation.',
  };
}

/** Builds compact profile data that includes age and location signals. */
function profile(): EvaluationProfileData {
  return {
    profileId: 'profile-1',
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
    education: [
      {
        schoolName: 'Example University',
        degree: 'Bachelor of Business Administration',
      },
    ],
    imageAnalysis: {
      ...validImageAssessment(),
      apparentAge: { bracket: '35_44', confidence: 'medium' },
    },
    about: 'Builds commercial relationships with enterprise customers.',
  };
}

test('sends profile evidence while keeping desired compensation out of the prompt', () => {
  const criteria: FullEvaluationCriteria = {
    age: { minimumAge: 30, maximumAge: 40 },
    desiredMonthlyCompensation: {
      minimumMonthlyCompensation: 8_000,
      maximumMonthlyCompensation: 20_000,
    },
    location: {
      locations: ['Goiás'],
      fields: ['state'],
      match: CRITERIA_MATCH.any,
    },
    keywordLists: [{ list: ['intern'], match: CRITERIA_MATCH.any }],
    netWorth: { minimumNetWorth: 1_000_000 },
    ...prompts(),
  };

  const prompt = buildModelEvaluationPrompt(criteria, [profile()]);

  assert.match(prompt.systemInstruction, /apparent age/);
  assert.match(
    prompt.systemInstruction,
    /estimatedTotalMonthlyCompensation/,
  );
  assert.match(prompt.systemInstruction, /insufficient_evidence/);
  assert.doesNotMatch(prompt.systemInstruction, /Do not use or infer age/);
  assert.match(prompt.userContent, /"bracket":"35_44"/);
  assert.match(prompt.userContent, /"state":"Goiás"/);
  assert.match(prompt.userContent, /"minimumAge":30/);
  assert.match(prompt.systemInstruction, /current-role exclusions only/);
  assert.match(prompt.userContent, /"list":\["intern"\]/);
  assert.doesNotMatch(prompt.userContent, /minimumMonthlyCompensation/);
  assert.match(prompt.systemInstruction, /Do not estimate or use net worth/);
  assert.doesNotMatch(prompt.userContent, /minimumNetWorth/);
});

test('parses a supported total monthly compensation range', () => {
  const evaluations = parseModelEvaluationResponse(
    JSON.stringify({
      evaluations: [
        {
          profileId: 'profile-1',
          matchPercent: 82,
          decision: MODEL_EVALUATION_DECISION.manualReview,
          estimatedTotalMonthlyCompensation: {
            status: 'estimated',
            currency: 'BRL',
            minimumMonthlyCompensation: 9_000,
            maximumMonthlyCompensation: 14_000,
            confidence: 'medium',
            basis: ['Senior customer-success role in the supplied profile.'],
          },
          reasons: ['Senior customer-success trajectory in the campaign market.'],
          evidence: ['Headline is Customer Success Manager in Goiânia.'],
          uncertainties: [],
        },
      ],
    }),
    ['profile-1'],
  );

  assert.deepEqual(evaluations[0]?.estimatedTotalMonthlyCompensation, {
    status: 'estimated',
    currency: 'BRL',
    minimumMonthlyCompensation: 9_000,
    maximumMonthlyCompensation: 14_000,
    confidence: 'medium',
    basis: ['Senior customer-success role in the supplied profile.'],
  });
});

test('parses an explicit insufficient-evidence compensation result', () => {
  const evaluations = parseModelEvaluationResponse(
    JSON.stringify({
      evaluations: [
        {
          profileId: 'profile-1',
          matchPercent: 55,
          decision: MODEL_EVALUATION_DECISION.manualReview,
          estimatedTotalMonthlyCompensation: {
            status: 'insufficient_evidence',
            reasons: ['The supplied profile has no role or seniority details.'],
          },
          reasons: ['Professional evidence is incomplete.'],
          evidence: ['Only a profile identifier was supplied.'],
          uncertainties: ['Current role and seniority are unknown.'],
        },
      ],
    }),
    ['profile-1'],
  );

  assert.deepEqual(evaluations[0]?.estimatedTotalMonthlyCompensation, {
    status: 'insufficient_evidence',
    reasons: ['The supplied profile has no role or seniority details.'],
  });
});

test('rejects an inverted estimated compensation range', () => {
  assert.throws(
    () =>
      parseModelEvaluationResponse(
        JSON.stringify({
          evaluations: [
            {
              profileId: 'profile-1',
              matchPercent: 50,
              decision: MODEL_EVALUATION_DECISION.manualReview,
              estimatedTotalMonthlyCompensation: {
                status: 'estimated',
                currency: 'BRL',
                minimumMonthlyCompensation: 20_000,
                maximumMonthlyCompensation: 8_000,
                confidence: 'low',
                basis: ['The profile contains limited professional evidence.'],
              },
              reasons: ['Range is invalid.'],
              evidence: ['Salary bounds are inverted.'],
              uncertainties: [],
            },
          ],
        }),
        ['profile-1'],
      ),
    ModelEvaluationResponseError,
  );
});
