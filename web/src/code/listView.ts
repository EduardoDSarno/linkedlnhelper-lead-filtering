/**
 * Pure helpers for the review list: effective status, filtering, sorting, and
 * the per-row view model the screen renders.
 *
 * Kept free of React so the same functions decide tab counts, keyboard targets,
 * and painted rows. Human overrides are a `{ publicId → decision }` map; the
 * model's own decision is used when a profile has no override.
 */

import type {
  Compensation,
  ManualDecision,
  ProfileDate,
  ProfileEducation,
  ProfileExperience,
  ProfileResult,
} from './api';

/** Portuguese month abbreviations, indexed by month number minus one. */
const MONTH_LABELS = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez',
] as const;

/** Puts two partial dates on one axis so they can be compared directly. */
const MONTHS_IN_YEAR = 12;

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

/** One line inside a row's experience or education block. */
export interface PresentedEntry {
  key: string;
  /** "Gerente comercial · Nestlé", or "Bacharelado em Informática · UFC". */
  text: string;
  /** "mar 2024 – atual", or a single year for a course. */
  when: string;
  /** Set on the "no current role" placeholder, which paints amber. */
  alert?: boolean;
}

/** Everything {@link ProfileRow} needs to paint one profile. */
export interface PresentedRow {
  publicId: string;
  name: string;
  url: string;
  photo?: string;
  initials: string;
  avBg: string;
  avFg: string;
  /** The campaign's seniority rung, or the raw current title when none fits. */
  seniority?: string;
  location?: string;
  /** No role is currently open, so the row carries the "Desempregado" chip. */
  jobless: boolean;
  warnings: PresentedWarning[];
  /** Every role, oldest first; the first two show without interaction. */
  jobs: PresentedEntry[];
  /** Every course, oldest first, so the age-anchoring degree leads. */
  education: PresentedEntry[];
  /** "5 cargos · 11 anos", or a gap notice when nothing is current. */
  experienceTag: string;
  /** Paints {@link experienceTag} amber, for a gap rather than a plain count. */
  experienceTagWarn: boolean;
  educationTag: string;
  /** "13–22 mil", shown between a "R$" and a "/mês" the row supplies. */
  compensationAmount: string;
  compensationConfidence: string;
  /** "31–38", or an em dash when the model gave no range. */
  ageRange: string;
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

/** Chip colours by chip kind, matching the design. */
const WARN_TONE = {
  good: { fg: '#047857', bg: '#ecfdf5', bd: '#a7f3d0' },
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

/**
 * Longest raw job title the chip carries before it is cut short. Real titles
 * run to "Analista de Comunicação Pleno - PR | Nutriex e Rennova"; past this
 * the chip stops being a chip and starts crowding the name line.
 */
const LONGEST_TITLE_CHIP = 34;

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
  const compensation = presentCompensation(profile.compensation, graded);
  const experience = profile.details?.experience ?? [];
  const jobless = experience.length > 0 && !experience.some(isCurrentRole);

  return {
    publicId: profile.publicId,
    name: profile.name || profile.publicId,
    url: profile.linkedinUrl || '#',
    ...(profile.photo ? { photo: profile.photo } : {}),
    initials: initialsOf(profile.name || profile.publicId),
    avBg,
    avFg,
    seniority: seniorityOf(profile.position),
    ...(profile.location ? { location: profile.location } : {}),
    jobless,
    warnings: warningsOf(profile),
    jobs: presentJobs(experience, jobless),
    education: presentEducation(profile.details?.education ?? []),
    experienceTag: experienceTag(experience, jobless),
    experienceTagWarn: jobless,
    educationTag: countTag(profile.details?.education?.length ?? 0, 'curso'),
    compensationAmount: compensation.amount,
    compensationConfidence: compensation.confidence,
    ageRange: graded ? formatAgeRange(profile.estimatedAge) : '—',
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

/** Maximum chips shown on a row, combining critical flags and model points. */
const MAX_ROW_CHIPS = 3;

/**
 * Row chips: critical, non-model flags first (they explain a profile that
 * never scored), then the model's negatives, then its positives, capped so
 * the row stays compact. The full lists are shown in the expanded analysis.
 */
function warningsOf(profile: ProfileResult): PresentedWarning[] {
  const chips: PresentedWarning[] = [];

  if (profile.broadDecision === BROAD_FAILED) {
    chips.push(chip('filter', '×', `Excluído no filtro: ${profile.broadDecisionMessage}`, 'bad'));
  }

  if (isProcessingFailure(profile)) {
    chips.push(chip('fail', '!', profile.broadDecisionMessage || 'Falha no processamento do perfil', 'bad'));
  }

  for (const [index, negative] of (profile.negatives ?? []).entries()) {
    chips.push(chip(`neg-${index}`, '!', negative, 'warn'));
  }

  for (const [index, positive] of (profile.positives ?? []).entries()) {
    chips.push(chip(`pos-${index}`, '✓', positive, 'good'));
  }

  return chips.slice(0, MAX_ROW_CHIPS);
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

/**
 * The compensation range and its confidence, as two pieces.
 *
 * The row frames them itself ("R$ <amount>/mês conf. <confidence>") so it can
 * weight the number differently from the words around it.
 */
function presentCompensation(
  compensation: Compensation | undefined,
  graded: boolean,
): { amount: string; confidence: string } {
  if (!graded || !compensation || compensation.status !== 'estimated') {
    return { amount: '—', confidence: '—' };
  }

  const lo = Math.round(compensation.minimumMonthlyCompensation / 1000);
  const hi = Math.round(compensation.maximumMonthlyCompensation / 1000);
  return {
    amount: `${lo}–${hi} mil`,
    confidence: CONFIDENCE_LABEL[compensation.confidence],
  };
}

/** "5 cargos", "1 curso" — the count plus its noun, pluralized with an "s". */
function countTag(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/** "1 mês" / "7 meses" — the one plural in this file that is not a suffix. */
function monthsTag(count: number): string {
  return `${String(count)} ${count === 1 ? 'mês' : 'meses'}`;
}

/** Whether a role is still open: no end date, or the provider's "Present". */
function isCurrentRole(role: ProfileExperience): boolean {
  if (!role.endDate) return true;
  return role.endDate.text?.trim().toLowerCase() === 'present';
}

/** Earliest year across every listed role, used for the years-of-work count. */
function firstWorkingYear(experience: readonly ProfileExperience[]): number | undefined {
  const years = experience
    .map((role) => role.startDate?.year ?? role.endDate?.year)
    .filter((year): year is number => year !== undefined);
  return years.length > 0 ? Math.min(...years) : undefined;
}

/**
 * The block's summary pill: how many roles, and either how long the person has
 * been working or how long they have been out of work.
 *
 * The gap is the more decision-relevant of the two when it applies, since a
 * profile with no current role is the one case where the reviewer needs a
 * number before opening anything.
 */
function experienceTag(experience: readonly ProfileExperience[], jobless: boolean): string {
  const roles = countTag(experience.length, 'cargo');
  if (experience.length === 0) return roles;

  if (jobless) {
    const months = monthsSinceLastRole(experience);
    return months === undefined
      ? `${roles} · sem vínculo atual`
      : `${roles} · lacuna de ${monthsTag(months)}`;
  }

  const since = firstWorkingYear(experience);
  if (since === undefined) return roles;
  const years = new Date().getFullYear() - since;
  return years > 0 ? `${roles} · ${countTag(years, 'ano')}` : roles;
}

/** Whole months between the most recent role's end and today. */
function monthsSinceLastRole(experience: readonly ProfileExperience[]): number | undefined {
  const ends = experience
    .map((role) => role.endDate)
    .filter((date): date is ProfileDate => date?.year !== undefined);
  if (ends.length === 0) return undefined;

  const latest = ends.reduce((best, date) =>
    monthIndex(date) > monthIndex(best) ? date : best,
  );
  const now = new Date();
  const months = (now.getFullYear() - latest.year!) * MONTHS_IN_YEAR
    + (now.getMonth() + 1 - (latest.month ?? 1));
  return months > 0 ? months : undefined;
}

/** Months since year zero, so two partial dates can be compared directly. */
function monthIndex(date: ProfileDate): number {
  return (date.year ?? 0) * MONTHS_IN_YEAR + (date.month ?? 1);
}

/**
 * Roles as the block paints them, oldest first — the same direction as
 * education, so both blocks read as one timeline running the same way.
 *
 * Roles with no usable date sort last rather than being dropped, since an
 * undated role is still part of the history.
 */
function presentJobs(
  experience: readonly ProfileExperience[],
  jobless: boolean,
): PresentedEntry[] {
  const entries = [...experience]
    .map((role, index) => ({ role, index }))
    .sort((a, b) => (roleYear(a.role) ?? Infinity) - (roleYear(b.role) ?? Infinity))
    .map(({ role, index }) => ({
      key: `job-${String(index)}`,
      text: [role.position, role.companyName].filter(Boolean).join(' · '),
      when: formatPeriod(role.startDate, role.endDate),
    }));

  if (!jobless) return entries;

  // Pinned above the timeline rather than placed in it: this is a status, not
  // another role, and it answers "what is this person doing now" without the
  // reader having to reach the end of the list to find out.
  const months = monthsSinceLastRole(experience);
  return [
    {
      key: 'job-none',
      text: 'Sem vínculo atual',
      when: months === undefined ? '' : `há ${monthsTag(months)}`,
      alert: true,
    },
    ...entries,
  ];
}

/**
 * Courses as the block paints them, oldest first.
 *
 * Providers return education newest-first, which puts a later MBA in the two
 * always-visible lines and hides the original degree — the one entry that
 * anchors the age estimate. Sorting oldest-first keeps that anchor visible
 * without the reviewer opening anything.
 */
function presentEducation(education: readonly ProfileEducation[]): PresentedEntry[] {
  return [...education]
    .map((course, index) => ({ course, index }))
    .sort((a, b) => (courseYear(a.course) ?? Infinity) - (courseYear(b.course) ?? Infinity))
    .map(({ course, index }) => ({
      key: `edu-${String(index)}`,
      text: [
        [course.degree, course.fieldOfStudy].filter(Boolean).join(' em '),
        course.schoolName,
      ]
        .filter(Boolean)
        .join(' · '),
      when: courseYear(course) === undefined ? '' : String(courseYear(course)),
    }));
}

/** The year a course is filed under: when it started, else when it ended. */
function courseYear(course: ProfileEducation): number | undefined {
  return course.startDate?.year ?? course.endDate?.year;
}

/** The year a role is filed under, on the same rule as {@link courseYear}. */
function roleYear(role: ProfileExperience): number | undefined {
  return role.startDate?.year ?? role.endDate?.year;
}

/** Formats a start/end pair without pretending missing dates are known. */
function formatPeriod(start: ProfileDate | undefined, end: ProfileDate | undefined): string {
  const from = formatDate(start);
  const to = end === undefined || isPresentDate(end) ? 'atual' : formatDate(end);
  if (from && to) return `${from} – ${to}`;
  return from || to || '';
}

/** Formats one partial LinkedIn date in pt-BR. */
function formatDate(date: ProfileDate | undefined): string {
  if (!date) return '';
  if (date.month && date.year) {
    return `${MONTH_LABELS[date.month - 1] ?? ''} ${String(date.year)}`.trim();
  }
  if (date.year) return String(date.year);
  return date.text ?? '';
}

/** Recognizes the provider's current-role marker. */
function isPresentDate(date: ProfileDate): boolean {
  return date.text?.trim().toLowerCase() === 'present';
}

/** Paints the score green / amber / red using the campaign's decision bands. */
function scoreColor(score: number, bands: ScoreBands): string {
  if (score >= bands.approveMin) return '#047857';
  if (score >= bands.manualMin) return '#b45309';
  return '#be123c';
}

/**
 * The estimated age as a bare range, with no unit — the row supplies the
 * "anos" and the "est." qualifier around it so it can weight them separately.
 *
 * Accepts the mock's plain string as well as the model's `{ minimumAge,
 * maximumAge }` object, and strips a unit the mock may already carry.
 */
function formatAgeRange(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value.replace(/\s*anos\s*/i, '').trim() || '—';
  if (typeof value === 'object' && 'minimumAge' in value && 'maximumAge' in value) {
    const { minimumAge, maximumAge } = value as { minimumAge: number; maximumAge: number };
    return `${String(minimumAge)}–${String(maximumAge)}`;
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

/**
 * The chip beside the name: the campaign's seniority rung when the current
 * title maps onto one, otherwise the title itself.
 *
 * Falling back to the raw title matters more than it looks. Against real
 * profiles the ladder only matches about half of them — "Corretor
 * imobiliário", "Sócio-fundador" and "Comunicóloga" are real current titles
 * with no rung — and since the row lists experience oldest first, the current
 * role is not otherwise visible without hovering. An unmatched title left the
 * row with nothing at all to say what the person does now.
 */
function seniorityOf(position: string | undefined): string | undefined {
  const title = position?.trim();
  if (!title) return undefined;
  for (const [pattern, label] of SENIORITY_MATCHERS) {
    if (pattern.test(title)) return label;
  }
  return title.length > LONGEST_TITLE_CHIP
    ? `${title.slice(0, LONGEST_TITLE_CHIP).trimEnd()}…`
    : title;
}

/** Short Portuguese date for the run summary line. */
function formatRunDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
}
