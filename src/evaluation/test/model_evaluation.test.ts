import assert from 'node:assert/strict';
import test from 'node:test';

import { CRITERIA_MATCH } from '../filters/constants.js';
import type { FullEvaluationCriteria } from '../criterias/index.js';
import type { EvaluationProfileData } from '../context.js';
import { buildModelEvaluationPrompt } from '../model/prompt.js';
import {
  MODEL_EVALUATION_JSON_SCHEMA,
  parseModelEvaluationResponse,
  ModelEvaluationResponseError,
} from '../model/index.js';
import { validImageAssessment } from '../../test_support/image_assessment_fixtures.js';

const TEST_MINIMUM_MANUAL_REVIEW_PERCENT = 50;
const TEST_MINIMUM_APPROVAL_PERCENT = 75;

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

/** Builds one parseable evaluation, optionally overriding the currency field. */
function compensationEvaluation(
  compensation: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    profileId: 'profile-1',
    matchPercent: 82,
    estimatedTotalMonthlyCompensation: {
      status: 'estimated',
      currency: 'BRL',
      minimumMonthlyCompensation: 9_000,
      maximumMonthlyCompensation: 14_000,
      confidence: 'medium',
      basis: ['Senior customer-success role in the supplied profile.'],
      ...compensation,
    },
    reasons: ['Senior customer-success trajectory in the campaign market.'],
    evidence: ['Headline is Customer Success Manager in Goiânia.'],
    uncertainties: [],
  };
}

test('requests a score without asking Gemini for a final decision', () => {
  const properties =
    MODEL_EVALUATION_JSON_SCHEMA.properties.evaluations.items.properties;

  assert.equal('decision' in properties, false);
  assert.ok(
    MODEL_EVALUATION_JSON_SCHEMA.properties.evaluations.items.required.includes(
      'matchPercent',
    ),
  );
});

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
    decisionPolicy: {
      mode: 'automatic',
      minimumManualReviewPercent: TEST_MINIMUM_MANUAL_REVIEW_PERCENT,
      minimumApprovalPercent: TEST_MINIMUM_APPROVAL_PERCENT,
    },
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
  assert.match(prompt.systemInstruction, /Do not make approve, reject/);
  assert.doesNotMatch(prompt.userContent, /minimumNetWorth/);
  assert.doesNotMatch(prompt.userContent, /minimumApprovalPercent/);
});

test('accepts BRL-equivalent currency spellings on an estimated range', () => {
  const expected = {
    status: 'estimated' as const,
    currency: 'BRL' as const,
    minimumMonthlyCompensation: 9_000,
    maximumMonthlyCompensation: 14_000,
    confidence: 'medium' as const,
    basis: ['Senior customer-success role in the supplied profile.'],
  };

  for (const currency of ['BRL', 'brl', 'R$', undefined]) {
    const { assessments } = parseModelEvaluationResponse(
      JSON.stringify({
        evaluations: [compensationEvaluation({ currency })],
      }),
      ['profile-1'],
    );

    assert.deepEqual(
      assessments[0]?.estimatedTotalMonthlyCompensation,
      expected,
    );
  }
});

test('fails only the profile whose compensation currency is not reais', () => {
  const { assessments, failures } = parseModelEvaluationResponse(
    JSON.stringify({
      evaluations: [compensationEvaluation({ currency: 'USD' })],
    }),
    ['profile-1'],
  );

  assert.equal(assessments.length, 0);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.profileId, 'profile-1');
  assert.match(failures[0]?.error ?? '', /must use BRL, got "USD"/);
});

test('parses a supported total monthly compensation range', () => {
  const { assessments } = parseModelEvaluationResponse(
    JSON.stringify({
      evaluations: [
        {
          profileId: 'profile-1',
          matchPercent: 82,
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

  assert.deepEqual(assessments[0]?.estimatedTotalMonthlyCompensation, {
    status: 'estimated',
    currency: 'BRL',
    minimumMonthlyCompensation: 9_000,
    maximumMonthlyCompensation: 14_000,
    confidence: 'medium',
    basis: ['Senior customer-success role in the supplied profile.'],
  });
});

test('parses at most three highlights, dropping invalid kinds and capping text', () => {
  const longText = 'x'.repeat(120);
  const { assessments } = parseModelEvaluationResponse(
    JSON.stringify({
      evaluations: [
        {
          profileId: 'profile-1',
          matchPercent: 88,
          estimatedTotalMonthlyCompensation: {
            status: 'insufficient_evidence',
            reasons: ['n/a'],
          },
          reasons: ['Strong fit.'],
          evidence: ['Headline matches.'],
          uncertainties: [],
          highlights: [
            { kind: 'strength', text: 'Consistent B2B sales progression' },
            { kind: 'bogus', text: 'invalid kind, skipped' },
            { kind: 'warning', text: longText },
            { kind: 'info', text: 'Based in Goiânia' },
            { kind: 'info', text: 'over the cap, never reached' },
          ],
        },
      ],
    }),
    ['profile-1'],
  );

  const highlights = assessments[0]?.highlights ?? [];
  assert.equal(highlights.length, 3);
  assert.deepEqual(highlights[0], { kind: 'strength', text: 'Consistent B2B sales progression' });
  assert.equal(highlights[1]?.kind, 'warning');
  assert.equal(highlights[1]?.text.length, 80);
  assert.deepEqual(highlights[2], { kind: 'info', text: 'Based in Goiânia' });
});

test('defaults highlights to an empty list when the model omits them', () => {
  const { assessments } = parseModelEvaluationResponse(
    JSON.stringify({
      evaluations: [
        {
          profileId: 'profile-1',
          matchPercent: 60,
          estimatedTotalMonthlyCompensation: {
            status: 'insufficient_evidence',
            reasons: ['n/a'],
          },
          reasons: ['Some fit.'],
          evidence: ['Some evidence.'],
          uncertainties: [],
        },
      ],
    }),
    ['profile-1'],
  );

  assert.deepEqual(assessments[0]?.highlights, []);
});

test('parses an explicit insufficient-evidence compensation result', () => {
  const { assessments } = parseModelEvaluationResponse(
    JSON.stringify({
      evaluations: [
        {
          profileId: 'profile-1',
          matchPercent: 55,
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

  assert.deepEqual(assessments[0]?.estimatedTotalMonthlyCompensation, {
    status: 'insufficient_evidence',
    reasons: ['The supplied profile has no role or seniority details.'],
  });
});

test('fails only the profile whose estimated compensation range is inverted', () => {
  const { assessments, failures } = parseModelEvaluationResponse(
    JSON.stringify({
      evaluations: [
        {
          profileId: 'profile-1',
          matchPercent: 50,
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
  );

  assert.equal(assessments.length, 0);
  assert.equal(failures.length, 1);
  assert.match(failures[0]?.error ?? '', /inverted estimated compensation range/);
});

/** A minimal valid evaluation object for one id. */
function validEvaluation(profileId: string): Record<string, unknown> {
  return {
    profileId,
    matchPercent: 70,
    estimatedTotalMonthlyCompensation: {
      status: 'insufficient_evidence',
      reasons: ['No salary evidence in the profile.'],
    },
    reasons: ['Fits the campaign.'],
    evidence: ['Headline matches.'],
    uncertainties: [],
    highlights: [{ kind: 'strength', text: 'Relevant experience' }],
  };
}

test('keeps the valid profiles when one object in the group is malformed', () => {
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const evaluations = ids.map((id) =>
    id === 'p3' ? { ...validEvaluation(id), reasons: [] } : validEvaluation(id),
  );

  const { assessments, failures } = parseModelEvaluationResponse(
    JSON.stringify({ evaluations }),
    ids,
  );

  assert.deepEqual(assessments.map((a) => a.profileId), ['p1', 'p2', 'p4', 'p5']);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.profileId, 'p3');
});

test('fails only the omitted id and keeps the profiles that were returned', () => {
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];

  const { assessments, failures } = parseModelEvaluationResponse(
    JSON.stringify({
      evaluations: ids.filter((id) => id !== 'p3').map(validEvaluation),
    }),
    ids,
  );

  assert.deepEqual(assessments.map((a) => a.profileId), ['p1', 'p2', 'p4', 'p5']);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.profileId, 'p3');
  assert.match(failures[0]?.error ?? '', /omitted profile ID "p3"/);
});

test('accepts basis as an alias for reasons on insufficient_evidence', () => {
  const { assessments, failures } = parseModelEvaluationResponse(
    JSON.stringify({
      evaluations: [
        {
          ...validEvaluation('p1'),
          estimatedTotalMonthlyCompensation: {
            status: 'insufficient_evidence',
            basis: ['No salary evidence in the profile.'],
            minimumMonthlyCompensation: 0,
            maximumMonthlyCompensation: 0,
            confidence: 'low',
          },
        },
      ],
    }),
    ['p1'],
  );

  assert.equal(failures.length, 0);
  assert.deepEqual(assessments[0]?.estimatedTotalMonthlyCompensation, {
    status: 'insufficient_evidence',
    reasons: ['No salary evidence in the profile.'],
  });
});

test('ignores an object for an unrequested id without stealing a row', () => {
  const { assessments, failures } = parseModelEvaluationResponse(
    JSON.stringify({
      evaluations: [validEvaluation('p1'), validEvaluation('ghost')],
    }),
    ['p1'],
  );

  assert.deepEqual(assessments.map((a) => a.profileId), ['p1']);
  assert.equal(failures.length, 0);
});

test('keeps the first result when an id is duplicated', () => {
  const { assessments, failures } = parseModelEvaluationResponse(
    JSON.stringify({
      evaluations: [
        { ...validEvaluation('p1'), matchPercent: 70 },
        { ...validEvaluation('p1'), matchPercent: 20 },
      ],
    }),
    ['p1'],
  );

  assert.equal(assessments.length, 1);
  assert.equal(assessments[0]?.matchPercent, 70);
  assert.equal(failures.length, 0);
});

test('throws when the JSON envelope itself is unusable', () => {
  assert.throws(
    () => parseModelEvaluationResponse('not json', ['p1']),
    ModelEvaluationResponseError,
  );
  assert.throws(
    () => parseModelEvaluationResponse(JSON.stringify({ nope: [] }), ['p1']),
    ModelEvaluationResponseError,
  );
});

test('unwraps a markdown-fenced reply', () => {
  const fenced = '```json\n' + JSON.stringify({ evaluations: [validEvaluation('p1')] }) + '\n```';

  const { assessments, failures } = parseModelEvaluationResponse(fenced, ['p1']);

  assert.deepEqual(assessments.map((a) => a.profileId), ['p1']);
  assert.equal(failures.length, 0);
});

test('accepts "results" as an alias for the evaluations array', () => {
  const { assessments, failures } = parseModelEvaluationResponse(
    JSON.stringify({ results: [validEvaluation('p1')] }),
    ['p1'],
  );

  assert.deepEqual(assessments.map((a) => a.profileId), ['p1']);
  assert.equal(failures.length, 0);
});

test('accepts a rationale string when reasons is missing', () => {
  const { profileId: _drop, ...rest } = validEvaluation('p1') as Record<string, unknown>;
  const item = { ...rest, profileId: 'p1', rationale: 'Strong commercial trajectory.' };
  delete (item as Record<string, unknown>)['reasons'];

  const { assessments, failures } = parseModelEvaluationResponse(
    JSON.stringify({ evaluations: [item] }),
    ['p1'],
  );

  assert.equal(failures.length, 0);
  assert.deepEqual(assessments[0]?.reasons, ['Strong commercial trajectory.']);
});

test('falls back to highlight text when reasons and evidence are both absent', () => {
  const item = validEvaluation('p1') as Record<string, unknown>;
  delete item['reasons'];
  delete item['evidence'];
  item['highlights'] = [
    { kind: 'strength', text: 'Gestor comercial com carteira B2B' },
    { kind: 'warning', text: 'Pouco tempo na posição atual' },
  ];

  const { assessments, failures } = parseModelEvaluationResponse(
    JSON.stringify({ evaluations: [item] }),
    ['p1'],
  );

  assert.equal(failures.length, 0);
  assert.deepEqual(assessments[0]?.reasons, [
    'Gestor comercial com carteira B2B',
    'Pouco tempo na posição atual',
  ]);
  assert.deepEqual(assessments[0]?.evidence, [
    'Gestor comercial com carteira B2B',
    'Pouco tempo na posição atual',
  ]);
});

test('recovers a whole batch in the shape a provider actually returned', () => {
  // Observed in the 604-profile run: fenced, "results" instead of
  // "evaluations", no reasons/evidence, justification only in highlights.
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const results = ids.map((id) => {
    const item = validEvaluation(id) as Record<string, unknown>;
    delete item['reasons'];
    delete item['evidence'];
    item['highlights'] = [{ kind: 'strength', text: `Justification for ${id}` }];
    return item;
  });
  const reply = '```json\n' + JSON.stringify({ results }) + '\n```';

  const { assessments, failures } = parseModelEvaluationResponse(reply, ids);

  assert.deepEqual(assessments.map((a) => a.profileId), ids);
  assert.equal(failures.length, 0);
});

test('still fails only the omitted id inside a recovered batch', () => {
  const ids = ['p1', 'p2', 'p3'];
  const results = ['p1', 'p3'].map((id) => validEvaluation(id));
  const reply = '```json\n' + JSON.stringify({ results }) + '\n```';

  const { assessments, failures } = parseModelEvaluationResponse(reply, ids);

  assert.deepEqual(assessments.map((a) => a.profileId), ['p1', 'p3']);
  assert.deepEqual(failures.map((f) => f.profileId), ['p2']);
});
