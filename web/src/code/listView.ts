/**
 * Pure helpers for the review list: effective status, filtering, sorting, and
 * the per-row view model the screen renders.
 *
 * Kept free of React so the same functions decide tab counts, keyboard targets,
 * and painted rows. Human overrides are a `{ publicId → decision }` map; the
 * model's own decision is used when a profile has no override.
 */

import type { Compensation, CompensationMatch, ManualDecision, ProfileResult } from './api';

/** Tabs on the review list, in display order. */
export const LIST_TAB = {
  all: 'Todos',
  approved: 'Aprovados',
  manual: 'Revisão manual',
  rejected: 'Reprovados',
  failed: 'Falhas',
} as const;

/** One tab label. */
export type ListTab = (typeof LIST_TAB)[keyof typeof LIST_TAB];

/** Tab labels in the order the design paints them. */
export const LIST_TABS: readonly ListTab[] = [
  LIST_TAB.all,
  LIST_TAB.approved,
  LIST_TAB.manual,
  LIST_TAB.rejected,
  LIST_TAB.failed,
];

/** Sort keys matching the <select> values in the design. */
export const LIST_SORT = {
  score: 'score',
  scoreAsc: 'scoreAsc',
  name: 'name',
  compensation: 'comp',
} as const;

/** One sort key. */
export type ListSort = (typeof LIST_SORT)[keyof typeof LIST_SORT];

/** Status a row can show after combining the model with a human override. */
export const REVIEW_STATUS = {
  approved: 'approved',
  manual: 'manual',
  rejected: 'rejected',
  failed: 'failed',
} as const;

/** One painted review status. */
export type ReviewStatus = (typeof REVIEW_STATUS)[keyof typeof REVIEW_STATUS];

/** Human decisions keyed by Linked Helper public id. */
export type OverrideMap = Record<string, ManualDecision>;

/** Score bands used to colour the match percent. */
export interface ScoreBands {
  approveMin: number;
  manualMin: number;
}

/** One warning chip under a row's subtitle. */
export interface PresentedWarning {
  key: string;
  icon: string;
  text: string;
  fg: string;
  bg: string;
  bd: string;
}

/** Everything {@link ProfileRow} needs to paint one profile. */
export interface PresentedRow {
  publicId: string;
  name: string;
  url: string;
  initials: string;
  avBg: string;
  avFg: string;
  seniority?: string;
  line2: string;
  warnings: PresentedWarning[];
  compensation: string;
  compensationMeta: string;
  age: string;
  score: string;
  scoreSub: string;
  scoreFg: string;
  statusText: string;
  statusIcon: string;
  statusFg: string;
  statusBg: string;
  statusBd: string;
  statusBy: string;
  override?: ManualDecision;
}

/** Chip colours by warning kind, matching the design. */
const WARN_TONE = {
  warn: { fg: '#92400e', bg: '#fffbeb', bd: '#fde68a' },
  info: { fg: '#1e40af', bg: '#eff6ff', bd: '#bfdbfe' },
  bad: { fg: '#9f1239', bg: '#fff1f2', bd: '#fecdd3' },
} as const;

/** Status badge look, matching the design. */
const STATUS_TONE = {
  approved: { text: 'Aprovado', icon: '✓', fg: '#047857', bg: '#ecfdf5', bd: '#a7f3d0' },
  manual: { text: 'Revisão manual', icon: '◐', fg: '#92400e', bg: '#fffbeb', bd: '#fde68a' },
  rejected: { text: 'Reprovado', icon: '×', fg: '#9f1239', bg: '#fff1f2', bd: '#fecdd3' },
  failed: { text: 'Falha no processamento', icon: '!', fg: '#475569', bg: '#f1f5f9', bd: '#e2e8f0' },
} as const;

/** Avatar background/foreground pairs, cycled by a stable hash of the id. */
const AVATAR_TONES: ReadonlyArray<readonly [string, string]> = [
  ['#e0edff', '#1d4ed8'],
  ['#eef2f7', '#475569'],
  ['#e8f5ee', '#047857'],
  ['#f4edfe', '#6d28d9'],
];

/** Minimum letters a name-part needs before it contributes an initial. */
const INITIAL_MIN_LETTERS = 3;

/** How many initials the avatar shows. */
const INITIAL_COUNT = 2;

/** Backend broad-filter value meaning the profile never reached the model. */
const BROAD_FAILED = 'Failed';

/** Maps a painted status onto the tab that lists it. */
const TAB_FOR_STATUS: Record<ReviewStatus, ListTab> = {
  approved: LIST_TAB.approved,
  manual: LIST_TAB.manual,
  rejected: LIST_TAB.rejected,
  failed: LIST_TAB.failed,
};

/** Portuguese labels for the model's compensation confidence. */
const CONFIDENCE_LABEL = {
  high: 'alta',
  medium: 'média',
  low: 'baixa',
} as const;

/** Job-title patterns used only to paint a seniority chip. */
const SENIORITY_MATCHERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Diretor/i, 'Diretor'],
  [/Head/i, 'Executivo'],
  [/Gerente/i, 'Gerente'],
  [/Coordenador/i, 'Coordenador'],
  [/Sênior|Senior|Especialista|Executivo/i, 'Analista sênior'],
  [/Assistente|Trainee/i, 'Assistente'],
];

/**
 * Builds the painted view of one profile: colours, labels, chips, and the
 * subtitle the design shows under the name.
 */
export function presentRow(
  profile: ProfileResult,
  override: ManualDecision | undefined,
  bands: ScoreBands,
): PresentedRow {
  const status = effectiveStatus(profile, override);
  const graded = isGraded(profile);
  const tone = STATUS_TONE[status];
  const [avBg, avFg] = avatarTone(profile.publicId);
  const compensation = presentCompensation(profile.compensation, profile.compensationMatch, graded);

  return {
    publicId: profile.publicId,
    name: profile.name || profile.publicId,
    url: profile.linkedinUrl || '#',
    initials: initialsOf(profile.name || profile.publicId),
    avBg,
    avFg,
    seniority: seniorityOf(profile.position),
    line2: subtitleOf(profile),
    warnings: warningsOf(profile),
    compensation: compensation.amount,
    compensationMeta: compensation.meta,
    age: graded ? formatAge(profile.apparentAge) : '—',
    score: graded && profile.matchPercent != null ? String(profile.matchPercent) : '—',
    scoreSub: graded ? 'de 100' : status === REVIEW_STATUS.failed ? 'sem nota' : 'não avaliado',
    scoreFg: graded ? scoreColor(profile.matchPercent ?? 0, bands) : '#94a3b8',
    statusText: tone.text,
    statusIcon: tone.icon,
    statusFg: tone.fg,
    statusBg: tone.bg,
    statusBd: tone.bd,
    statusBy: status === REVIEW_STATUS.failed ? '' : override ? 'por você' : 'pela IA',
    override,
  };
}

/**
 * Profiles that belong on the current tab, matching the search box, in the
 * requested sort order.
 */
export function visibleProfiles(
  profiles: ProfileResult[],
  overrides: OverrideMap,
  tab: ListTab,
  query: string,
  sort: ListSort,
): ProfileResult[] {
  const needle = query.trim().toLowerCase();
  const filtered = profiles.filter((profile) => {
    const status = effectiveStatus(profile, overrides[profile.publicId]);
    if (!matchesTab(tab, status)) return false;
    if (!needle) return true;
    return searchText(profile).includes(needle);
  });
  return sortProfiles(filtered, sort);
}

/** Counts every profile per tab, ignoring the search box (as the design does). */
export function tabCounts(profiles: ProfileResult[], overrides: OverrideMap): Record<ListTab, number> {
  const counts: Record<ListTab, number> = {
    [LIST_TAB.all]: profiles.length,
    [LIST_TAB.approved]: 0,
    [LIST_TAB.manual]: 0,
    [LIST_TAB.rejected]: 0,
    [LIST_TAB.failed]: 0,
  };

  for (const profile of profiles) {
    const status = effectiveStatus(profile, overrides[profile.publicId]);
    const tab = TAB_FOR_STATUS[status];
    counts[tab] += 1;
  }

  return counts;
}

/**
 * The status the list should show for a profile: a human override wins, then a
 * processing failure, then the deterministic filter, then the model.
 */
export function effectiveStatus(
  profile: ProfileResult,
  override: ManualDecision | undefined,
): ReviewStatus {
  if (override === 'approved') return REVIEW_STATUS.approved;
  if (override === 'rejected') return REVIEW_STATUS.rejected;
  if (isProcessingFailure(profile)) return REVIEW_STATUS.failed;
  if (profile.broadDecision === BROAD_FAILED) return REVIEW_STATUS.rejected;
  if (profile.modelDecision === 'approved') return REVIEW_STATUS.approved;
  if (profile.modelDecision === 'rejected') return REVIEW_STATUS.rejected;
  if (profile.modelDecision === 'manual_review') return REVIEW_STATUS.manual;
  return REVIEW_STATUS.failed;
}

/**
 * Next override after a keyboard or button action. Approve/reject toggle off
 * when pressed again; "manual" always clears the override so the IA decision
 * returns (the backend has no "force to manual" override).
 */
export function nextOverride(
  current: ManualDecision | undefined,
  action: 'approved' | 'rejected' | 'manual',
): ManualDecision | undefined {
  if (action === 'manual') return undefined;
  if (current === action) return undefined;
  return action;
}

/** Seeds the override map from decisions the backend already stored. */
export function overridesFromResults(results: ProfileResult[]): OverrideMap {
  const map: OverrideMap = {};
  for (const profile of results) {
    if (profile.override) map[profile.publicId] = profile.override.decision;
  }
  return map;
}

/** One-line run summary under the list title. */
export function runSummary(
  profileCount: number,
  criteriaLine: string,
  completedAt?: string,
): string {
  const when = completedAt ? `Execução de ${formatRunDate(completedAt)} · ` : '';
  return `${when}${profileCount} perfis · ${criteriaLine}`;
}

/** Whether the profile received a model score. */
function isGraded(profile: ProfileResult): boolean {
  return profile.modelDecision != null && profile.matchPercent != null;
}

/** Enrichment/model never produced a decision, and the broad filter did not exclude it. */
function isProcessingFailure(profile: ProfileResult): boolean {
  return profile.broadDecision !== BROAD_FAILED && profile.modelDecision == null;
}

/** Whether a status belongs on the given tab. */
function matchesTab(tab: ListTab, status: ReviewStatus): boolean {
  if (tab === LIST_TAB.all) return true;
  if (tab === LIST_TAB.approved) return status === REVIEW_STATUS.approved;
  if (tab === LIST_TAB.manual) return status === REVIEW_STATUS.manual;
  if (tab === LIST_TAB.rejected) return status === REVIEW_STATUS.rejected;
  return status === REVIEW_STATUS.failed;
}

/** Name/role/company/location haystack for the search box. */
function searchText(profile: ProfileResult): string {
  return [profile.name, profile.position, profile.company, profile.location, profile.headline]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** Returns a new array ordered by the selected sort key. */
function sortProfiles(profiles: ProfileResult[], sort: ListSort): ProfileResult[] {
  const copy = [...profiles];
  if (sort === LIST_SORT.score) copy.sort((a, b) => (b.matchPercent ?? -1) - (a.matchPercent ?? -1));
  else if (sort === LIST_SORT.scoreAsc) copy.sort((a, b) => (a.matchPercent ?? -1) - (b.matchPercent ?? -1));
  else if (sort === LIST_SORT.name) {
    copy.sort((a, b) => (a.name || a.publicId).localeCompare(b.name || b.publicId, 'pt-BR'));
  } else {
    copy.sort((a, b) => compensationSortValue(b) - compensationSortValue(a));
  }
  return copy;
}

/** Upper bound of an estimate, or zero when there isn't one — used only to sort. */
function compensationSortValue(profile: ProfileResult): number {
  const compensation = profile.compensation;
  if (!compensation || compensation.status !== 'estimated') return 0;
  return compensation.maximumMonthlyCompensation;
}

/** Subtitle: role · company · location — first model reason (or the filter message). */
function subtitleOf(profile: ProfileResult): string {
  const where = [profile.position, profile.company, profile.location].filter(Boolean).join(' · ');
  const reason = profile.reasons?.[0] ?? (isGraded(profile) ? undefined : profile.broadDecisionMessage);
  if (!where) return reason ?? '';
  return reason ? `${where} — ${reason}` : where;
}

/** Warning chips derived from photo, compensation fit, filter, and uncertainties. */
function warningsOf(profile: ProfileResult): PresentedWarning[] {
  const warnings: PresentedWarning[] = [];

  if (!profile.photo && !isProcessingFailure(profile) && profile.broadDecision !== BROAD_FAILED) {
    warnings.push(chip('photo', '◐', 'Sem foto de perfil', 'warn'));
  }

  if (profile.compensationMatch?.outcome === 'not_matched') {
    warnings.push(chip('comp', '$', compensationFitLabel(profile.compensationMatch), 'info'));
  }

  if (profile.broadDecision === BROAD_FAILED) {
    warnings.push(chip('filter', '×', `Excluído no filtro: ${profile.broadDecisionMessage}`, 'bad'));
  }

  if (isProcessingFailure(profile)) {
    warnings.push(chip('fail', '!', profile.broadDecisionMessage || 'Falha no processamento do perfil', 'bad'));
  }

  for (const [index, text] of (profile.uncertainties ?? []).entries()) {
    warnings.push(chip(`u-${index}`, '?', text, 'warn'));
  }

  return warnings;
}

/** One styled chip. */
function chip(
  key: string,
  icon: string,
  text: string,
  kind: keyof typeof WARN_TONE,
): PresentedWarning {
  return { key, icon, text, ...WARN_TONE[kind] };
}

/** Human label for a compensation mismatch. */
function compensationFitLabel(match: CompensationMatch): string {
  return match.explanation || 'Remuneração estimada fora da faixa';
}

/** Amount line plus the "est. · conf." meta line. */
function presentCompensation(
  compensation: Compensation | undefined,
  match: CompensationMatch | undefined,
  graded: boolean,
): { amount: string; meta: string } {
  if (!graded) return { amount: '—', meta: 'est. · conf. —' };
  if (!compensation || compensation.status !== 'estimated') {
    return { amount: '—', meta: 'est. · conf. —' };
  }

  const lo = Math.round(compensation.minimumMonthlyCompensation / 1000);
  const hi = Math.round(compensation.maximumMonthlyCompensation / 1000);
  const fit =
    match?.outcome === 'matched'
      ? '· na faixa'
      : match?.outcome === 'not_matched'
        ? '· fora da faixa'
        : '';

  return {
    amount: `R$ ${lo}–${hi} mil/mês`,
    meta: `est. · conf. ${CONFIDENCE_LABEL[compensation.confidence]} ${fit}`.trimEnd(),
  };
}

/** Paints the score green / amber / red using the campaign's decision bands. */
function scoreColor(score: number, bands: ScoreBands): string {
  if (score >= bands.approveMin) return '#047857';
  if (score >= bands.manualMin) return '#b45309';
  return '#be123c';
}

/**
 * Formats apparent age from either the mock's range string or the backend's
 * `{ bracket, confidence }` object.
 */
function formatAge(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') {
    return value.includes('anos') ? value : `${value} anos`;
  }
  if (typeof value === 'object' && 'bracket' in value) {
    const bracket = String((value as { bracket: string }).bracket);
    if (bracket === 'unknown') return '—';
    return `${bracket.replace('_', '–')} anos`;
  }
  return '—';
}

/** First letters of the longest name parts, as the design's avatar does. */
function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter((part) => part.length >= INITIAL_MIN_LETTERS)
    .slice(0, INITIAL_COUNT)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

/** Stable avatar colours so sorting a row does not change its chip. */
function avatarTone(publicId: string): readonly [string, string] {
  let hash = 0;
  for (const char of publicId) hash = (hash + char.charCodeAt(0)) % AVATAR_TONES.length;
  return AVATAR_TONES[hash]!;
}

/** Best-effort seniority chip from the current job title; omitted when unknown. */
function seniorityOf(position: string | undefined): string | undefined {
  if (!position) return undefined;
  for (const [pattern, label] of SENIORITY_MATCHERS) {
    if (pattern.test(position)) return label;
  }
  return undefined;
}

/** Short Portuguese date for the run summary line. */
function formatRunDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
}
