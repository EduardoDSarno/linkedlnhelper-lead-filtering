import {
  CONFIG_NUMBER_MINIMUMS,
  resolveConfigNumber,
} from '../../helpers/index.js';
import { DEFAULT_THINKING_EFFORT } from '../../models/index.js';
import type { ModelEvaluationOptions } from './types.js';

/** Environment variables understood by the model-evaluation stage. */
export const MODEL_EVALUATION_ENVIRONMENT_KEYS = {
  model: 'EVALUATION_GEMINI_MODEL',
  profilesPerRequest: 'EVALUATION_PROFILES_PER_REQUEST',
  concurrency: 'EVALUATION_CONCURRENCY',
  requestTimeoutMs: 'EVALUATION_REQUEST_TIMEOUT_MS',
  maximumAttempts: 'EVALUATION_MAXIMUM_ATTEMPTS',
  retryBaseDelayMs: 'EVALUATION_RETRY_BASE_DELAY_MS',
} as const;

/** MVP defaults for model-evaluation requests. */
export const MODEL_EVALUATION_DEFAULTS = {
  model: 'gemini-3.8-flash',
  profilesPerRequest: 5,
  concurrency: 10,
  requestTimeoutMs: 30_000,
  maximumAttempts: 3,
  retryBaseDelayMs: 250,
  retryMaximumDelayMs: 4_000,
  thinkingEffort: DEFAULT_THINKING_EFFORT,
} as const;

/** Safety ceilings for request scheduling and structured responses. */
export const MODEL_EVALUATION_LIMITS = {
  profilesPerRequest: 20,
  concurrency: 50,
  matchPercentMinimum: 0,
  matchPercentMaximum: 100,
  monthlyCompensationMinimum: 0,
  compensationBasisItems: 6,
  compensationReasonItems: 5,
  reasonsPerProfile: 5,
  evidencePerProfile: 6,
  uncertaintiesPerProfile: 5,
  highlightsPerProfile: 3,
  highlightTextMaxLength: 80,
} as const;

/** Errors that may succeed when the same model request is attempted again. */
export const MODEL_EVALUATION_RETRY_POLICY = {
  sdkAttemptsPerCall: 1,
  httpStatusCodes: [408, 429, 500, 502, 503, 504],
  networkErrorCodes: [
    'ECONNRESET',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ETIMEDOUT',
  ],
} as const;

/** Placeholder tokens interpolated into the model-evaluation prompt templates. */
export const MODEL_EVALUATION_PROMPT_SLOTS = {
  systemPrompt: '{{systemPrompt}}',
  additionalGuidance: '{{additionalGuidance}}',
  campaignCriteria: '{{campaignCriteria}}',
  profilesJson: '{{profilesJson}}',
} as const;

/** Fallback text when the campaign did not supply extra user guidance. */
export const MODEL_EVALUATION_EMPTY_USER_PROMPT =
  'No additional user guidance was supplied.';

/** Fallback text when no structured campaign cuts were configured. */
export const MODEL_EVALUATION_EMPTY_CAMPAIGN_CRITERIA =
  'No additional structured campaign criteria were supplied.';

/** Protected system instruction sent with every evaluation request. */
export const MODEL_EVALUATION_SYSTEM_INSTRUCTION = `
You evaluate how well each profile matches the campaign using every supplied
profile field: headline, about, location, open-to-work, photo presence,
experience, education, work details, and image analysis including apparent age.

=== PRIMARY CAMPAIGN INSTRUCTIONS ===
The following user-authored prompt is the primary guidance for campaign fit:

${MODEL_EVALUATION_PROMPT_SLOTS.systemPrompt}

=== REQUIRED EVALUATION RULES ===
- Apply the primary campaign instructions and the campaign criteria JSON
  consistently to every profile.
- Grade campaign fit independently from application decision thresholds. Return
  an integer matchPercent from the configured response range, where a higher
  value means stronger campaign fit. Do not make approve, reject, or manual
  review decisions; application code maps the validated score deterministically.
- Treat keywordLists as current-role exclusions only. A keyword found solely
  in historical experience must not reduce the campaign-fit score.
- Use apparent age when it is present. Treat it as an estimate, not a fact.
- Estimate total monthly professional compensation in Brazilian reais (BRL)
  only when the supplied career evidence supports a defensible range. This can
  include base pay and typical recurring variable compensation, but not wealth,
  investment income, dividends, equity value, or household income.
- Put a supported estimate in estimatedTotalMonthlyCompensation with status
  "estimated", integer bounds, confidence, and a brief evidence basis.
- When the supplied profile cannot support a range, return
  estimatedTotalMonthlyCompensation with status "insufficient_evidence" and
  explain why. Never invent a numeric range to satisfy the response shape.
- Do not compare compensation with a desired campaign range. Application code
  performs that comparison deterministically after validating the response.
- Do not estimate or use net worth.
- Do not invent missing career facts. Put missing or ambiguous information in
  uncertainties.
- Explain each result using evidence from that profile.
- Provide 1 to 3 short "highlights": the most decision-relevant one-liners for a
  reviewer scanning a list. Each has a "kind" of "strength" (a strong positive
  fit signal), "warning" (a genuine concern or risk), or "info" (neutral but
  notable context), and short "text" under 80 characters. Order by importance,
  and match the mix to the profile: a strong fit should lead with strengths, a
  weak one with warnings. Do not force all three kinds.
- Return exactly one structured result for every supplied profile ID.
`.trim();

/** Per-request user content wrapping guidance, criteria, and compact profiles. */
export const MODEL_EVALUATION_USER_CONTENT = `
=== ADDITIONAL USER GUIDANCE ===
${MODEL_EVALUATION_PROMPT_SLOTS.additionalGuidance}

=== CAMPAIGN CRITERIA ===
${MODEL_EVALUATION_PROMPT_SLOTS.campaignCriteria}

=== PROFILES TO EVALUATE ===
${MODEL_EVALUATION_PROMPT_SLOTS.profilesJson}

Return only the required structured JSON response.
`.trim();

/** Validated settings used by the model-evaluation worker pool. */
export interface ResolvedModelEvaluationOptions {
  model: string;
  profilesPerRequest: number;
  concurrency: number;
  requestTimeoutMs: number;
  maximumAttempts: number;
  retryBaseDelayMs: number;
}

/**
 * Resolves caller and environment settings into bounded model-evaluation values.
 *
 * Caller values take precedence over environment values. Blank or otherwise
 * unusable values fall back to the module defaults.
 */
export function resolveModelEvaluationOptions(
  options: ModelEvaluationOptions = {},
  environment: NodeJS.ProcessEnv = process.env,
): ResolvedModelEvaluationOptions {
  return {
    model:
      options.model?.trim() ||
      environment[MODEL_EVALUATION_ENVIRONMENT_KEYS.model]?.trim() ||
      MODEL_EVALUATION_DEFAULTS.model,
    profilesPerRequest: resolveConfigNumber(
      options.profilesPerRequest ??
        environment[MODEL_EVALUATION_ENVIRONMENT_KEYS.profilesPerRequest],
      {
        fallback: MODEL_EVALUATION_DEFAULTS.profilesPerRequest,
        minimum: CONFIG_NUMBER_MINIMUMS.positive,
        maximum: MODEL_EVALUATION_LIMITS.profilesPerRequest,
        integer: true,
        clampMinimum: true,
        clampMaximum: true,
      },
    ),
    concurrency: resolveConfigNumber(
      options.concurrency ??
        environment[MODEL_EVALUATION_ENVIRONMENT_KEYS.concurrency],
      {
        fallback: MODEL_EVALUATION_DEFAULTS.concurrency,
        minimum: CONFIG_NUMBER_MINIMUMS.positive,
        maximum: MODEL_EVALUATION_LIMITS.concurrency,
        integer: true,
        clampMinimum: true,
        clampMaximum: true,
      },
    ),
    requestTimeoutMs: resolveConfigNumber(
      options.requestTimeoutMs ??
        environment[MODEL_EVALUATION_ENVIRONMENT_KEYS.requestTimeoutMs],
      {
        fallback: MODEL_EVALUATION_DEFAULTS.requestTimeoutMs,
        minimum: CONFIG_NUMBER_MINIMUMS.positive,
        integer: true,
      },
    ),
    maximumAttempts: resolveConfigNumber(
      options.maximumAttempts ??
        environment[MODEL_EVALUATION_ENVIRONMENT_KEYS.maximumAttempts],
      {
        fallback: MODEL_EVALUATION_DEFAULTS.maximumAttempts,
        minimum: CONFIG_NUMBER_MINIMUMS.positive,
        integer: true,
      },
    ),
    retryBaseDelayMs: resolveConfigNumber(
      options.retryBaseDelayMs ??
        environment[MODEL_EVALUATION_ENVIRONMENT_KEYS.retryBaseDelayMs],
      {
        fallback: MODEL_EVALUATION_DEFAULTS.retryBaseDelayMs,
        minimum: CONFIG_NUMBER_MINIMUMS.nonNegative,
        integer: true,
      },
    ),
  };
}
