import { randomUUID } from 'node:crypto';

import type {
  FullProfile,
  ImportedCsvProfile,
  ProfileDate,
  ProfileEducation,
  ProfileExperience,
} from '../profile/index.js';
import type { RawLinkedHelperCsvRow } from '../profile/imported_csv_profile.js';
import { parseBrazilLocation } from './brazil_location.js';

/**
 * Column prefixes of Linked Helper's numbered career columns.
 *
 * Each job or school occupies one numbered group (`organization_1`,
 * `organization_title_1`, ...). The export has a fixed number of groups,
 * which the mapper discovers from the header instead of assuming.
 */
const COLUMN = {
  company: 'organization_',
  position: 'organization_title_',
  start: 'organization_start_',
  end: 'organization_end_',
  location: 'organization_location_',
  description: 'position_description_',
  school: 'education_',
  degree: 'education_degree_',
  fieldOfStudy: 'education_fos_',
  educationStart: 'education_start_',
  educationEnd: 'education_end_',
} as const;

/** Separator Linked Helper places between a value and the label appended to it. */
const LABEL_SEPARATOR = ' · ';

/**
 * Longest text accepted as an employment-type label.
 *
 * Linked Helper puts "<position><company> · <type>" in the description column
 * of a role whose real description is empty. Labels such as "Tempo integral"
 * are short; anything longer is a real description that happens to start the
 * same way, and is kept whole.
 */
const MAX_EMPLOYMENT_TYPE_LENGTH = 40;

/** Matches the "2024.05" and "2024" date forms the export uses. */
const EXPORT_DATE_PATTERN = /^(\d{4})(?:\.(\d{1,2}))?$/;

/**
 * Builds the application profile for one Linked Helper CSV row.
 *
 * This replaces collecting the profile from a scraper: the "Perfis baixados"
 * export already carries the career history, education, About text and photo
 * the evaluation needs. The importer's typed summary supplies identity and
 * presentation; the numbered career columns come from the untouched row.
 */
export function mapLinkedHelperCsvProfile(
  imported: ImportedCsvProfile,
  createId: () => string = randomUUID,
): FullProfile {
  const { summary, raw } = imported;
  const about = cell(raw, 'summary');

  return {
    id: createId(),
    linkedinUrl: summary.profileUrl,
    linkedHelperPublicId: summary.publicId,
    ...(summary.firstName ? { firstName: summary.firstName } : {}),
    ...(summary.lastName ? { lastName: summary.lastName } : {}),
    ...(summary.headline ? { headline: summary.headline } : {}),
    ...(about ? { about } : {}),
    ...(summary.avatarUrl ? { photo: summary.avatarUrl } : {}),
    openToWork: summary.openToWork,
    ...(summary.location ? { location: parseBrazilLocation(summary.location) } : {}),
    experience: mapExperience(raw),
    education: mapEducation(raw),
    raw,
  };
}

/**
 * Reports whether a CSV carries the career columns the evaluation needs.
 *
 * Linked Helper also has a lighter export with only names and headlines.
 * Evaluating that would score every profile on almost nothing, so the upload
 * is refused instead of producing confident results from empty profiles.
 */
export function hasCareerColumns(row: RawLinkedHelperCsvRow): boolean {
  return `${COLUMN.position}1` in row && `${COLUMN.school}1` in row;
}

/** Reads every filled job group, in the export's newest-first order. */
function mapExperience(row: RawLinkedHelperCsvRow): ProfileExperience[] {
  const experience: ProfileExperience[] = [];

  for (const n of groupNumbers(row, COLUMN.position)) {
    const position = cell(row, `${COLUMN.position}${n}`);
    const companyName = cell(row, `${COLUMN.company}${n}`);
    if (!position || !companyName) continue;

    const startDate = exportDate(cell(row, `${COLUMN.start}${n}`));
    const endDate = exportDate(cell(row, `${COLUMN.end}${n}`));

    experience.push({
      position,
      companyName,
      ...splitJobLocation(cell(row, `${COLUMN.location}${n}`)),
      ...splitPositionDescription(
        cell(row, `${COLUMN.description}${n}`),
        position,
        companyName,
      ),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    });
  }

  return experience;
}

/** Reads every filled education group, in the export's display order. */
function mapEducation(row: RawLinkedHelperCsvRow): ProfileEducation[] {
  const education: ProfileEducation[] = [];

  for (const n of groupNumbers(row, COLUMN.degree)) {
    const schoolName = cell(row, `${COLUMN.school}${n}`);
    if (!schoolName) continue;

    const degree = cell(row, `${COLUMN.degree}${n}`);
    const fieldOfStudy = cell(row, `${COLUMN.fieldOfStudy}${n}`);
    const startDate = exportDate(cell(row, `${COLUMN.educationStart}${n}`));
    const endDate = exportDate(cell(row, `${COLUMN.educationEnd}${n}`));

    education.push({
      schoolName,
      ...(degree ? { degree } : {}),
      ...(fieldOfStudy ? { fieldOfStudy } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    });
  }

  return education;
}

/**
 * Separates a job location from the workplace label appended to it.
 *
 * "São Gabriel do Oeste, Mato Grosso do Sul, Brasil · No local" is a place
 * and an on-site/remote label joined by the export.
 */
function splitJobLocation(
  text: string | undefined,
): Pick<ProfileExperience, 'location' | 'workplaceType'> {
  if (!text) return {};

  const [location, ...labels] = text.split(LABEL_SEPARATOR).map((part) => part.trim());
  const workplaceType = labels.join(LABEL_SEPARATOR);

  return {
    ...(location ? { location } : {}),
    ...(workplaceType ? { workplaceType } : {}),
  };
}

/**
 * Separates a real role description from the subtitle the export substitutes.
 *
 * When a role has no description, Linked Helper writes the position, company
 * and employment type run together ("Diretor executivoSolTerra Cereais Ltda.
 * · Tempo integral"). That is recovered as an employment type rather than
 * passed to the model as if the person had written it.
 */
function splitPositionDescription(
  text: string | undefined,
  position: string,
  companyName: string,
): Pick<ProfileExperience, 'description' | 'employmentType'> {
  if (!text) return {};

  const subtitle = `${position}${companyName}`;
  if (!text.startsWith(subtitle)) return { description: text };

  const employmentType = text
    .slice(subtitle.length)
    .replace(LABEL_SEPARATOR.trimEnd(), '')
    .trim();
  if (employmentType.length > MAX_EMPLOYMENT_TYPE_LENGTH) return { description: text };

  return employmentType ? { employmentType } : {};
}

/** Parses the export's "YYYY.MM" or "YYYY" date, keeping the original text. */
function exportDate(text: string | undefined): ProfileDate | undefined {
  const match = text ? EXPORT_DATE_PATTERN.exec(text) : null;
  if (!text || !match) return undefined;

  const month = match[2] ? Number(match[2]) : undefined;
  return { year: Number(match[1]), ...(month ? { month } : {}), text };
}

/**
 * Lists the group numbers present in the header for one numbered column.
 *
 * Read from the row's keys so a change in how many jobs or schools Linked
 * Helper exports needs no code change.
 */
function groupNumbers(row: RawLinkedHelperCsvRow, prefix: string): number[] {
  const numbers: number[] = [];
  for (let n = 1; `${prefix}${n}` in row; n += 1) numbers.push(n);
  return numbers;
}

/** Reads one trimmed cell, treating blank text as absent. */
function cell(row: RawLinkedHelperCsvRow, column: string): string | undefined {
  return row[column]?.trim() || undefined;
}
