import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EvaluationCriteriaFileError,
  parseFullEvaluationCriteria,
} from '../criterias/index.js';

const MAXIMUM_DECISION_PERCENT = 100;
const TEST_MINIMUM_MANUAL_REVIEW_PERCENT = 50;
const TEST_MINIMUM_APPROVAL_PERCENT = 75;

test('parses every currently supported evaluation criterion', () => {
  const parsed = parseFullEvaluationCriteria({
    systemPrompt: ' Evaluate this campaign. ',
    userPrompt: ' Prefer experienced commercial candidates. ',
    location: {
      locations: ['Goiás'],
      fields: ['state', 'text'],
      match: 'any',
    },
    keywordLists: [{ list: ['intern'], match: 'any' }],
    age: { minimumAge: 25, maximumAge: 45 },
    desiredMonthlyCompensation: {
      minimumMonthlyCompensation: 8_000,
      maximumMonthlyCompensation: 30_000,
    },
    netWorth: { minimumNetWorth: 0, maximumNetWorth: 1_000_000 },
    decisionPolicy: {
      mode: 'automatic',
      minimumManualReviewPercent: TEST_MINIMUM_MANUAL_REVIEW_PERCENT,
      minimumApprovalPercent: TEST_MINIMUM_APPROVAL_PERCENT,
    },
    requirePhoto: true,
    openToWork: false,
  });

  assert.equal(parsed.systemPrompt, 'Evaluate this campaign.');
  assert.equal(parsed.userPrompt, 'Prefer experienced commercial candidates.');
  assert.deepEqual(parsed.location?.fields, ['state', 'text']);
  assert.equal(
    parsed.desiredMonthlyCompensation?.minimumMonthlyCompensation,
    8_000,
  );
  assert.deepEqual(parsed.decisionPolicy, {
    mode: 'automatic',
    minimumManualReviewPercent: TEST_MINIMUM_MANUAL_REVIEW_PERCENT,
    minimumApprovalPercent: TEST_MINIMUM_APPROVAL_PERCENT,
  });
});

test('parses skipImageAnalysis and omits it when absent', () => {
  const withFlag = parseFullEvaluationCriteria({
    systemPrompt: 'Evaluate this campaign.',
    skipImageAnalysis: true,
  });
  assert.equal(withFlag.skipImageAnalysis, true);

  const withoutFlag = parseFullEvaluationCriteria({
    systemPrompt: 'Evaluate this campaign.',
  });
  assert.equal('skipImageAnalysis' in withoutFlag, false);
});

test('parses an explicit manual decision policy without score thresholds', () => {
  const parsed = parseFullEvaluationCriteria({
    systemPrompt: 'Evaluate this campaign.',
    decisionPolicy: { mode: 'manual' },
  });

  assert.deepEqual(parsed.decisionPolicy, { mode: 'manual' });
});

test('rejects missing prompts, unknown fields, invalid types, and ranges', () => {
  const invalidCriteria: unknown[] = [
    {},
    { systemPrompt: 'Valid prompt.', unsupportedCriterion: true },
    { systemPrompt: 'Valid prompt.', ageCompensationBands: [] },
    { systemPrompt: 'Valid prompt.', requirePhoto: 'true' },
    { systemPrompt: 'Valid prompt.', skipImageAnalysis: 'true' },
    {
      systemPrompt: 'Valid prompt.',
      location: { locations: ['Goiás'], fields: ['timezone'], match: 'any' },
    },
    {
      systemPrompt: 'Valid prompt.',
      age: { minimumAge: 45, maximumAge: 25 },
    },
    {
      systemPrompt: 'Valid prompt.',
      desiredMonthlyCompensation: {
        minimumMonthlyCompensation: 20_000,
        maximumMonthlyCompensation: 10_000,
      },
    },
    {
      systemPrompt: 'Valid prompt.',
      decisionPolicy: {
        mode: 'automatic',
        minimumManualReviewPercent: TEST_MINIMUM_MANUAL_REVIEW_PERCENT,
        minimumApprovalPercent: MAXIMUM_DECISION_PERCENT + 1,
      },
    },
    {
      systemPrompt: 'Valid prompt.',
      decisionPolicy: {
        mode: 'automatic',
        minimumManualReviewPercent: TEST_MINIMUM_APPROVAL_PERCENT,
        minimumApprovalPercent: TEST_MINIMUM_MANUAL_REVIEW_PERCENT,
      },
    },
    { systemPrompt: 'Valid prompt.', decisionPolicy: { mode: 'automatic' } },
    {
      systemPrompt: 'Valid prompt.',
      decisionPolicy: {
        mode: 'manual',
        minimumManualReviewPercent: TEST_MINIMUM_MANUAL_REVIEW_PERCENT,
      },
    },
  ];

  for (const value of invalidCriteria) {
    assert.throws(
      () => parseFullEvaluationCriteria(value),
      EvaluationCriteriaFileError,
    );
  }
});
