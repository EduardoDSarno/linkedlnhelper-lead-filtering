import type { ProfileEducation, ProfileExperience } from '../profile/index.js';

/**
 * Education that says nothing about someone's age as a graduate.
 *
 * Secondary and technical courses are often taken at school age, or much
 * later alongside work, so their dates are not an anchor for the age a
 * campaign cares about. Matched against the degree, field, and school name
 * together because providers put this label in whichever field they like.
 */
const NON_HIGHER_EDUCATION = /ensino m[eé]dio|ensino fundamental|t[eé]cnic|col[eé]gio|high school|secondary school/i;

/** The academic and professional anchors used to reason about someone's age. */
export interface CareerTimeline {
  /**
   * Earliest year of a higher-education course, ignoring secondary and
   * technical study. The strongest age anchor a profile carries: someone who
   * began a degree in 1999 is very unlikely to be under 40 today.
   */
  readonly firstAcademicYear?: number;
  /** Earliest year of any listed role. */
  readonly firstProfessionalYear?: number;
  /** Whole years between the first listed role and now. */
  readonly yearsOfExperience?: number;
  /**
   * Whether any listed role is still open — no end date, or one reading
   * "Present". Absent when the profile lists no roles at all, which is not the
   * same as being out of work.
   */
  readonly isCurrentlyEmployed?: boolean;
  /**
   * Whole months between the most recently ended role and now, present only
   * when no role is open and at least one carries a dated end.
   */
  readonly monthsSinceLastRole?: number;
  /** The higher-education entries behind `firstAcademicYear`, oldest first. */
  readonly academicEntries: readonly CareerTimelineEducation[];
}

/** One higher-education entry, reduced to what the age question needs. */
export interface CareerTimelineEducation {
  readonly schoolName: string;
  readonly degree?: string;
  readonly startYear?: number;
  readonly endYear?: number;
}

/** Reads a usable four-digit year from either end of a provider date pair. */
function yearOf(
  entry: { startDate?: { year?: number }; endDate?: { year?: number } },
): number | undefined {
  return entry.startDate?.year ?? entry.endDate?.year;
}

/** Reports whether an education entry is secondary or technical study. */
function isHigherEducation(education: ProfileEducation): boolean {
  const label = [education.degree, education.fieldOfStudy, education.schoolName]
    .filter(Boolean)
    .join(' ');
  return !NON_HIGHER_EDUCATION.test(label);
}

/** Returns the smallest year in a list, or undefined when the list is empty. */
function earliestYear(years: readonly number[]): number | undefined {
  return years.length > 0 ? Math.min(...years) : undefined;
}

/** Puts two partial dates on one axis so they can be compared directly. */
const MONTHS_IN_YEAR = 12;

/** Whether a role is still open: no end date, or the provider's "Present". */
function isCurrentRole(role: ProfileExperience): boolean {
  if (!role.endDate) return true;
  return role.endDate.text?.trim().toLowerCase() === 'present';
}

/** Months since year zero, so two partial dates compare on one axis. */
function monthIndex(date: { year: number; month?: number }): number {
  return date.year * MONTHS_IN_YEAR + (date.month ?? 1);
}

/**
 * Whole months between the most recently ended role and now.
 *
 * Undefined when no ended role carries a year, since an undated end says
 * nothing about how long ago it was. Negative gaps become zero: LinkedIn lets
 * a role be post-dated, and "ends next month" is not time out of work.
 */
function monthsSinceLastRole(
  experience: readonly ProfileExperience[],
  now: Date,
): number | undefined {
  const endings = experience
    .map((role) => role.endDate)
    .filter((date): date is { year: number; month?: number } => date?.year !== undefined);
  if (endings.length === 0) return undefined;

  const latest = Math.max(...endings.map(monthIndex));
  const today = now.getFullYear() * MONTHS_IN_YEAR + (now.getMonth() + 1);
  return Math.max(0, today - latest);
}

/**
 * Derives the dated anchors a model would otherwise have to dig out itself.
 *
 * The provider returns education newest-first and mixes MBAs, pós-graduação,
 * and secondary school into one array, so the original degree — the entry that
 * actually indicates age — is rarely the first element. Finding a minimum and
 * recognizing "Ensino Médio" is work code does reliably and a model does
 * inconsistently while also scoring three profiles at once. Extracting the
 * facts here leaves the model the judgement: whether a 1999 start means a
 * 45-year-old or someone who began studying late.
 *
 * Nothing here excludes a profile. Absent dates simply produce absent fields.
 */
export function buildCareerTimeline(
  experience: readonly ProfileExperience[],
  education: readonly ProfileEducation[],
  now: Date = new Date(),
): CareerTimeline {
  const higherEducation = education.filter(isHigherEducation);
  const academicEntries = higherEducation
    .map((entry) => ({
      schoolName: entry.schoolName,
      ...(entry.degree ? { degree: entry.degree } : {}),
      ...(entry.startDate?.year ? { startYear: entry.startDate.year } : {}),
      ...(entry.endDate?.year ? { endYear: entry.endDate.year } : {}),
    }))
    .sort((a, b) => (a.startYear ?? a.endYear ?? 0) - (b.startYear ?? b.endYear ?? 0));

  const firstAcademicYear = earliestYear(
    higherEducation
      .map(yearOf)
      .filter((year): year is number => year !== undefined),
  );
  const firstProfessionalYear = earliestYear(
    experience
      .map((role) => role.startDate?.year)
      .filter((year): year is number => year !== undefined),
  );

  // Employment status is reported, never judged: whether a gap disqualifies
  // anyone is the campaign's call, so this states the fact and its size and
  // stops there.
  const employed = experience.length > 0 ? experience.some(isCurrentRole) : undefined;
  const gapMonths = employed === false ? monthsSinceLastRole(experience, now) : undefined;

  return {
    ...(firstAcademicYear !== undefined ? { firstAcademicYear } : {}),
    ...(firstProfessionalYear !== undefined ? { firstProfessionalYear } : {}),
    ...(firstProfessionalYear !== undefined
      ? { yearsOfExperience: Math.max(0, now.getFullYear() - firstProfessionalYear) }
      : {}),
    ...(employed !== undefined ? { isCurrentlyEmployed: employed } : {}),
    ...(gapMonths !== undefined ? { monthsSinceLastRole: gapMonths } : {}),
    academicEntries,
  };
}
