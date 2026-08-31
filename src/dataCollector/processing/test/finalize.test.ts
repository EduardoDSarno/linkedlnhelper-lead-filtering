import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { applyOverrides, finalizeRun } from '../finalize.js';
import type { StoredEvaluationRun } from '../../../database/index.js';
import type { ProcessingPaths } from '../processing.js';
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
function runWith(evaluations: ProfileModelEvaluation[]): StoredEvaluationRun {
  return {
    id: 'run-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    criteria: { systemPrompt: 'test' },
    evaluation: {
      broadFilter: {
        profilesForAi: [],
        evaluations: evaluations.map((evaluation) => ({
          profileId: evaluation.profileId,
          linkedHelperPublicId: evaluation.linkedHelperPublicId as string,
          decision: 'NextPhase',
          decisionMessage: 'passed',
          results: [],
        })),
      },
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

test('applyOverrides adds, removes, and keeps automatic decisions', () => {
  const stored = runWith([
    modelEvaluation('auto-yes', MODEL_EVALUATION_DECISION.approved),
    modelEvaluation('auto-no', MODEL_EVALUATION_DECISION.rejected),
    modelEvaluation('review-me', MODEL_EVALUATION_DECISION.manualReview),
  ]);

  const { approvedPublicIds, unknownPublicIds } = applyOverrides(stored, [
    { publicId: 'review-me', decision: 'approved', reason: 'checked manually' },
    { publicId: 'auto-yes', decision: 'rejected' },
    { publicId: 'missing-id', decision: 'approved' },
  ]);

  // Manual approval added, auto approval removed, untouched rejection kept out.
  assert.deepStrictEqual([...approvedPublicIds].sort(), ['review-me']);
  assert.deepStrictEqual(unknownPublicIds, ['missing-id']);
});

test('finalizeRun rebuilds the approved CSV from verbatim original bytes', async () => {
  const original = Buffer.from(
    '﻿public_id;full_name\r\nauto-yes;Ada\r\nreview-me;"Bob;\nStone"\r\n',
    'utf-8',
  );
  const stored = runWith([
    modelEvaluation('auto-yes', MODEL_EVALUATION_DECISION.approved),
    modelEvaluation('review-me', MODEL_EVALUATION_DECISION.manualReview),
  ]);

  const dir = await mkdtemp(join(tmpdir(), 'finalize-'));
  const paths: ProcessingPaths = {
    dir,
    original: join(dir, 'original.csv'),
    approved: join(dir, 'approved-linked-helper.csv'),
    report: join(dir, 'evaluation-report.csv'),
  };

  try {
    await writeFile(paths.original, original);

    const { finalApprovedCount } = await finalizeRun(paths, stored, [], [
      { publicId: 'review-me', decision: 'approved', reason: 'looks great' },
      { publicId: 'auto-yes', decision: 'rejected' },
    ]);

    assert.equal(finalApprovedCount, 1);

    // Only the manually approved row remains, byte-identical to the original.
    const approved = await readFile(paths.approved);
    assert.deepStrictEqual(
      approved,
      Buffer.from(
        '﻿public_id;full_name\r\nreview-me;"Bob;\nStone"\r\n',
        'utf-8',
      ),
    );

    // The report records the reviewer's reason.
    const report = await readFile(paths.report, 'utf-8');
    assert.ok(report.includes('manually_approved,looks great'));
    assert.ok(report.includes('manually_rejected'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
