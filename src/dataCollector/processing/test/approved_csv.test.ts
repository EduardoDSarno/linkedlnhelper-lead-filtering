import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { readRawRecords } from '../../csv/csvdata.js';
import {
  collectApprovedPublicIds,
  writeApprovedCsv,
} from '../approved_csv.js';
import type { StoredEvaluationRun } from '../../../database/index.js';
import {
  MODEL_EVALUATION_DECISION,
  type ModelEvaluationDecision,
  type ProfileModelEvaluation,
} from '../../../evaluation/index.js';

/** Builds one model evaluation carrying only the fields under test. */
function modelEvaluation(
  publicId: string,
  decision: ModelEvaluationDecision,
): ProfileModelEvaluation {
  return {
    profileId: `profile-${publicId}`,
    linkedHelperPublicId: publicId,
    decision,
    matchPercent: 0,
    estimatedTotalMonthlyCompensation: {
      status: 'insufficient_evidence',
      reasons: [],
    },
    reasons: [],
    evidence: [],
    uncertainties: [],
  };
}

/** Wraps model evaluations in a complete stored evaluation run. */
function runWith(
  evaluations: ProfileModelEvaluation[],
): StoredEvaluationRun {
  return {
    id: 'run-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    criteria: { systemPrompt: 'test' },
    evaluation: {
      broadFilter: { profilesForAi: [], evaluations: [] },
      modelEvaluation: {
        requestedProfiles: evaluations.length,
        successfulProfiles: evaluations.length,
        failedProfiles: 0,
        evaluations,
        failures: [],
        tokenUsage: {
          promptTokens: 0,
          outputTokens: 0,
          thinkingTokens: 0,
          totalTokens: 0,
        },
      },
    },
  };
}

test('collectApprovedPublicIds keeps only approved public ids', () => {
  const run = runWith([
    modelEvaluation('abc', MODEL_EVALUATION_DECISION.approved),
    modelEvaluation('def', MODEL_EVALUATION_DECISION.rejected),
    modelEvaluation('ghi', MODEL_EVALUATION_DECISION.manualReview),
    modelEvaluation('jkl', MODEL_EVALUATION_DECISION.approved),
  ]);

  assert.deepStrictEqual(
    [...collectApprovedPublicIds(run)].sort(),
    ['abc', 'jkl'],
  );
});

test('writeApprovedCsv keeps the header and approved rows as verbatim bytes', async () => {
  const file = Buffer.from(
    '﻿public_id;full_name\r\nabc;"Ada;\nLovelace"\r\ndef;Bob\r\nghi;Cleo\r\n',
    'utf-8',
  );
  const raw = readRawRecords(file);
  const approved = new Set(['abc', 'ghi']);

  const directory = await mkdtemp(join(tmpdir(), 'approved-csv-'));
  const outputPath = join(directory, 'approved.csv');

  try {
    await writeApprovedCsv(raw, approved, outputPath);
    const written = await readFile(outputPath);

    const expected = Buffer.from(
      '﻿public_id;full_name\r\nabc;"Ada;\nLovelace"\r\nghi;Cleo\r\n',
      'utf-8',
    );
    assert.deepStrictEqual(written, expected);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('writeApprovedCsv writes a header-only file when nothing is approved', async () => {
  const file = Buffer.from('﻿public_id;full_name\r\nabc;Ada\r\n', 'utf-8');
  const raw = readRawRecords(file);

  const directory = await mkdtemp(join(tmpdir(), 'approved-csv-'));
  const outputPath = join(directory, 'approved.csv');

  try {
    await writeApprovedCsv(raw, new Set(), outputPath);
    const written = await readFile(outputPath);

    assert.deepStrictEqual(
      written,
      Buffer.from('﻿public_id;full_name\r\n', 'utf-8'),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
