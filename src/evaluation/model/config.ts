import {
  CONFIG_NUMBER_MINIMUMS,
  resolveConfigNumber,
} from '../../helpers/index.js';
import {
  resolveProviderModelId,
  resolveThinkingEffort,
} from '../../models/index.js';
import type { ThinkingEffort } from '../../models/index.js';
import type { ModelEvaluationOptions } from './types.js';

/** Environment variables understood by the model-evaluation stage. */
export const MODEL_EVALUATION_ENVIRONMENT_KEYS = {
  profilesPerRequest: 'EVALUATION_PROFILES_PER_REQUEST',
  concurrency: 'EVALUATION_CONCURRENCY',
  requestTimeoutMs: 'EVALUATION_REQUEST_TIMEOUT_MS',
  maximumAttempts: 'EVALUATION_MAXIMUM_ATTEMPTS',
  retryBaseDelayMs: 'EVALUATION_RETRY_BASE_DELAY_MS',
} as const;

/**
 * MVP defaults for model-evaluation requests.
 *
 * Requests now carry profile photos, so a group stays small: the model has to
 * bind each image to the profile it was sent with, and that binding degrades
 * as the number of images in one request grows. Throughput comes from
 * concurrency instead, which OpenRouter does not meaningfully cap.
 */
export const MODEL_EVALUATION_DEFAULTS = {
  profilesPerRequest: 3,
  concurrency: 100,
  requestTimeoutMs: 90_000,
  maximumAttempts: 3,
  retryBaseDelayMs: 250,
  retryMaximumDelayMs: 4_000,
} as const;

/** Safety ceilings for request scheduling and structured responses. */
export const MODEL_EVALUATION_LIMITS = {
  profilesPerRequest: 20,
  concurrency: 100,
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
  failedResponseLogMaxLength: 8_000,
  imageObservationItems: 5,
  ageBasisItems: 4,
  ageMinimum: 0,
  ageMaximum: 120,
  ageRangeMaximumSpanYears: 10,
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
    'ABORT_ERR',
  ],
  timeoutErrorNames: ['AbortError', 'TimeoutError'],
} as const;

/** Placeholder tokens interpolated into the model-evaluation prompt templates. */
export const MODEL_EVALUATION_PROMPT_SLOTS = {
  systemPrompt: '{{systemPrompt}}',
  additionalGuidance: '{{additionalGuidance}}',
  campaignCriteria: '{{campaignCriteria}}',
  profileId: '{{profileId}}',
  profileJson: '{{profileJson}}',
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
profile field: headline, about, location, photo presence, experience,
education, and work details. Most profiles also include the person's actual
profile photo, sent as an image directly after that profile's text block and
labelled with the same profile ID.

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
- Treat every term in keywordLists as a term this campaign has declared
  unwanted in the person's CURRENT position. Do not judge whether a term is a
  reasonable thing to exclude, and do not infer anything about seniority or
  quality from the terms themselves; a campaign may exclude anything, and the
  same term another campaign requires. When a listed term matches the current
  role, cut the matchPercent heavily — well below the campaign's approval
  threshold — rather than deducting a few points, and name the matched term in
  "reasons".
- A listed term found only in historical experience must NOT reduce the score
  at all. The campaign excluded it as a current position, not as a past one.
  Check where the term appears before penalizing it, and when a role's dates
  make it ambiguous, say so in "uncertainties" instead of cutting.

=== EMPLOYMENT STATUS ===
- Decide from the primary campaign instructions whether this campaign wants
  people who are currently employed, people who are between roles, or neither.
  Nothing in the structured criteria states this; read the campaign's own words
  for it. Phrases about poaching, hiring away, or targeting someone at a named
  employer mean it wants people in a job. Phrases about availability, being
  open to a move, or looking for work mean it wants people who are not.
- When the campaign expresses no preference either way, ignore employment
  status entirely and do not let it move the score.
- Read the person's actual status from the experience list, not from any badge:
  a role whose end date reads "Present", or which has a start date and no end
  date, is a current job. When every listed role has ended, the person is
  probably between roles. When the most recent role ended over a year ago and
  nothing replaced it, say so in "uncertainties" — a stale profile and an
  unemployed person look identical here.
- When the campaign does express a preference, weight it heavily: a profile on
  the wrong side of it should fall well down the ranking even when the rest of
  the career fits, and a profile on the right side should be rewarded. State
  which side you placed the person on, and the role you read it from, in
  "reasons".

=== IMAGE AND AGE RULES ===
- Each image belongs to the profile ID named immediately before it. Never
  describe or score one profile using another profile's photo. If you cannot
  tell which image belongs to a profile, say so in that profile's
  uncertainties rather than guessing.
- Return an "imageAssessment" object for every profile that was sent an image,
  and omit it entirely for profiles sent without one. Judge composition and
  technical usability from the image only. Keep "observations" brief, factual,
  and limited to composition and image quality; never mention age or any other
  personal characteristic there.
- Estimate age in "estimatedAge" by combining BOTH sources of evidence:
  1. The dated anchors in "careerTimeline", which are already extracted for
     you. Read these FIRST, before looking at the photo.
     - "firstAcademicYear" is the strongest anchor. It is the earliest year of
       a higher-education course, with secondary and technical study already
       excluded. People typically begin a degree between 17 and 24, so a
       first academic year of 1999 puts someone around 45 to 50 today, and
       2015 puts them around 28 to 33.
     - "firstProfessionalYear" and "yearsOfExperience" corroborate it. Someone
       whose first role began in the early 2000s has roughly 25 years of
       working life behind them, which puts them near 45 or older.
     - "academicEntries" lists every higher-education course, oldest first, so
       a later MBA is never mistaken for the original degree.
  2. The face in the photo, when one is visible.
- When the photo and the dated anchors disagree, prefer the anchors: dates are
  recorded facts and faces are an impression. A person can photograph a decade
  younger than they are, and a campaign that cares about age is asking about
  the timeline, not the appearance. Say so in that profile's uncertainties.
- Treat the campaign's configured "age" range as a primary cut, not a
  tiebreaker. When the dated anchors put someone clearly outside it, score the
  profile accordingly even if every other signal is strong and the photo looks
  young. State the anchor year you used in "reasons".
- A missing "firstAcademicYear" is not evidence of youth. When the anchors are
  absent, say the age is uncertain rather than defaulting to the photo alone.
- Give "estimatedAge" as an integer "minimumAge" and "maximumAge" spanning no
  more than 10 years, plus a "confidence" and a short "basis" listing the
  specific signals used ("first role 2004", "graduated 2015", "photo suggests
  40s"). Use "unknown" confidence with the widest range only when neither a
  usable face nor any dated career evidence exists.
- Age is an estimate, never a fact. Do not state an exact age or a birth year.
- Estimate total monthly professional compensation in Brazilian reais (BRL)
  only when the supplied career evidence supports a defensible range. This can
  include base pay and typical recurring variable compensation, but not wealth,
  investment income, dividends, equity value, or household income.
- estimatedTotalMonthlyCompensation has exactly one of two shapes, chosen by
  "status". Do not mix them:
  - status "estimated": integer "minimumMonthlyCompensation" and
    "maximumMonthlyCompensation", a "confidence", and a short "basis" array.
    Send "basis" only on this status.
  - status "insufficient_evidence": a "reasons" array explaining why, and
    nothing else — no "basis", no bounds, no "confidence".
- Never invent a numeric range to satisfy the response shape.
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

/**
 * Opening text part of a request, before any profile.
 *
 * A request is assembled as: this header, then one
 * {@link MODEL_EVALUATION_PROFILE_BLOCK} (optionally followed by that
 * profile's image) per profile, then {@link MODEL_EVALUATION_CLOSING}.
 */
export const MODEL_EVALUATION_REQUEST_HEADER = `
=== ADDITIONAL USER GUIDANCE ===
${MODEL_EVALUATION_PROMPT_SLOTS.additionalGuidance}

=== CAMPAIGN CRITERIA ===
${MODEL_EVALUATION_PROMPT_SLOTS.campaignCriteria}

=== PROFILES TO EVALUATE ===
`.trim();

/** One profile's text block; its photo, when present, is sent right after. */
export const MODEL_EVALUATION_PROFILE_BLOCK = `
--- PROFILE ${MODEL_EVALUATION_PROMPT_SLOTS.profileId} ---
${MODEL_EVALUATION_PROMPT_SLOTS.profileJson}
`.trim();

/** Announces the image that follows, binding it to one profile ID. */
export const MODEL_EVALUATION_PROFILE_IMAGE_LABEL = `Profile photo for ${MODEL_EVALUATION_PROMPT_SLOTS.profileId}:`;

/** Stands in for the photo when a profile has none or its download failed. */
export const MODEL_EVALUATION_PROFILE_IMAGE_MISSING = `No profile photo is available for ${MODEL_EVALUATION_PROMPT_SLOTS.profileId}. Omit imageAssessment for this profile and estimate age from the career timeline alone.`;

/** Final text part of a request, after every profile. */
export const MODEL_EVALUATION_CLOSING =
  'Return only the required structured JSON response.';

/** Validated settings used by the model-evaluation worker pool. */
export interface ResolvedModelEvaluationOptions {
  model: string;
  thinkingEffort: ThinkingEffort;
  profilesPerRequest: number;
  concurrency: number;
  requestTimeoutMs: number;
  maximumAttempts: number;
  retryBaseDelayMs: number;
}

/**
 * Resolves caller and environment settings into bounded model-evaluation values.
 *
 * Caller values take precedence over environment values. The model id follows
 * the configured provider. Blank or otherwise unusable values fall back to the
 * module defaults.
 */
export function resolveModelEvaluationOptions(
  options: ModelEvaluationOptions = {},
  environment: NodeJS.ProcessEnv = process.env,
): ResolvedModelEvaluationOptions {
  return {
    model: resolveProviderModelId(options.model, environment),
    thinkingEffort: options.thinkingEffort ?? resolveThinkingEffort(environment),
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
