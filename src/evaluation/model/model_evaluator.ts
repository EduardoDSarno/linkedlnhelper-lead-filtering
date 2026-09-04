import { asHttpStatus, asRecord, asString } from '../../helpers/index.js';
import { geminiModelClient } from '../../models/index.js';
import type { ModelResponse, ModelTokenUsage } from '../../models/index.js';
import type { FullEvaluationCriteria } from '../criterias/index.js';
import type { EvaluationProfileData } from '../context.js';
import {
  MODEL_EVALUATION_DEFAULTS,
  MODEL_EVALUATION_RETRY_POLICY,
  resolveModelEvaluationOptions,
} from './config.js';
import { attachCompensationRangeMatch } from './compensation.js';
import { applyDecisionPolicy } from './decision_policy.js';
import { buildModelEvaluationPrompt } from './prompt.js';
import {
  MODEL_EVALUATION_JSON_SCHEMA,
  ModelEvaluationResponseError,
  parseModelEvaluationResponse,
} from './schema.js';
import type {
  ModelEvaluationFailure,
  ModelEvaluationOptions,
  ModelEvaluationOutcome,
  ModelEvaluationTokenUsage,
  ProfileModelEvaluation,
} from './types.js';

/** Internal successful or failed result for one request-sized profile group. */
type ModelEvaluationGroupResult =
  | {
      readonly status: 'fulfilled';
      readonly evaluations: readonly ProfileModelEvaluation[];
      readonly tokenUsage: ModelEvaluationTokenUsage;
    }
  | {
      readonly status: 'rejected';
      readonly failure: ModelEvaluationFailure;
      readonly tokenUsage: ModelEvaluationTokenUsage;
    };

/** Creates a present, serializable token total for aggregation. */
export function emptyModelEvaluationTokenUsage(): ModelEvaluationTokenUsage {
  return {
    promptTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
  };
}

/** Adds optional model usage into a stable run-level total. */
function addTokenUsage(
  target: ModelEvaluationTokenUsage,
  usage: ModelTokenUsage | ModelEvaluationTokenUsage | undefined,
): void {
  if (!usage) return;

  target.promptTokens += usage.promptTokens ?? 0;
  target.outputTokens += usage.outputTokens ?? 0;
  target.thinkingTokens += usage.thinkingTokens ?? 0;
  target.totalTokens += usage.totalTokens ?? 0;
}

/** Reports whether a token total contains any billable model activity. */
function hasTokenUsage(usage: ModelEvaluationTokenUsage): boolean {
  return Object.values(usage).some((value) => value > 0);
}

/** Waits between production retry attempts without blocking the event loop. */
async function waitForRetry(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

/** Calculates bounded exponential backoff after a failed attempt. */
function retryDelayMs(baseDelayMs: number, failedAttempts: number): number {
  const exponentialDelay = baseDelayMs * 2 ** Math.max(0, failedAttempts - 1);
  return Math.min(
    exponentialDelay,
    MODEL_EVALUATION_DEFAULTS.retryMaximumDelayMs,
  );
}

/** Reads the HTTP status exposed by common SDK and fetch error shapes. */
function errorHttpStatus(error: unknown): number | undefined {
  const record = asRecord(error);
  return asHttpStatus(record?.['status']) ?? asHttpStatus(record?.['code']);
}

/** Reads a network error code when a request failed before receiving HTTP. */
function networkErrorCode(error: unknown): string | undefined {
  const record = asRecord(error);
  return asString(record?.['code']) ??
    asString(asRecord(record?.['cause'])?.['code']);
}

/** Decides whether another attempt could recover one model-call failure. */
function isRetryableModelError(error: unknown): boolean {
  if (error instanceof ModelEvaluationResponseError) return false;

  const status = errorHttpStatus(error);
  if (
    status !== undefined &&
    MODEL_EVALUATION_RETRY_POLICY.httpStatusCodes.includes(
      status as (typeof MODEL_EVALUATION_RETRY_POLICY.httpStatusCodes)[number],
    )
  ) {
    return true;
  }

  const code = networkErrorCode(error);
  if (
    code &&
    MODEL_EVALUATION_RETRY_POLICY.networkErrorCodes.includes(
      code as (typeof MODEL_EVALUATION_RETRY_POLICY.networkErrorCodes)[number],
    )
  ) {
    return true;
  }

  return error instanceof TypeError;
}

/** Converts an unknown thrown value into a stable failure message. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Extracts usable response text or explains why the model produced none. */
function responseText(response: ModelResponse): string {
  if (response.blockReason) {
    throw new ModelEvaluationResponseError(
      `The model blocked the evaluation request: ${response.blockReason}.`,
    );
  }

  const text = response.text.trim();
  if (text) return text;

  throw new ModelEvaluationResponseError('The model returned no evaluation.');
}

/** Splits profiles into request-sized groups while preserving input order. */
export function groupProfilesForModelEvaluation(
  profiles: readonly EvaluationProfileData[],
  profilesPerRequest: number,
): readonly (readonly EvaluationProfileData[])[] {
  const groups: EvaluationProfileData[][] = [];

  for (let index = 0; index < profiles.length; index += profilesPerRequest) {
    groups.push(profiles.slice(index, index + profilesPerRequest));
  }

  return groups;
}

/** Sends one request-sized profile group and applies isolated retry policy. */
async function evaluateProfileGroup(
  profiles: readonly EvaluationProfileData[],
  criteria: FullEvaluationCriteria,
  options: ReturnType<typeof resolveModelEvaluationOptions>,
  generateContent: NonNullable<ModelEvaluationOptions['generateContent']>,
  wait: NonNullable<ModelEvaluationOptions['wait']>,
): Promise<ModelEvaluationGroupResult> {
  const profileIds = profiles.map((profile) => profile.profileId);
  const prompt = buildModelEvaluationPrompt(criteria, profiles);
  const tokenUsage = emptyModelEvaluationTokenUsage();
  let attempts = 0;

  while (attempts < options.maximumAttempts) {
    attempts += 1;

    try {
      const response = await generateContent({
        model: options.model,
        system: prompt.systemInstruction,
        parts: [{ text: prompt.userContent }],
        jsonSchema: MODEL_EVALUATION_JSON_SCHEMA,
        thinking: MODEL_EVALUATION_DEFAULTS.thinkingEffort,
        timeoutMs: options.requestTimeoutMs,
      });
      addTokenUsage(tokenUsage, response.usage);

      const assessments = parseModelEvaluationResponse(
        responseText(response),
        profileIds,
      );
      const evaluations = assessments.map((assessment) =>
        applyDecisionPolicy(assessment, criteria.decisionPolicy),
      );
      const desiredCompensation = criteria.desiredMonthlyCompensation;
      const evaluationsWithCompensation =
        desiredCompensation === undefined
          ? evaluations
          : evaluations.map((evaluation) =>
              attachCompensationRangeMatch(evaluation, desiredCompensation),
            );
      const publicIdsByProfileId = new Map(
        profiles.map((profile) => [
          profile.profileId,
          profile.linkedHelperPublicId,
        ]),
      );
      const correlatedEvaluations = evaluationsWithCompensation.map(
        (evaluation): ProfileModelEvaluation => {
          const linkedHelperPublicId = publicIdsByProfileId.get(
            evaluation.profileId,
          );

          return {
            ...evaluation,
            ...(linkedHelperPublicId ? { linkedHelperPublicId } : {}),
          };
        },
      );

      return {
        status: 'fulfilled',
        evaluations: correlatedEvaluations,
        tokenUsage,
      };
    } catch (error: unknown) {
      const retryable = isRetryableModelError(error);
      const retryExhausted = retryable && attempts >= options.maximumAttempts;

      if (retryable && !retryExhausted) {
        await wait(retryDelayMs(options.retryBaseDelayMs, attempts));
        continue;
      }

      return {
        status: 'rejected',
        failure: {
          profileIds,
          attempts,
          retryable,
          retryExhausted,
          error: errorMessage(error),
          ...(hasTokenUsage(tokenUsage) ? { tokenUsage: { ...tokenUsage } } : {}),
        },
        tokenUsage,
      };
    }
  }

  return {
    status: 'rejected',
    failure: {
      profileIds,
      attempts,
      retryable: true,
      retryExhausted: true,
      error: 'Model evaluation exhausted its configured attempt budget.',
      ...(hasTokenUsage(tokenUsage) ? { tokenUsage: { ...tokenUsage } } : {}),
    },
    tokenUsage,
  };
}

/**
 * Evaluates compact profiles through bounded concurrent model requests.
 *
 * Successful groups are retained even when another group fails. Only the
 * transiently failed group is retried, and every returned token count is
 * included in the run total.
 */
export async function evaluateProfilesWithModel(
  profiles: readonly EvaluationProfileData[],
  criteria: FullEvaluationCriteria,
  callerOptions: ModelEvaluationOptions = {},
): Promise<ModelEvaluationOutcome> {
  const options = resolveModelEvaluationOptions(callerOptions);
  const generateContent = callerOptions.generateContent ?? geminiModelClient;
  const wait = callerOptions.wait ?? waitForRetry;
  const groups = groupProfilesForModelEvaluation(
    profiles,
    options.profilesPerRequest,
  );
  const groupResults = new Array<ModelEvaluationGroupResult>(groups.length);
  let nextGroupIndex = 0;

  /** Claims and evaluates profile groups until the shared queue is empty. */
  async function worker(): Promise<void> {
    while (nextGroupIndex < groups.length) {
      const groupIndex = nextGroupIndex;
      nextGroupIndex += 1;
      const group = groups[groupIndex];
      if (!group) continue;

      groupResults[groupIndex] = await evaluateProfileGroup(
        group,
        criteria,
        options,
        generateContent,
        wait,
      );
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(options.concurrency, groups.length) },
      async () => worker(),
    ),
  );

  const evaluations: ProfileModelEvaluation[] = [];
  const failures: ModelEvaluationFailure[] = [];
  const tokenUsage = emptyModelEvaluationTokenUsage();

  for (const result of groupResults) {
    if (!result) continue;
    addTokenUsage(tokenUsage, result.tokenUsage);

    if (result.status === 'fulfilled') {
      evaluations.push(...result.evaluations);
    } else {
      failures.push(result.failure);
    }
  }

  const failedProfiles = failures.reduce(
    (total, failure) => total + failure.profileIds.length,
    0,
  );

  return {
    requestedProfiles: profiles.length,
    successfulProfiles: evaluations.length,
    failedProfiles,
    evaluations,
    failures,
    tokenUsage,
  };
}
