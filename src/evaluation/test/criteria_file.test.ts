import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  EvaluationCriteriaFileError,
  loadFullEvaluationCriteria,
  parseFullEvaluationCriteria,
} from '../criterias/index.js';

const MAXIMUM_DECISION_PERCENT = 100;
const TEST_MINIMUM_MANUAL_REVIEW_PERCENT = 50;
const TEST_MINIMUM_APPROVAL_PERCENT = 75;

/** Runs one criteria-file assertion in an automatically removed directory. */
async function withCriteriaFile(
  contents: string,
  assertion: (path: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'evaluation-criteria-'));
  const path = join(directory, 'criteria.json');

  try {
    await writeFile(path, contents, 'utf8');
    await assertion(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

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

test('loads valid criteria from JSON on disk', async () => {
  await withCriteriaFile(
    JSON.stringify({
      systemPrompt: 'Evaluate a local commercial campaign.',
      requirePhoto: true,
    }),
    async (path) => {
      assert.deepEqual(await loadFullEvaluationCriteria(path), {
        systemPrompt: 'Evaluate a local commercial campaign.',
        requirePhoto: true,
      });
    },
  );
});

test('rejects malformed criteria JSON with a stable validation error', async () => {
  await withCriteriaFile('{invalid-json', async (path) => {
    await assert.rejects(
      () => loadFullEvaluationCriteria(path),
      EvaluationCriteriaFileError,
    );
  });
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
