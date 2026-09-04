/**
 * The evaluation-criteria form and its translation to the backend contract.
 *
 * `CriteriaForm` is what the modal edits; `toEvaluationCriteria` converts it into
 * the `FullEvaluationCriteria` the `/run_filter` endpoint validates. Fields the
 * user leaves empty are omitted rather than sent blank, because the backend
 * reads an omitted criterion as "do not filter on this" and rejects an empty one.
 */

import { BRAZIL_REGIONS, BRAZIL_STATES } from '../data/regions';

/** Whether the location list keeps only its places or removes them. */
export const LOCATION_MODE = {
  /** Keep only profiles in the listed places. */
  include: 'include',

  /** Keep everywhere except the listed states/regions. */
  exclude: 'exclude',
} as const;

/** A single location-mode value. */
export type LocationMode = (typeof LOCATION_MODE)[keyof typeof LOCATION_MODE];

/** How the open-to-work badge filters the first pass. */
export const OPEN_TO_WORK = {
  /** The badge is ignored. */
  ignore: 'ignore',

  /** Keep only profiles marked open to work. */
  only: 'only',

  /** Keep only profiles not marked open to work. */
  exclude: 'exclude',
} as const;

/** A single open-to-work choice. */
export type OpenToWork = (typeof OPEN_TO_WORK)[keyof typeof OPEN_TO_WORK];

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
 * Evaluation requests allowed in flight. Kept in lockstep with the backend
 * evaluation defaults so the time estimate uses the same wave size.
 */
export const EVALUATION_CONCURRENCY = 10;

/** Measured wall time of one parallel evaluation wave at default thinking. */
export const DEFAULT_THINKING_WAVE_SECONDS = 25;

/** Measured wall time of one parallel evaluation wave at max thinking. */
export const MAX_THINKING_WAVE_SECONDS = 80;

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

  /** Places to keep, used when the mode is include: cities, states, or regions. */
  includeLocations: string[];

  /** States or regions to remove, used when the mode is exclude. */
  excludeLocations: string[];

  /** Which of the two location lists is active. */
  locationMode: LocationMode;

  /** Words that exclude a profile when present in its current role. */
  exclusions: string[];

  ageMin: number;
  ageMax: number;
  compMin: number;
  compMax: number;

  /** When true, profiles without a photo are excluded before the model. */
  requirePhoto: boolean;

  openToWork: OpenToWork;

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
  includeLocations: ['São Paulo, SP', 'Minas Gerais', 'Paraná', 'Santa Catarina'],
  excludeLocations: [],
  locationMode: LOCATION_MODE.include,
  exclusions: ['estagiário', 'intern', 'trainee', 'graduando', 'aluno'],
  ageMin: 25,
  ageMax: 40,
  compMin: 10000,
  compMax: 30000,
  requirePhoto: false,
  openToWork: OPEN_TO_WORK.ignore,
  automatic: true,
  approveMin: 75,
  manualMin: 50,
  thinkingMode: THINKING_MODE.default,
};

/** Formats one amount as Brazilian currency. */
export function brl(value: number): string {
  return `R$ ${value.toLocaleString('pt-BR')}`;
}

/** Expands a selection to its state names when it is a region, else keeps it. */
function expandSelection(selection: string): string[] {
  return BRAZIL_REGIONS[selection] ?? [selection];
}

/**
 * Turns the user's location choices into the backend's include-list.
 *
 * Regions expand to their states. In exclude mode the result is every state
 * except the chosen ones, because the backend only understands an allow-list;
 * excluding therefore means "include all other states".
 */
export function resolveLocations(form: CriteriaForm): string[] {
  if (form.locationMode === LOCATION_MODE.include) {
    return [...new Set(form.includeLocations.flatMap(expandSelection))];
  }

  const removed = new Set(form.excludeLocations.flatMap(expandSelection));
  return BRAZIL_STATES.filter((state) => !removed.has(state));
}

/** Builds the one-line summary shown on the upload screen and modal footer. */
export function criteriaSummary(form: CriteriaForm): string {
  const exclude = form.locationMode === LOCATION_MODE.exclude;
  const active = exclude ? form.excludeLocations : form.includeLocations;
  const chosen = active.length ? active.join(', ') : 'qualquer localização';
  const locations = exclude && active.length ? `exceto ${chosen}` : chosen;

  return [
    `${form.ageMin}–${form.ageMax} anos (est.)`,
    `${brl(form.compMin)}–${brl(form.compMax)}/mês`,
    locations,
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
 * Max thinking names itself in the sentence so the slower path is obvious.
 */
export function evaluationTimeEstimateMessage(
  profileCount: number,
  mode: ThinkingMode,
): string {
  const duration = formatDurationEstimate(
    estimateEvaluationSeconds(profileCount, mode),
  );
  const profiles = profileCount === 1 ? '1 perfil' : `${profileCount} perfis`;
  if (mode === THINKING_MODE.max) {
    return `Com raciocínio máximo, a pontuação com IA deve levar ${duration} para ${profiles}.`;
  }
  return `A pontuação com IA deve levar ${duration} para ${profiles}.`;
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
  const locations = resolveLocations(form);

  return {
    systemPrompt: form.ideal.trim(),
    ...(extra ? { userPrompt: extra } : {}),

    ...(locations.length
      ? {
          location: {
            locations,
            fields: ['text'],
            match: 'any',
          },
        }
      : {}),

    ...(form.exclusions.length
      ? { keywordLists: [{ list: form.exclusions, match: 'any' }] }
      : {}),

    age: { minimumAge: form.ageMin, maximumAge: form.ageMax },

    desiredMonthlyCompensation: {
      minimumMonthlyCompensation: form.compMin,
      maximumMonthlyCompensation: form.compMax,
    },

    requirePhoto: form.requirePhoto,

    ...(form.openToWork === OPEN_TO_WORK.only
      ? { openToWork: true }
      : form.openToWork === OPEN_TO_WORK.exclude
        ? { openToWork: false }
        : {}),

    decisionPolicy: form.automatic
      ? {
          mode: 'automatic',
          minimumApprovalPercent: form.approveMin,
          minimumManualReviewPercent: form.manualMin,
        }
      : { mode: 'manual' },
  };
}
