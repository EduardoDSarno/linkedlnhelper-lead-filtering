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
