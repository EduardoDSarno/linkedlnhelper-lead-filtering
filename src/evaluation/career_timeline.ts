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

  return {
    ...(firstAcademicYear !== undefined ? { firstAcademicYear } : {}),
    ...(firstProfessionalYear !== undefined ? { firstProfessionalYear } : {}),
    ...(firstProfessionalYear !== undefined
      ? { yearsOfExperience: Math.max(0, now.getFullYear() - firstProfessionalYear) }
      : {}),
    academicEntries,
  };
}
