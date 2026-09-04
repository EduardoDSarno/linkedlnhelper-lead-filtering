import { asHttpStatus, asRecord, asString } from '../../helpers/index.js';
import {
  EVALUATION_PASS,
  PIPELINE_PROGRESS_MESSAGE,
  PIPELINE_STAGE,
  displayIndex,
  displayRange,
} from '../../logging/index.js';
import type { EvaluationPass, Logger } from '../../logging/index.js';
import { resolveModelClient } from '../../models/index.js';
import type { ModelResponse, ModelTokenUsage } from '../../models/index.js';
import type { FullEvaluationCriteria } from '../criterias/index.js';
import type { EvaluationProfileData } from '../context.js';
import {
  MODEL_EVALUATION_DEFAULTS,
  MODEL_EVALUATION_LIMITS,
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
      /** Per-profile failures from an otherwise-usable reply (partial parse). */
      readonly failures: readonly ModelEvaluationFailure[];
      readonly tokenUsage: ModelEvaluationTokenUsage;
    }
  | {
      readonly status: 'rejected';
      readonly failure: ModelEvaluationFailure;
      readonly tokenUsage: ModelEvaluationTokenUsage;
    };

/** Live-progress identity for one evaluation pass through the worker pool. */
interface ModelEvaluationProgress {
  readonly logger?: Logger;
  readonly pass: EvaluationPass;
  readonly passProfileTotal: number;
}

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

  if (isTimeoutModelError(error)) return true;

  return error instanceof TypeError;
}

/** Detects a cancelled or timed-out model call that is worth trying again. */
function isTimeoutModelError(error: unknown): boolean {
  const record = asRecord(error);
  const name = asString(record?.['name']);
  if (
    name &&
    MODEL_EVALUATION_RETRY_POLICY.timeoutErrorNames.includes(
      name as (typeof MODEL_EVALUATION_RETRY_POLICY.timeoutErrorNames)[number],
    )
  ) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /timeout|aborted/i.test(message);
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
  let lastResponseText: string | undefined;

  while (attempts < options.maximumAttempts) {
    attempts += 1;

    try {
      const response = await generateContent({
        model: options.model,
        system: prompt.systemInstruction,
        parts: [{ text: prompt.userContent }],
        jsonSchema: MODEL_EVALUATION_JSON_SCHEMA,
        thinking: options.thinkingEffort,
        timeoutMs: options.requestTimeoutMs,
      });
      lastResponseText = response.text;
      addTokenUsage(tokenUsage, response.usage);

      const parsed = parseModelEvaluationResponse(
        responseText(response),
        profileIds,
      );
      const evaluations = parsed.assessments.map((assessment) =>
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

      // Profiles the reply could not score become per-profile failures. The
      // raw reply and token spend are captured on each one, same as a rejected
      // group, so a person the model silently dropped is fully diagnosable.
      // This attempt does not loop again here: the good siblings are already
      // scored, and evaluateProfilesWithModel pools every remaining failure
      // into one bounded follow-up request instead of re-spending (max)
      // thinking tokens per person inside this group's own call.
      const partialFailures = parsed.failures.map(
        (failure): ModelEvaluationFailure => ({
          profileIds: [failure.profileId],
          attempts,
          retryable: false,
          retryExhausted: false,
          error: failure.error,
          ...(lastResponseText
            ? { responseText: loggedModelResponseText(lastResponseText) }
            : {}),
          ...(hasTokenUsage(tokenUsage) ? { tokenUsage: { ...tokenUsage } } : {}),
        }),
      );

      return {
        status: 'fulfilled',
        evaluations: correlatedEvaluations,
        failures: partialFailures,
        tokenUsage,
      };
    } catch (error: unknown) {
      const retryable = isRetryableModelError(error);
      const retryExhausted = retryable && attempts >= options.maximumAttempts;

      if (retryable && !retryExhausted) {
        await wait(retryDelayMs(options.retryBaseDelayMs, attempts));
        continue;
      }

      return rejectedGroupResult({
        profileIds,
        attempts,
        retryable,
        retryExhausted,
        error: errorMessage(error),
        responseText: lastResponseText,
        tokenUsage,
      });
    }
  }

  return rejectedGroupResult({
    profileIds,
    attempts,
    retryable: true,
    retryExhausted: true,
    error: 'Model evaluation exhausted its configured attempt budget.',
    responseText: lastResponseText,
    tokenUsage,
  });
}

/** Builds the rejected-group shape shared by parse failures and exhausted retries. */
function rejectedGroupResult(input: {
  profileIds: readonly string[];
  attempts: number;
  retryable: boolean;
  retryExhausted: boolean;
  error: string;
  responseText: string | undefined;
  tokenUsage: ModelEvaluationTokenUsage;
}): Extract<ModelEvaluationGroupResult, { status: 'rejected' }> {
  return {
    status: 'rejected',
    failure: {
      profileIds: input.profileIds,
      attempts: input.attempts,
      retryable: input.retryable,
      retryExhausted: input.retryExhausted,
      error: input.error,
      ...(input.responseText
        ? { responseText: loggedModelResponseText(input.responseText) }
        : {}),
      ...(hasTokenUsage(input.tokenUsage)
        ? { tokenUsage: { ...input.tokenUsage } }
        : {}),
    },
    tokenUsage: input.tokenUsage,
  };
}

/** Caps a failed reply so logs and stored failures stay a bounded diagnostic. */
function loggedModelResponseText(text: string): string {
  const limit = MODEL_EVALUATION_LIMITS.failedResponseLogMaxLength;
  return text.length <= limit ? text : text.slice(0, limit);
}

/** Runs profile groups through the model with bounded concurrency. */
async function runProfileGroups(
  groups: readonly (readonly EvaluationProfileData[])[],
  criteria: FullEvaluationCriteria,
  options: ReturnType<typeof resolveModelEvaluationOptions>,
  generateContent: NonNullable<ModelEvaluationOptions['generateContent']>,
  wait: NonNullable<ModelEvaluationOptions['wait']>,
  progress: ModelEvaluationProgress,
): Promise<readonly ModelEvaluationGroupResult[]> {
  const groupResults = new Array<ModelEvaluationGroupResult>(groups.length);
  let nextGroupIndex = 0;
  let completedGroups = 0;

  /** Claims and evaluates profile groups until the shared queue is empty. */
  async function worker(): Promise<void> {
    while (nextGroupIndex < groups.length) {
      const groupIndex = nextGroupIndex;
      nextGroupIndex += 1;
      const group = groups[groupIndex];
      if (!group) continue;

      logEvaluationGroupStart(
        progress,
        groupIndex,
        groups.length,
        group,
        options.profilesPerRequest,
      );
      const result = await evaluateProfileGroup(
        group,
        criteria,
        options,
        generateContent,
        wait,
      );
      completedGroups += 1;
      groupResults[groupIndex] = result;
      logEvaluationGroupOutcome(
        progress,
        groupIndex,
        groups.length,
        completedGroups,
        group,
        options.profilesPerRequest,
        result,
      );
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(options.concurrency, groups.length) },
      async () => worker(),
    ),
  );

  return groupResults;
}

/** Flattens a batch of group results into one evaluation/failure/usage total. */
function reduceGroupResults(
  groupResults: readonly ModelEvaluationGroupResult[],
): {
  evaluations: ProfileModelEvaluation[];
  failures: ModelEvaluationFailure[];
  tokenUsage: ModelEvaluationTokenUsage;
} {
  const evaluations: ProfileModelEvaluation[] = [];
  const failures: ModelEvaluationFailure[] = [];
  const tokenUsage = emptyModelEvaluationTokenUsage();

  for (const result of groupResults) {
    if (!result) continue;
    addTokenUsage(tokenUsage, result.tokenUsage);

    if (result.status === 'fulfilled') {
      evaluations.push(...result.evaluations);
      failures.push(...result.failures);
    } else {
      failures.push(result.failure);
    }
  }

  return { evaluations, failures, tokenUsage };
}

/**
 * Evaluates compact profiles through bounded concurrent model requests.
 *
 * Successful groups are retained even when another group fails, and every
 * returned token count is included in the run total. A profile that never
 * scored on the main pass — whether its whole group was rejected or the model
 * silently dropped it from an otherwise-usable reply — is pooled with every
 * other unscored profile from this run and re-requested exactly once, in new
 * groups of the same request size (the last one smaller if the remainder does
 * not fill it). Already-scored siblings are never re-sent. This mirrors the
 * Apify collector's pool-and-rebatch retry, but bounded to a single follow-up
 * round rather than looping: a schema-shaped omission is a content problem,
 * not a transient one, so repeated rounds would mostly re-spend tokens.
 */
export async function evaluateProfilesWithModel(
  profiles: readonly EvaluationProfileData[],
  criteria: FullEvaluationCriteria,
  callerOptions: ModelEvaluationOptions = {},
): Promise<ModelEvaluationOutcome> {
  const options = resolveModelEvaluationOptions(callerOptions);
  const generateContent = callerOptions.generateContent ?? resolveModelClient();
  const wait = callerOptions.wait ?? waitForRetry;
  const logger = callerOptions.logger;

  const groups = groupProfilesForModelEvaluation(
    profiles,
    options.profilesPerRequest,
  );
  logger?.info(
    {
      stage: PIPELINE_STAGE.eval,
      pass: EVALUATION_PASS.primary,
      requestedProfiles: profiles.length,
      totalGroups: groups.length,
      profilesPerRequest: options.profilesPerRequest,
      concurrency: options.concurrency,
    },
    PIPELINE_PROGRESS_MESSAGE.evalStarted,
  );
  const primary = reduceGroupResults(
    await runProfileGroups(
      groups,
      criteria,
      options,
      generateContent,
      wait,
      {
        pass: EVALUATION_PASS.primary,
        passProfileTotal: profiles.length,
        ...(logger ? { logger } : {}),
      },
    ),
  );

  const tokenUsage = emptyModelEvaluationTokenUsage();
  addTokenUsage(tokenUsage, primary.tokenUsage);

  let evaluations = primary.evaluations;
  let failures = primary.failures;

  const failedProfileIds = failures.flatMap((failure) => failure.profileIds);
  if (failedProfileIds.length > 0) {
    const profilesById = new Map(
      profiles.map((profile) => [profile.profileId, profile]),
    );
    const retryProfiles = failedProfileIds.flatMap((id) => {
      const profile = profilesById.get(id);
      return profile ? [profile] : [];
    });

    if (retryProfiles.length > 0) {
      const retryGroups = groupProfilesForModelEvaluation(
        retryProfiles,
        options.profilesPerRequest,
      );
      logger?.info(
        {
          stage: PIPELINE_STAGE.eval,
          pass: EVALUATION_PASS.retry,
          requestedProfiles: retryProfiles.length,
          totalGroups: retryGroups.length,
          profilesPerRequest: options.profilesPerRequest,
          concurrency: options.concurrency,
        },
        PIPELINE_PROGRESS_MESSAGE.evalRetryStarted,
      );
      const retry = reduceGroupResults(
        await runProfileGroups(
          retryGroups,
          criteria,
          options,
          generateContent,
          wait,
          {
            pass: EVALUATION_PASS.retry,
            passProfileTotal: retryProfiles.length,
            ...(logger ? { logger } : {}),
          },
        ),
      );

      addTokenUsage(tokenUsage, retry.tokenUsage);
      evaluations = [...evaluations, ...retry.evaluations];
      // Every id in failedProfileIds went into this retry, so its outcome
      // (scored or still failed) fully replaces the main-pass failure list.
      failures = retry.failures;
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

/**
 * Logs that a request-sized group is about to be sent to the model.
 */
function logEvaluationGroupStart(
  progress: ModelEvaluationProgress,
  groupIndex: number,
  totalGroups: number,
  group: readonly EvaluationProfileData[],
  profilesPerRequest: number,
): void {
  progress.logger?.info(
    evaluationGroupProgressFields(
      progress,
      groupIndex,
      totalGroups,
      group,
      profilesPerRequest,
    ),
    PIPELINE_PROGRESS_MESSAGE.evalGroupStarted,
  );
}

/**
 * Logs the settled outcome of one group, with fail-now detail when anyone
 * was not scored.
 *
 * An envelope failure includes the capped reply once on the group line.
 * A scored group that omitted people logs that same reply once on the
 * complete line, then one compact per-profile warning without repeating it.
 */
function logEvaluationGroupOutcome(
  progress: ModelEvaluationProgress,
  groupIndex: number,
  totalGroups: number,
  completedGroups: number,
  group: readonly EvaluationProfileData[],
  profilesPerRequest: number,
  result: ModelEvaluationGroupResult,
): void {
  const logger = progress.logger;
  if (!logger) return;

  const payload = {
    ...evaluationGroupProgressFields(
      progress,
      groupIndex,
      totalGroups,
      group,
      profilesPerRequest,
    ),
    completed: completedGroups,
  };

  if (result.status === 'rejected') {
    logger.warn(
      {
        ...payload,
        error: result.failure.error,
        attempts: result.failure.attempts,
        retryable: result.failure.retryable,
        retryExhausted: result.failure.retryExhausted,
        ...(result.failure.responseText
          ? { responseText: result.failure.responseText }
          : {}),
      },
      PIPELINE_PROGRESS_MESSAGE.evalGroupFailed,
    );
    return;
  }

  const scoredProfileIds = result.evaluations.map((item) => item.profileId);
  const failedProfileIds = result.failures.flatMap((item) => [...item.profileIds]);
  const responseText = result.failures.find((item) => item.responseText)
    ?.responseText;

  logger.info(
    {
      ...payload,
      scoredProfiles: result.evaluations.length,
      failedProfiles: result.failures.length,
      scoredProfileIds,
      failedProfileIds,
      ...(responseText ? { responseText } : {}),
    },
    PIPELINE_PROGRESS_MESSAGE.evalGroupCompleted,
  );

  for (const failure of result.failures) {
    const profileId = failure.profileIds[0];
    if (!profileId) continue;

    logger.warn(
      {
        ...payload,
        profileId,
        error: failure.error,
        attempts: failure.attempts,
      },
      PIPELINE_PROGRESS_MESSAGE.evalProfileFailed,
    );
  }
}

/** Shared N-of-total fields for one evaluation group's start and settle lines. */
function evaluationGroupProgressFields(
  progress: ModelEvaluationProgress,
  groupIndex: number,
  totalGroups: number,
  group: readonly EvaluationProfileData[],
  profilesPerRequest: number,
): {
  stage: typeof PIPELINE_STAGE.eval;
  pass: EvaluationPass;
  groupNumber: number;
  totalGroups: number;
  total: number;
  profileStart: number;
  profileEnd: number;
  profileTotal: number;
  profileIds: readonly string[];
} {
  const range = displayRange(groupIndex * profilesPerRequest, group.length);

  return {
    stage: PIPELINE_STAGE.eval,
    pass: progress.pass,
    groupNumber: displayIndex(groupIndex),
    totalGroups,
    total: totalGroups,
    ...range,
    profileTotal: progress.passProfileTotal,
    profileIds: group.map((profile) => profile.profileId),
  };
}
