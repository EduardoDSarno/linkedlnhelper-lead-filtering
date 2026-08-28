import 'dotenv/config';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { asRecord, asString, writeJsonAtomically } from '../../helpers/index.js';
import { createFileLogger } from '../../logging/index.js';
import type { Logger } from '../../logging/index.js';
import type { FullProfile } from '../../profile/index.js';
import { createEvaluationBatchContext } from '../context.js';
import type { EvaluationBatchContext } from '../context.js';
import type { FullEvaluationCriteria } from '../criterias/index.js';
import { evaluateProfiles } from '../evaluate.js';
import type { EvaluationRunResult } from '../evaluate.js';
import { BROAD_DECISION, CRITERIA_MATCH } from '../filters/broad_filter.js';
import {
  MODEL_EVALUATION_DECISION,
  MODEL_EVALUATION_DEFAULTS,
} from '../model/index.js';
import type { ProfileModelEvaluation } from '../model/index.js';

const LIVE_EVALUATION_ENV_FLAG = 'RUN_LIVE_EVALUATION';
const LIVE_EVALUATION_ENABLED_VALUE = '1';
const LIVE_EVALUATION_PROFILES_PATH = 'output/full-profiles.json';
const LIVE_EVALUATION_LOG_PATH = 'output/evaluation-live.log';
const LIVE_EVALUATION_RESULTS_PATH = 'output/evaluation-live.json';
const LIVE_EVALUATION_SERVICE_NAME = 'evaluation-live';
const LIVE_EVALUATION_REQUEST_TIMEOUT_MS = 90_000;
const LIVE_EVALUATION_MAXIMUM_ATTEMPTS =
  MODEL_EVALUATION_DEFAULTS.maximumAttempts;
const LIVE_EVALUATION_CLEANUP_ALLOWANCE_MS = 30_000;
const LIVE_EVALUATION_RETRY_ALLOWANCE_MS =
  MODEL_EVALUATION_DEFAULTS.retryMaximumDelayMs *
  Math.max(0, LIVE_EVALUATION_MAXIMUM_ATTEMPTS - 1);
const LIVE_EVALUATION_TIMEOUT_MS =
  LIVE_EVALUATION_REQUEST_TIMEOUT_MS * LIVE_EVALUATION_MAXIMUM_ATTEMPTS +
  LIVE_EVALUATION_RETRY_ALLOWANCE_MS +
  LIVE_EVALUATION_CLEANUP_ALLOWANCE_MS;
const LIVE_EVALUATION_MINIMUM_MATCH_PERCENT = 75;
const LIVE_EVALUATION_MINIMUM_AGE = 25;
const LIVE_EVALUATION_MAXIMUM_AGE = 45;
const LIVE_EVALUATION_MINIMUM_MONTHLY_COMPENSATION = 8_000;
const LIVE_EVALUATION_MAXIMUM_MONTHLY_COMPENSATION = 100_000;
const LIVE_EVALUATION_PROFILES_PER_REQUEST = 5;
const LIVE_EVALUATION_PROFILE_LIMIT = 10;
const LIVE_EVALUATION_REJECT_KEYWORDS = [
  'intern',
  'trainee',
  'estagiário',
] as const;

/** Reports why the billed Gemini sample should be skipped, or false to run it. */
function liveEvaluationSkipReason(): string | false {
  if (process.env[LIVE_EVALUATION_ENV_FLAG] !== LIVE_EVALUATION_ENABLED_VALUE) {
    return `Set ${LIVE_EVALUATION_ENV_FLAG}=${LIVE_EVALUATION_ENABLED_VALUE} to run the live Gemini evaluation.`;
  }

  if (!process.env['GEMINI_API_KEY']?.trim()) {
    return 'GEMINI_API_KEY is not configured.';
  }

  if (!existsSync(LIVE_EVALUATION_PROFILES_PATH)) {
    return `Missing sample profiles at ${LIVE_EVALUATION_PROFILES_PATH}.`;
  }

  return false;
}

/** Builds campaign criteria that exercise first-pass cuts and Gemini approval. */
function liveSampleCampaignCriteria(): FullEvaluationCriteria {
  return {
    location: {
      locations: ['Goiás'],
      fields: ['state'],
      match: CRITERIA_MATCH.any,
    },
    keywordLists: [
      {
        list: [...LIVE_EVALUATION_REJECT_KEYWORDS],
        match: CRITERIA_MATCH.any,
      },
    ],
    age: {
      minimumAge: LIVE_EVALUATION_MINIMUM_AGE,
      maximumAge: LIVE_EVALUATION_MAXIMUM_AGE,
    },
    desiredMonthlyCompensation: {
      minimumMonthlyCompensation:
        LIVE_EVALUATION_MINIMUM_MONTHLY_COMPENSATION,
      maximumMonthlyCompensation:
        LIVE_EVALUATION_MAXIMUM_MONTHLY_COMPENSATION,
    },
    requirePhoto: true,
    modelApproval: {
      enabled: true,
      minimumMatchPercent: LIVE_EVALUATION_MINIMUM_MATCH_PERCENT,
    },
    systemPrompt: [
      'Você avalia leads do LinkedIn para uma campanha B2B de vendas',
      'consultivas e relacionamento com clientes em Goiás, Brasil.',
      'Priorize experiência comercial, customer success, bankers de',
      'relacionamento ou SaaS B2B. Trate idade aparente como estimativa.',
      'Estime remuneração profissional mensal total em reais somente quando',
      'o cargo, a senioridade, a formação e o mercado sustentarem a faixa.',
    ].join(' '),
    userPrompt: [
      'Aprove perfis com evidência comercial clara no mercado da campanha.',
      'Use manual_review quando a trajetória for forte mas não comercial,',
      'ou quando faltar evidência para uma decisão segura.',
    ].join(' '),
  };
}

/** Narrows parsed JSON into a FullProfile that evaluation can compact. */
function isSampleFullProfile(value: unknown): value is FullProfile {
  const record = asRecord(value);

  return Boolean(
    record &&
      asString(record['id']) &&
      Array.isArray(record['experience']) &&
      Array.isArray(record['education']),
  );
}

/** Loads the local sample artifact and fails fast when its shape is unusable. */
async function loadSampleFullProfiles(path: string): Promise<FullProfile[]> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));

  if (!Array.isArray(parsed)) {
    throw new Error(`Expected an array of full profiles in ${path}.`);
  }

  return parsed.map((value, index) => {
    if (!isSampleFullProfile(value)) {
      throw new Error(`Invalid full profile at index ${index} in ${path}.`);
    }

    return value;
  });
}

/** Selects a bounded live sample so an artifact cannot trigger an unplanned run. */
function selectLiveEvaluationProfiles(
  profiles: readonly FullProfile[],
): FullProfile[] {
  return profiles.slice(0, LIVE_EVALUATION_PROFILE_LIMIT);
}

/** Counts model decisions so the written artifact has a compact summary. */
function modelDecisionCounts(
  evaluations: readonly ProfileModelEvaluation[],
): Record<ProfileModelEvaluation['decision'], number> {
  const counts = {
    approved: 0,
    rejected: 0,
    manual_review: 0,
  };

  for (const evaluation of evaluations) {
    counts[evaluation.decision] += 1;
  }

  return counts;
}

/** Builds a readable run artifact without copying raw provider payloads. */
function liveEvaluationArtifact(
  availableProfiles: number,
  context: EvaluationBatchContext,
  result: EvaluationRunResult,
): unknown {
  const headlineByProfileId = new Map(
    context.profiles.map((profile) => [profile.profileId, profile.headline]),
  );

  return {
    generatedAt: new Date().toISOString(),
    criteria: context.criteria,
    summary: {
      availableProfiles,
      evaluatedProfiles: context.profiles.length,
      nextPhaseProfiles: result.broadFilter.profilesForAi.length,
      excludedProfiles:
        result.broadFilter.evaluations.length -
        result.broadFilter.profilesForAi.length,
      modelDecisions: modelDecisionCounts(result.modelEvaluation.evaluations),
      tokenUsage: result.modelEvaluation.tokenUsage,
    },
    broadFilter: {
      evaluations: result.broadFilter.evaluations,
      nextPhaseProfileIds: result.broadFilter.profilesForAi.map(
        (profile) => profile.profileId,
      ),
    },
    modelEvaluation: {
      requestedProfiles: result.modelEvaluation.requestedProfiles,
      successfulProfiles: result.modelEvaluation.successfulProfiles,
      failedProfiles: result.modelEvaluation.failedProfiles,
      failures: result.modelEvaluation.failures,
      evaluations: result.modelEvaluation.evaluations.map((evaluation) => ({
        headline: headlineByProfileId.get(evaluation.profileId),
        ...evaluation,
      })),
    },
  };
}

/** Logs first-pass routing so exclusions are visible without pipeline loggers. */
function logBroadFilter(
  logger: Logger,
  result: EvaluationRunResult['broadFilter'],
): void {
  const excluded = result.evaluations.filter(
    (evaluation) => evaluation.decision === BROAD_DECISION.Failed,
  );

  logger.info(
    {
      loadedProfiles: result.evaluations.length,
      nextPhaseProfiles: result.profilesForAi.length,
      excludedProfiles: excluded.length,
      exclusions: excluded.map((evaluation) => ({
        profileId: evaluation.profileId,
        reason: evaluation.decisionMessage,
      })),
      nextPhaseProfileIds: result.profilesForAi.map(
        (profile) => profile.profileId,
      ),
    },
    'Completed broad filter.',
  );
}

/** Logs Gemini decisions, failures, and token use from the run result. */
function logModelEvaluation(
  logger: Logger,
  result: EvaluationRunResult['modelEvaluation'],
): void {
  logger.info(
    {
      requestedProfiles: result.requestedProfiles,
      successfulProfiles: result.successfulProfiles,
      failedProfiles: result.failedProfiles,
      decisions: modelDecisionCounts(result.evaluations),
      evaluations: result.evaluations.map((evaluation) => ({
        profileId: evaluation.profileId,
        decision: evaluation.decision,
        matchPercent: evaluation.matchPercent,
        estimatedTotalMonthlyCompensation:
          evaluation.estimatedTotalMonthlyCompensation,
        compensationRangeMatch: evaluation.compensationRangeMatch,
        reasons: evaluation.reasons,
        evidence: evaluation.evidence,
        uncertainties: evaluation.uncertainties,
      })),
      failures: result.failures,
      tokenUsage: result.tokenUsage,
    },
    'Completed Gemini evaluation.',
  );
}

/** Logs the first-pass and Gemini outcomes from one live evaluation run. */
function logEvaluationRun(
  logger: Logger,
  result: EvaluationRunResult,
): void {
  logBroadFilter(logger, result.broadFilter);
  logModelEvaluation(logger, result.modelEvaluation);
}

test(
  'evaluates sample full profiles through the live Gemini flow',
  {
    timeout: LIVE_EVALUATION_TIMEOUT_MS,
    skip: liveEvaluationSkipReason(),
  },
  async (t) => {
    const loggerHandle = await createFileLogger(
      LIVE_EVALUATION_LOG_PATH,
      randomUUID(),
      LIVE_EVALUATION_SERVICE_NAME,
    );
    const logger = loggerHandle.logger;

    try {
      const availableProfiles = await loadSampleFullProfiles(
        LIVE_EVALUATION_PROFILES_PATH,
      );
      assert.ok(
        availableProfiles.length > 0,
        'The sample artifact must contain at least one full profile.',
      );
      const fullProfiles = selectLiveEvaluationProfiles(availableProfiles);

      const context = createEvaluationBatchContext(
        fullProfiles,
        liveSampleCampaignCriteria(),
      );

      logger.info(
        {
          sourcePath: LIVE_EVALUATION_PROFILES_PATH,
          availableProfiles: availableProfiles.length,
          evaluatedProfiles: fullProfiles.length,
          profileLimit: LIVE_EVALUATION_PROFILE_LIMIT,
          compactProfileIds: context.profiles.map(
            (profile) => profile.profileId,
          ),
        },
        'Loaded and compacted sample full profiles.',
      );

      const result = await evaluateProfiles(context, {
        profilesPerRequest: LIVE_EVALUATION_PROFILES_PER_REQUEST,
        requestTimeoutMs: LIVE_EVALUATION_REQUEST_TIMEOUT_MS,
        maximumAttempts: LIVE_EVALUATION_MAXIMUM_ATTEMPTS,
      });

      logEvaluationRun(logger, result);

      await writeJsonAtomically(
        LIVE_EVALUATION_RESULTS_PATH,
        liveEvaluationArtifact(availableProfiles.length, context, result),
      );

      logger.info(
        { resultsPath: LIVE_EVALUATION_RESULTS_PATH },
        'Wrote live evaluation results.',
      );

      const excluded = result.broadFilter.evaluations.filter(
        (evaluation) => evaluation.decision === BROAD_DECISION.Failed,
      );
      assert.ok(
        excluded.some((evaluation) =>
          evaluation.decisionMessage.includes('keywordLists'),
        ),
        'The intern reject-list should exclude at least one sample profile.',
      );
      assert.ok(
        result.broadFilter.profilesForAi.length > 0,
        'At least one sample profile should reach Gemini.',
      );
      assert.equal(
        result.modelEvaluation.failedProfiles,
        0,
        result.modelEvaluation.failures
          .map((failure) => failure.error)
          .join('; ') || 'Gemini evaluation failed.',
      );
      assert.equal(
        result.modelEvaluation.successfulProfiles,
        result.broadFilter.profilesForAi.length,
      );
      assert.ok(
        result.modelEvaluation.evaluations.every(
          (evaluation) =>
            Object.values(MODEL_EVALUATION_DECISION).includes(
              evaluation.decision,
            ) && evaluation.reasons.length > 0,
        ),
      );

      t.diagnostic(
        JSON.stringify({
          resultsPath: LIVE_EVALUATION_RESULTS_PATH,
          logPath: LIVE_EVALUATION_LOG_PATH,
          availableProfiles: availableProfiles.length,
          evaluatedProfiles: fullProfiles.length,
          excludedProfiles: excluded.length,
          geminiProfiles: result.modelEvaluation.successfulProfiles,
          decisions: modelDecisionCounts(result.modelEvaluation.evaluations),
          tokenUsage: result.modelEvaluation.tokenUsage,
        }),
      );
    } finally {
      await loggerHandle.close();
    }
  },
);
