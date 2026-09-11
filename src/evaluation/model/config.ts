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
  positivesPerProfile: 5,
  negativesPerProfile: 5,
  pointTextMaxLength: 100,
  summaryMaxLength: 400,
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
  evaluationDate: '{{evaluationDate}}',
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
  threshold — rather than deducting a few points, and name the matched term as
  a "negatives" point.
- A listed term found only in historical experience must NOT reduce the score
  at all. The campaign excluded it as a current position, not as a past one.
  Check where the term appears before penalizing it, and when a role's dates
  make it ambiguous, say so as a "negatives" point instead of cutting.

=== EMPLOYMENT STATUS ===
- "careerTimeline.isCurrentlyEmployed" already states whether any listed role
  is still open, and is computed from the role dates rather than any badge: a
  role with no end date, or one reading "Present", is a current job. Read this
  field instead of deriving the answer from the experience list yourself. It is
  absent when the profile lists no roles at all, which is not the same as being
  out of work — say so as an uncertainty rather than assuming either way.
- When it is false, "careerTimeline.monthsSinceLastRole" gives the whole months
  since the most recent role ended, measured against today's date above. It is
  absent when no ended role carries a dated end, in which case the length of
  the gap is unknown and should be reported as an uncertainty, not estimated.
- A gap does not by itself mean the person is out of work: an abandoned profile
  and an unemployed person look identical here. Say which of the two the
  evidence supports, or that it cannot be told.
- Whether any of this counts for or against a profile is the campaign's call.
  Apply the primary campaign instructions; when they say nothing about
  employment, let it alone and do not move the score for it.

=== IMAGE AND AGE RULES ===
- Each image belongs to the profile ID named immediately before it. Never
  describe or score one profile using another profile's photo. If you cannot
  tell which image belongs to a profile, say so as a "negatives" point on that
  profile rather than guessing.
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
  the timeline, not the appearance. Say so as a "negatives" point.
- Treat the campaign's configured "age" range as a primary cut, not a
  tiebreaker. When the dated anchors put someone clearly outside it, score the
  profile accordingly even if every other signal is strong and the photo looks
  young. State the anchor year you used in the "summary".
- A missing "firstAcademicYear" is not evidence of youth. When the anchors are
  absent, say the age is uncertain as a "negatives" point rather than
  defaulting to the photo alone.
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
  "negatives" as a caution rather than inventing it.
- Explain each result using evidence from that profile.
- Provide "positives" (0 to 5) and "negatives" (0 to 5): short one-liners under
  100 characters each, citing the specific evidence behind them — a dated
  anchor, a keyword match, a career-fit signal — so a reviewer scanning a list
  can read the whole case in seconds. "positives" are reasons the profile fits
  the campaign; "negatives" are concerns, risks, exclusions, or genuine
  uncertainties working against it. Leave a list short or empty rather than
  padding it with filler, and match the mix to the profile: a strong fit
  should show more positives, a weak one more negatives.
- Provide a "summary": one or two plain-language sentences stating why you
  landed on this matchPercent, naming the strongest signal(s) behind the score
  (for example, the anchor year used for age, or which side of the
  employment-status preference the person is on).
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
=== TODAY'S DATE ===
${MODEL_EVALUATION_PROMPT_SLOTS.evaluationDate}
Every date in a profile is historical. Read "how long ago" against this date;
it is the only reference point available, so do not assume any other.

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
