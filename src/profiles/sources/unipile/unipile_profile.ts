import { asRecord, asString } from '../../../shared/helpers/index.js';
import type {
  ProfileDate,
  ProfileEducation,
  ProfileExperience,
} from '../../apify_profile.js';
import type { FullProfile } from '../../full_profile.js';

/** Where a profile URL is built from a public identifier when Unipile gives none. */
const LINKEDIN_PROFILE_BASE_URL = 'https://www.linkedin.com/in/';

/**
 * Turn a stored Unipile `UserProfile` into the profile model evaluation reads.
 *
 * `id` is the LinkedIn member id, so the model's per-profile answers map
 * straight back to leads. `raw` is rebuilt with the field names the
 * evaluation mapper already reads (`about`, `experience[].companyName`), so
 * the evaluation code needs no Unipile-specific branch.
 */
export function mapUnipileProfile(
  linkedinMemberId: string,
  data: Record<string, unknown>,
): FullProfile {
  const firstName = asString(data['first_name']);
  const lastName = asString(data['last_name']);
  const headline = asString(data['headline']);
  const location = asString(data['location']);
  const photo = asString(data['profile_picture_url_large']) ?? asString(data['profile_picture_url']);
  const openToWork = data['is_open_to_work'];
  const workExperience = records(data['work_experience']);

  return {
    id: linkedinMemberId,
    linkedinUrl: profileUrl(data, linkedinMemberId),
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
    ...(headline ? { headline } : {}),
    ...(photo ? { photo, photoSource: 'provider' as const } : {}),
    ...(typeof openToWork === 'boolean' ? { openToWork } : {}),
    ...(location ? { location: { text: location } } : {}),
    experience: workExperience.flatMap(experience),
    education: records(data['education']).flatMap(education),
    raw: {
      about: asString(data['summary']),
      experience: workExperience.map((item) => ({
        position: asString(item['position']),
        companyName: asString(item['company']),
        description: asString(item['description']),
      })),
    },
  };
}

/**
 * Read a Unipile date such as `3/2021`, `2021-03-01T…` or `2021`.
 *
 * Unipile's documentation does not pin the format down, so every shape seen
 * is accepted and anything else is kept as text rather than guessed at.
 */
export function unipileDate(value: unknown): ProfileDate | undefined {
  const text = asString(value)?.trim();
  if (!text) return undefined;

  const monthYear = /^(\d{1,2})\/(\d{4})$/.exec(text);
  if (monthYear) return { month: Number(monthYear[1]), year: Number(monthYear[2]) };

  const iso = /^(\d{4})-(\d{2})/.exec(text);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]) };

  const year = /^(\d{4})$/.exec(text);
  if (year) return { year: Number(year[1]) };

  return { text };
}

/** One job, or nothing when it lacks a position or company. */
function experience(item: Record<string, unknown>): ProfileExperience[] {
  const position = asString(item['position']);
  const companyName = asString(item['company']);
  if (!position || !companyName) return [];

  const location = asString(item['location']);
  const startDate = unipileDate(item['start']);
  // A current job has no end; the evaluation reads "Present" as still open.
  const endDate = item['current'] === true ? { text: 'Present' } : unipileDate(item['end']);

  return [
    {
      position,
      companyName,
      ...(location ? { location } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    },
  ];
}

/** One school, or nothing when it lacks a name. */
function education(item: Record<string, unknown>): ProfileEducation[] {
  const schoolName = asString(item['school']);
  if (!schoolName) return [];

  const degree = asString(item['degree']);
  const fieldOfStudy = asString(item['field_of_study']);
  const startDate = unipileDate(item['start']);
  const endDate = unipileDate(item['end']);

  return [
    {
      schoolName,
      ...(degree ? { degree } : {}),
      ...(fieldOfStudy ? { fieldOfStudy } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    },
  ];
}

/** The profile's public URL, built from its identifier when Unipile gives none. */
function profileUrl(data: Record<string, unknown>, linkedinMemberId: string): string {
  return (
    asString(data['public_profile_url']) ??
    `${LINKEDIN_PROFILE_BASE_URL}${asString(data['public_identifier']) ?? linkedinMemberId}`
  );
}

/** The object entries of a value that should be a list, ignoring anything else. */
function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}
