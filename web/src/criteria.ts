/**
 * The evaluation-criteria form and its translation to the backend contract.
 *
 * `CriteriaForm` is what the modal edits; `toEvaluationCriteria` converts it into
 * the `FullEvaluationCriteria` the `/run_filter` endpoint validates. Fields the
 * user leaves empty are omitted rather than sent blank, because the backend
 * reads an omitted criterion as "do not filter on this" and rejects an empty one.
 */

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

/** Editable state of the criteria form. */
export interface CriteriaForm {
  /** The ideal profile; becomes the model's system prompt. */
  ideal: string;

  /** Optional extra guidance sent as the user prompt. */
  extra: string;

  locations: string[];

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
}

/** The criteria the campaign starts from, matching the designed defaults. */
export const DEFAULT_CRITERIA: CriteriaForm = {
  ideal:
    'Gestores comerciais e de Customer Success em SaaS B2B ou serviços financeiros, com carreira consultiva e progressão de analista a gestão.',
  extra: '',
  locations: ['São Paulo, SP', 'Minas Gerais', 'Paraná', 'Santa Catarina'],
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
};

/** Formats one amount as Brazilian currency. */
export function brl(value: number): string {
  return `R$ ${value.toLocaleString('pt-BR')}`;
}

/** Builds the one-line summary shown on the upload screen and modal footer. */
export function criteriaSummary(form: CriteriaForm): string {
  const locations = form.locations.length
    ? form.locations.join(', ')
    : 'qualquer localização';

  return [
    `${form.ageMin}–${form.ageMax} anos (est.)`,
    `${brl(form.compMin)}–${brl(form.compMax)}/mês`,
    locations,
    `${form.exclusions.length} exclusões no cargo atual`,
  ].join(' · ');
}

/** Reports whether the form can produce valid criteria. */
export function isCriteriaComplete(form: CriteriaForm): boolean {
  return form.ideal.trim().length > 0;
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

    ...(form.locations.length
      ? {
          location: {
            locations: form.locations,
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
