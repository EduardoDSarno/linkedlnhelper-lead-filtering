import { resolveBrazilRegion } from '../evaluation/filters/brazil_location.js';
import { asRecord, asString } from '../helpers/index.js';
import type { RawApifyProfile } from '../dataCollector/apify_profile_collector/index.js';

/** Treats a non-array provider value as an empty collection. */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Wraps a Bebity date string ("Sep 2021", "Present") into mapApifyProfile's `{ text }` shape. */
function adaptBebityDate(value: unknown): { text: string } | undefined {
  const text = asString(value);
  return text ? { text } : undefined;
}

/**
 * Parses Bebity's flat "City, State, Brasil" location text into the
 * structured shape `mapLocation` (in apify_profile_mapper.ts) already
 * expects, using the same Brazilian state/UF table the deterministic
 * location filter trusts (brazil_location.ts).
 *
 * Deliberately conservative: a segment that doesn't resolve to a known
 * Brazilian state is left unparsed rather than guessed at. The full text is
 * always kept under `linkedinText`/`parsed.text`, so nothing is lost — a
 * non-Brazilian or unusual location just doesn't get broken into city/state.
 */
function adaptBebityLocation(locationText: string): Record<string, unknown> {
  const segments = locationText
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const lastSegment = segments[segments.length - 1] ?? '';
  const hasCountrySegment = ['brasil', 'brazil'].includes(
    lastSegment.toLowerCase(),
  );
  const withoutCountry = hasCountrySegment ? segments.slice(0, -1) : segments;
  const stateCandidate = withoutCountry[withoutCountry.length - 1];
  const resolvedState = stateCandidate
    ? resolveBrazilRegion(stateCandidate)
    : undefined;

  if (!resolvedState) {
    return { linkedinText: locationText, parsed: { text: locationText } };
  }

  const city = withoutCountry.slice(0, -1).join(', ') || undefined;

  return {
    linkedinText: locationText,
    countryCode: 'BR',
    parsed: {
      text: locationText,
      ...(city ? { city } : {}),
      state: resolvedState.state,
      country: 'Brasil',
      countryCode: 'BR',
    },
  };
}

/**
 * Renames one Bebity experience entry's fields to Harvest's, so
 * `mapExperience` and `mapWorkDetailsFromRaw` (evaluation/mapper.ts) both
 * find the fields they already look for. `companyName`, `location`,
 * `employmentType`, and `description` use the same key on both providers, so
 * they pass through untouched.
 */
function adaptBebityExperienceEntry(
  value: unknown,
): Record<string, unknown> | undefined {
  const entry = asRecord(value);
  if (!entry) return undefined;

  const { title, startDate, endDate, ...rest } = entry;
  const adaptedStartDate = adaptBebityDate(startDate);
  const adaptedEndDate = adaptBebityDate(endDate);

  return {
    ...rest,
    ...(typeof title === 'string' ? { position: title } : {}),
    ...(adaptedStartDate ? { startDate: adaptedStartDate } : {}),
    ...(adaptedEndDate ? { endDate: adaptedEndDate } : {}),
  };
}

/** Renames one Bebity education entry's fields to Harvest's. */
function adaptBebityEducationEntry(
  value: unknown,
): Record<string, unknown> | undefined {
  const entry = asRecord(value);
  if (!entry) return undefined;

  const { degreeName, startDate, endDate, ...rest } = entry;
  const adaptedStartDate = adaptBebityDate(startDate);
  const adaptedEndDate = adaptBebityDate(endDate);

  return {
    ...rest,
    ...(typeof degreeName === 'string' ? { degree: degreeName } : {}),
    ...(adaptedStartDate ? { startDate: adaptedStartDate } : {}),
    ...(adaptedEndDate ? { endDate: adaptedEndDate } : {}),
  };
}

/**
 * Reshapes one Bebity raw profile record into the same shape HarvestAPI
 * already produces, so `mapApifyProfile` and `evaluation/mapper.ts` need no
 * changes to read it. `linkedinUrl`, `firstName`, `lastName`, and `headline`
 * already use the same key on both providers and pass through unchanged;
 * fields with no Harvest equivalent (e.g. `certifications`, `volunteer`,
 * `connectionsCount`) pass through too, so nothing Bebity provides is lost —
 * only the fields with a genuine Harvest counterpart are renamed or reshaped.
 */
export function adaptBebityRawProfile(raw: RawApifyProfile): RawApifyProfile {
  const { summary, profilePictureUrl, location, experience, education, ...rest } =
    raw;
  const about = asString(summary);
  const photo = asString(profilePictureUrl);
  const locationText = asString(location);

  return {
    ...rest,
    ...(about ? { about } : {}),
    ...(photo ? { photo } : {}),
    ...(locationText ? { location: adaptBebityLocation(locationText) } : {}),
    experience: asArray(experience)
      .map(adaptBebityExperienceEntry)
      .filter((entry): entry is Record<string, unknown> => entry !== undefined),
    education: asArray(education)
      .map(adaptBebityEducationEntry)
      .filter((entry): entry is Record<string, unknown> => entry !== undefined),
  };
}

