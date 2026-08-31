import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEvaluationReportCsv } from '../evaluation_report.js';
import type { StoredEvaluationRun } from '../../../database/index.js';
import type { FullProfile } from '../../../profile/index.js';
import {
  MODEL_EVALUATION_DECISION,
  type ProfileBroadEvaluation,
  type ProfileModelEvaluation,
} from '../../../evaluation/index.js';

/** Builds a full profile carrying only the fields the report reads. */
function profile(
  publicId: string,
  firstName: string,
  lastName: string,
): FullProfile {
  return {
    id: `profile-${publicId}`,
    linkedinUrl: `https://linkedin.com/in/${publicId}`,
    firstName,
    lastName,
    linkedHelperPublicId: publicId,
    experience: [],
    education: [],
    raw: {},
  };
}

/** Builds one broad-filter evaluation for a public id. */
function broad(
  publicId: string,
  decision: ProfileBroadEvaluation['decision'],
  decisionMessage: string,
): ProfileBroadEvaluation {
  return {
    profileId: `profile-${publicId}`,
    linkedHelperPublicId: publicId,
    decision,
    decisionMessage,
    results: [],
  };
}

/** Builds one model evaluation with the reported fields populated. */
function model(
  publicId: string,
  matchPercent: number,
  reasons: string[],
): ProfileModelEvaluation {
  return {
    profileId: `profile-${publicId}`,
    linkedHelperPublicId: publicId,
    decision: MODEL_EVALUATION_DECISION.approved,
    matchPercent,
    estimatedTotalMonthlyCompensation: {
      status: 'insufficient_evidence',
      reasons: [],
    },
    reasons,
    evidence: ['profile says senior engineer'],
    uncertainties: ['tenure unclear'],
  };
}

/** Assembles a stored run from broad, model, and failure inputs. */
function run(
  broadEvaluations: ProfileBroadEvaluation[],
  modelEvaluations: ProfileModelEvaluation[],
  failures: StoredEvaluationRun['evaluation']['modelEvaluation']['failures'],
): StoredEvaluationRun {
  return {
    id: 'run-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    criteria: { systemPrompt: 'test' },
    evaluation: {
      broadFilter: { profilesForAi: [], evaluations: broadEvaluations },
      modelEvaluation: {
        requestedProfiles: modelEvaluations.length,
        successfulProfiles: modelEvaluations.length,
        failedProfiles: failures.length,
        evaluations: modelEvaluations,
        failures,
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

test('buildEvaluationReportCsv reports one row per profile with the right status', () => {
  const profiles = [
    profile('a', 'Ada', 'Lovelace'),
    profile('b', 'Bob', 'Stone'),
    profile('c', 'Cleo', 'Vale'),
  ];

  const stored = run(
    [
      broad('a', 'NextPhase', 'passed'),
      broad('b', 'Failed', 'Located outside target region'),
      broad('c', 'NextPhase', 'passed'),
    ],
    [model('a', 90, ['strong fit, senior role'])],
    [
      {
        profileIds: ['profile-c'],
        attempts: 2,
        retryable: true,
        retryExhausted: true,
        error: 'model timed out',
      },
    ],
  );

  const csv = buildEvaluationReportCsv(profiles, stored);
  const lines = csv.trimEnd().split('\r\n');

  // Header (with BOM) plus one row per profile.
  assert.equal(lines.length, 4);
  assert.ok(lines[0]?.endsWith('public_id,name,linkedin_url,broad_decision,model_decision,match_percent,reasons,evidence,uncertainties,status,final_decision,manual_reason'));

  // Approved profile: evaluated, comma-containing reason is quoted.
  assert.ok(lines[1]?.startsWith('a,Ada Lovelace,https://linkedin.com/in/a,NextPhase,approved,90,'));
  assert.ok(lines[1]?.includes('"strong fit, senior role"'));
  assert.ok(lines[1]?.endsWith(',evaluated,auto_approved,'));

  // Filtered-out profile: reason is the broad decision message, no model cells.
  assert.ok(lines[2]?.startsWith('b,Bob Stone,https://linkedin.com/in/b,Failed,,,'));
  assert.ok(lines[2]?.endsWith(',filtered_out,filtered_out,'));

  // Model failure: recorded as model_error with the failure message.
  assert.ok(lines[3]?.startsWith('c,Cleo Vale,https://linkedin.com/in/c,NextPhase,,,model timed out'));
  assert.ok(lines[3]?.endsWith(',model_error,,'));
});

test('buildEvaluationReportCsv records manual overrides with their reason', () => {
  const profiles = [
    profile('a', 'Ada', 'Lovelace'),
    profile('b', 'Bob', 'Stone'),
  ];

  const stored = run(
    [broad('a', 'NextPhase', 'passed'), broad('b', 'NextPhase', 'passed')],
    [model('a', 90, ['strong fit']), model('b', 88, ['good fit'])],
    [],
  );

  const csv = buildEvaluationReportCsv(profiles, stored, [
    { publicId: 'b', decision: 'rejected', reason: 'not a fit after a call' },
  ]);
  const lines = csv.trimEnd().split('\r\n');

  // The untouched profile keeps its automatic decision.
  assert.ok(lines[1]?.endsWith(',evaluated,auto_approved,'));

  // The overridden profile records the human decision and reason.
  assert.ok(lines[2]?.endsWith(',evaluated,manually_rejected,not a fit after a call'));
});
