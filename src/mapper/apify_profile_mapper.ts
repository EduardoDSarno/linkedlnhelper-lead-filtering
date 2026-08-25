import { randomUUID } from 'node:crypto';

import type { RawApifyProfile } from '../data/apify_profile_collector/index.js';
import { asRecord, asString, deduplicateBy } from '../helpers/index.js';
import type {
  Profile,
  ProfileDate,
  ProfileEducation,
  ProfileExperience,
  ProfileLocation,
} from '../profile/index.js';

type UnknownRecord = Record<string, unknown>;

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/** Treats non-array provider values as an empty collection. */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Reads and trims one optional string field from a provider record. */
function recordString(
  record: UnknownRecord,
  key: string,
): string | undefined {
  return asString(record[key]);
}

/** Maps a positive numeric or four-digit text year without inventing precision. */
function mapYear(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  const text = asString(value);
  return text && /^\d{4}$/.test(text)
    ? Number.parseInt(text, 10)
    : undefined;
}

/** Maps a numeric or English provider month into the normalized month number. */
function mapMonth(value: unknown): number | undefined {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 12
  ) {
    return value;
  }

  const text = asString(value)?.toLowerCase();
  return text ? MONTHS[text] : undefined;
}

/** Preserves every usable component of one incomplete provider date. */
function mapDate(value: unknown): ProfileDate | undefined {
  const rawDate = asRecord(value);
  if (!rawDate) return undefined;

  const year = mapYear(rawDate['year']);
  const month = mapMonth(rawDate['month']);
  const text = recordString(rawDate, 'text');

  if (year === undefined && month === undefined && text === undefined) {
    return undefined;
  }

  return {
    ...(year !== undefined ? { year } : {}),
    ...(month !== undefined ? { month } : {}),
    ...(text !== undefined ? { text } : {}),
  };
}

/** Keeps the original location text alongside useful provider-parsed components. */
function mapLocation(value: unknown): ProfileLocation | undefined {
  const rawLocation = asRecord(value);
  if (!rawLocation) return undefined;

  const parsed = asRecord(rawLocation['parsed']);
  const text =
    recordString(rawLocation, 'linkedinText') ??
    (parsed ? recordString(parsed, 'text') : undefined);

  if (!text) return undefined;

  const city = parsed ? recordString(parsed, 'city') : undefined;
  const state = parsed ? recordString(parsed, 'state') : undefined;
  const country = parsed ? recordString(parsed, 'country') : undefined;
  const countryCode =
    recordString(rawLocation, 'countryCode') ??
    (parsed ? recordString(parsed, 'countryCode') : undefined);

  return {
    text,
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    ...(country ? { country } : {}),
    ...(countryCode ? { countryCode } : {}),
  };
}

/** Maps one employment record when its review-critical fields are present. */
function mapExperience(value: unknown): ProfileExperience | undefined {
  const rawExperience = asRecord(value);
  if (!rawExperience) return undefined;

  const position = recordString(rawExperience, 'position');
  const companyName = recordString(rawExperience, 'companyName');
  const location = recordString(rawExperience, 'location');

  // Entries missing either review-critical field cannot satisfy the normalized
  // experience contract, but remain available inside the raw payload.
  if (!position || !companyName) return undefined;

  const startDate = mapDate(rawExperience['startDate']);
  const endDate = mapDate(rawExperience['endDate']);

  return {
    position,
    companyName,
    ...(location ? { location } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
}

/**
 * Normalizes formatting that does not change the meaning of a job field.
 * Differences in actual content are deliberately preserved.
 *
 * Uses `toLowerCase` rather than `toLocaleLowerCase`: this builds a comparison
 * key, and a key must fold the same way on every machine. Under a Turkish
 * locale `toLocaleLowerCase` maps "I" to a dotless "ı", so "IBM" and "ibm"
 * would stop matching and duplicate jobs would survive there but not here.
 */
function normalizeExperienceIdentityText(
  value: string | undefined,
): string | null {
  return value?.trim().replace(/\s+/g, ' ').toLowerCase() ?? null;
}

/** Builds the date portion of an employment deduplication identity. */
function experienceDateIdentity(date: ProfileDate | undefined): {
  year: number | null;
  month: number | null;
  text: string | null;
} | null {
  return date
    ? {
        year: date.year ?? null,
        month: date.month ?? null,
        text: normalizeExperienceIdentityText(date.text),
      }
    : null;
}

/**
 * Builds an exact identity for one normalized employment entry.
 *
 * Two entries are duplicates only when title, company, location, and every
 * available start/end-date component match. Consequently, simultaneous current
 * roles with different locations, companies, titles, or dates remain separate.
 */
function experienceIdentity(experience: ProfileExperience): string {
  return JSON.stringify({
    position: normalizeExperienceIdentityText(experience.position),
    companyName: normalizeExperienceIdentityText(experience.companyName),
    location: normalizeExperienceIdentityText(experience.location),
    startDate: experienceDateIdentity(experience.startDate),
    endDate: experienceDateIdentity(experience.endDate),
  });
}

/** Maps one education record when a school identity is available. */
function mapEducation(value: unknown): ProfileEducation | undefined {
  const rawEducation = asRecord(value);
  if (!rawEducation) return undefined;

  const schoolName = recordString(rawEducation, 'schoolName');

  // A school is the minimum useful identity for a normalized education entry.
  if (!schoolName) return undefined;

  const degree = recordString(rawEducation, 'degree');
  const fieldOfStudy = recordString(rawEducation, 'fieldOfStudy');
  const startDate = mapDate(rawEducation['startDate']);
  const endDate = mapDate(rawEducation['endDate']);

  return {
    schoolName,
    ...(degree ? { degree } : {}),
    ...(fieldOfStudy ? { fieldOfStudy } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
}

/**
 * Converts one untouched Apify payload into the minimal application profile.
 *
 * Pass `existingProfileId` when the profile is already known. Omitting it is
 * reserved for a genuinely new profile and generates an application UUID.
 */
export function mapApifyProfile(
  raw: RawApifyProfile,
  existingProfileId?: string,
): Profile {
  const linkedinUrl = recordString(raw, 'linkedinUrl');

  if (!linkedinUrl) {
    throw new Error('Cannot normalize an Apify profile without linkedinUrl.');
  }

  const firstName = recordString(raw, 'firstName');
  const lastName = recordString(raw, 'lastName');
  const headline = recordString(raw, 'headline');
  const photo = recordString(raw, 'photo');
  const location = mapLocation(raw['location']);
  const openToWork =
    typeof raw['openToWork'] === 'boolean' ? raw['openToWork'] : undefined;

  const mappedExperience = asArray(raw['experience'])
    .map(mapExperience)
    .filter(
      (item): item is ProfileExperience => item !== undefined,
    );
  const { uniqueItems: experience } = deduplicateBy(
    mappedExperience,
    experienceIdentity,
  );
  const education = asArray(raw['education'])
    .map(mapEducation)
    .filter((item): item is ProfileEducation => item !== undefined);

  return {
    id: asString(existingProfileId) ?? randomUUID(),
    linkedinUrl,
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
    ...(headline ? { headline } : {}),
    ...(photo ? { photo } : {}),
    ...(openToWork !== undefined ? { openToWork } : {}),
    ...(location ? { location } : {}),
    experience,
    education,

    // Keep the exact object supplied by the collector. Do not clone, trim, or
    // remove provider-only fields from it.
    raw,
  };
}
