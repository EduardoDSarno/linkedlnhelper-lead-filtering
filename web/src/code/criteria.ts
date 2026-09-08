/**
 * The evaluation-criteria form and its translation to the backend contract.
 *
 * `CriteriaForm` is what the modal edits; `toEvaluationCriteria` converts it into
 * the `FullEvaluationCriteria` the `/run_filter` endpoint validates. Fields the
 * user leaves empty are omitted rather than sent blank, because the backend
 * reads an omitted criterion as "do not filter on this" and rejects an empty one.
 */

/** How deeply the model should reason while scoring. */
export const THINKING_MODE = {
  default: 'default',
  max: 'max',
} as const;

/** A single thinking-mode value. */
export type ThinkingMode = (typeof THINKING_MODE)[keyof typeof THINKING_MODE];

/**
 * Profiles sent in one evaluation request. Kept in lockstep with the backend
 * evaluation defaults so the time estimate uses the same grouping.
 */
export const EVALUATION_PROFILES_PER_REQUEST = 5;

/**
 * Evaluation requests allowed in flight. Kept in lockstep with the backend's
 * EVALUATION_CONCURRENCY env value so the time estimate uses the same wave
 * size. Update this constant by hand if that value changes — there is no live
 * link between them.
 */
export const EVALUATION_CONCURRENCY = 50;

/**
 * Photo-analysis requests allowed in flight. Kept in lockstep with the
 * backend's IMAGE_ANALYSIS_CONCURRENCY env value, same caveat as above.
 */
export const IMAGE_ANALYSIS_CONCURRENCY = 50;

/** Measured wall time of one parallel evaluation wave at default thinking. */
export const DEFAULT_THINKING_WAVE_SECONDS = 25;

/** Measured wall time of one parallel evaluation wave at max thinking. */
export const MAX_THINKING_WAVE_SECONDS = 80;

/**
 * Estimated wall time of one parallel photo-analysis wave.
 *
 * Not a measured figure like the evaluation waves above — image calls have no
 * per-wave timing captured yet. Refine this once real durationMs logs from the
 * image stage are available.
 */
export const IMAGE_ANALYSIS_WAVE_SECONDS = 12;

/**
 * Profiles per second Apify collects, from the collector's own production
 * benchmark (750 profiles in ~80s at the configured concurrency).
 * See src/dataCollector/apify_profile_collector/APIFY_COLLECTOR_CONFIG.md.
 */
export const APIFY_PROFILES_PER_SECOND = 750 / 80;

/**
 * How many times slower a max-thinking wave is than a default wave.
 *
 * Derived from the measured wave durations so hover copy stays in lockstep.
 */
export const MAX_THINKING_TIME_RATIO = Math.round(
  MAX_THINKING_WAVE_SECONDS / DEFAULT_THINKING_WAVE_SECONDS,
);

/**
 * Measured thinking-token multiplier of max versus default, from the GLM
 * bake-off. Used in the hover copy so the UI names the same finding.
 */
export const MAX_THINKING_TOKEN_RATIO = 18;

/** Hover card shown on each reasoning-toggle option. */
export const THINKING_MODE_HINTS: Record<
  ThinkingMode,
  { title: string; body: string }
> = {
  [THINKING_MODE.default]: {
    title: 'Padrão',
    body: `Mais rápido e econômico. A pontuação leva cerca de ${MAX_THINKING_TIME_RATIO}× menos tempo e usa bem menos tokens de raciocínio.`,
  },
  [THINKING_MODE.max]: {
    title: 'Máximo',
    body: `Pensa mais em cada perfil. Demora cerca de ${MAX_THINKING_TIME_RATIO}× mais e usa cerca de ${MAX_THINKING_TOKEN_RATIO}× mais tokens de raciocínio, o custo extra é pequeno.`,
  },
};

/** Seconds in one minute, used to format the estimate. */
const SECONDS_PER_MINUTE = 60;

/** Rounds short estimates so the copy stays in even increments. */
const SHORT_ESTIMATE_ROUNDING_SECONDS = 5;

/** Editable state of the criteria form. */
export interface CriteriaForm {
  /** The ideal profile; becomes the model's system prompt. */
  ideal: string;

  /** Optional extra guidance sent as the user prompt. */
  extra: string;

  /** Words that exclude a profile when present in its current role. */
  exclusions: string[];

  ageMin: number;
  ageMax: number;
  compMin: number;
  compMax: number;

  /** When true, profiles without a photo are excluded before the model. */
  requirePhoto: boolean;

  /**
   * When true, no photo is sent with the evaluation request. Age is then
   * estimated from the career timeline alone and no image assessment is
   * returned. Photos no longer cost a separate model call, so the saving is
   * only the image tokens inside a request that runs either way.
   */
  skipImageAnalysis: boolean;


  /** Automatic applies the thresholds; manual sends every scored profile to review. */
  automatic: boolean;
  approveMin: number;
  manualMin: number;

  /** How deeply the model should think while scoring. Defaults to Padrão. */
  thinkingMode: ThinkingMode;
}

/** The criteria the campaign starts from, matching the designed defaults. */
export const DEFAULT_CRITERIA: CriteriaForm = {
  ideal:
    'Gestores comerciais e de Customer Success em SaaS B2B ou serviços financeiros, com carreira consultiva e progressão de analista a gestão.',
  extra: '',
  exclusions: [],
  ageMin: 25,
  ageMax: 40,
  compMin: 10000,
  compMax: 30000,
  requirePhoto: false,
  skipImageAnalysis: false,
  automatic: true,
  approveMin: 75,
  manualMin: 50,
  thinkingMode: THINKING_MODE.default,
};

/** Formats one amount as Brazilian currency. */
export function brl(value: number): string {
  return `R$ ${value.toLocaleString('pt-BR')}`;
}


/** Builds the one-line summary shown on the upload screen and modal footer. */
export function criteriaSummary(form: CriteriaForm): string {
  return [
    `${form.ageMin}–${form.ageMax} anos (est.)`,
    `${brl(form.compMin)}–${brl(form.compMax)}/mês`,
    `${form.exclusions.length} exclusões no cargo atual`,
    form.thinkingMode === THINKING_MODE.max
      ? 'raciocínio máximo'
      : 'raciocínio padrão',
  ].join(' · ');
}

/** Reports whether the form can produce valid criteria. */
export function isCriteriaComplete(form: CriteriaForm): boolean {
  return form.ideal.trim().length > 0;
}

/**
 * Counts how many sequential evaluation waves a profile count needs.
 *
 * Groups fill to the configured request size, then run up to the configured
 * concurrency. Wall time is one wave, not one profile.
 */
export function evaluationWaveCount(profileCount: number): number {
  const profiles = Math.max(profileCount, 1);
  const groups = Math.ceil(profiles / EVALUATION_PROFILES_PER_REQUEST);
  return Math.ceil(groups / EVALUATION_CONCURRENCY);
}

/** Counts how many sequential photo-analysis waves a profile count needs. */
export function imageAnalysisWaveCount(profileCount: number): number {
  const profiles = Math.max(profileCount, 1);
  return Math.ceil(profiles / IMAGE_ANALYSIS_CONCURRENCY);
}

/** Estimates scoring wall time from profile count and the chosen thinking mode. */
export function estimateEvaluationSeconds(
  profileCount: number,
  mode: ThinkingMode,
): number {
  const waveSeconds =
    mode === THINKING_MODE.max
      ? MAX_THINKING_WAVE_SECONDS
      : DEFAULT_THINKING_WAVE_SECONDS;
  return evaluationWaveCount(profileCount) * waveSeconds;
}

/** Estimates photo-analysis wall time, or zero when the campaign skips it. */
export function estimateImageAnalysisSeconds(
  profileCount: number,
  skipImageAnalysis: boolean,
): number {
  if (skipImageAnalysis) return 0;
  return imageAnalysisWaveCount(profileCount) * IMAGE_ANALYSIS_WAVE_SECONDS;
}

/** Estimates Apify collection wall time from the collector's measured rate. */
export function estimateCollectionSeconds(profileCount: number): number {
  return Math.max(profileCount, 1) / APIFY_PROFILES_PER_SECOND;
}

/**
 * Estimates total run wall time: collection, then photo analysis (unless
 * skipped), then scoring — the same three stages the pipeline runs in order.
 */
export function estimatePipelineSeconds(
  profileCount: number,
  mode: ThinkingMode,
  skipImageAnalysis: boolean,
): number {
  return (
    estimateCollectionSeconds(profileCount) +
    estimateImageAnalysisSeconds(profileCount, skipImageAnalysis) +
    estimateEvaluationSeconds(profileCount, mode)
  );
}

/** Formats a duration as short Portuguese estimate copy. */
export function formatDurationEstimate(seconds: number): string {
  if (seconds < SECONDS_PER_MINUTE) {
    const rounded = Math.max(
      SHORT_ESTIMATE_ROUNDING_SECONDS,
      Math.round(seconds / SHORT_ESTIMATE_ROUNDING_SECONDS)
        * SHORT_ESTIMATE_ROUNDING_SECONDS,
    );
    return `cerca de ${rounded} segundos`;
  }

  const minutes = Math.max(1, Math.round(seconds / SECONDS_PER_MINUTE));
  return minutes === 1 ? 'cerca de 1 minuto' : `cerca de ${minutes} minutos`;
}

/**
 * Builds the upload-screen estimate shown above the send-to-AI button.
 *
 * Covers the whole run — collection, photo analysis, and scoring — not just
 * scoring. Max thinking and a skipped photo analysis each name themselves in
 * the sentence so either time-affecting choice is obvious.
 */
export function pipelineTimeEstimateMessage(
  profileCount: number,
  mode: ThinkingMode,
  skipImageAnalysis: boolean,
): string {
  const duration = formatDurationEstimate(
    estimatePipelineSeconds(profileCount, mode, skipImageAnalysis),
  );
  const profiles = profileCount === 1 ? '1 perfil' : `${profileCount} perfis`;
  const reasoning = mode === THINKING_MODE.max ? ' com raciocínio máximo' : '';
  const photos = skipImageAnalysis
    ? ', sem análise de foto'
    : '';
  return `A avaliação${reasoning}${photos} deve levar ${duration} para ${profiles}.`;
}

/**
 * Converts the form into the criteria payload the review endpoint accepts.
 *
 * Empty collections and blank text are omitted so the backend applies no filter
 * for them instead of rejecting an empty rule. Seniority and any other nuance
 * the user wants live in the ideal-profile prompt, which steers the model.
 */
export function toEvaluationCriteria(form: CriteriaForm): Record<string, unknown> {
  const extra = form.extra.trim();

  return {
    systemPrompt: form.ideal.trim(),
    ...(extra ? { userPrompt: extra } : {}),

    ...(form.exclusions.length
      ? { keywordLists: [{ list: form.exclusions, match: 'any' }] }
      : {}),

    age: { minimumAge: form.ageMin, maximumAge: form.ageMax },

    desiredMonthlyCompensation: {
      minimumMonthlyCompensation: form.compMin,
      maximumMonthlyCompensation: form.compMax,
    },

    requirePhoto: form.requirePhoto,

    // Always explicit: the backend defaults an omitted criterion to skipped,
    // so "Analisar" (false) must be sent, not left out.
    skipImageAnalysis: form.skipImageAnalysis,

    decisionPolicy: form.automatic
      ? {
          mode: 'automatic',
          minimumApprovalPercent: form.approveMin,
          minimumManualReviewPercent: form.manualMin,
        }
      : { mode: 'manual' },
  };
}
