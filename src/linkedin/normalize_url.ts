const LINKEDIN_ROOT_HOST = 'linkedin.com';
const LINKEDIN_PROFILE_PATH = 'in';
const CANONICAL_LINKEDIN_ORIGIN = 'https://www.linkedin.com';

/**
 * Decodes URL escapes and normalizes equivalent Unicode representations.
 * Invalid provider escapes fall back to their original text so comparison
 * remains deterministic without allowing one malformed URL to stop a batch.
 */
function decodeComparisonText(value: string): string {
  try {
    return decodeURIComponent(value).normalize('NFC');
  } catch {
    return value.normalize('NFC');
  }
}

/** Returns whether a hostname belongs to LinkedIn or one of its regional hosts. */
function isLinkedinHostname(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase();
  return (
    normalizedHostname === LINKEDIN_ROOT_HOST ||
    normalizedHostname.endsWith(`.${LINKEDIN_ROOT_HOST}`)
  );
}

/**
 * Returns the stable comparison key contained in a valid LinkedIn profile URL.
 *
 * Unlike {@link normalizeLinkedinUrl}, this is deliberately strict and returns
 * `undefined` for malformed values, non-LinkedIn hosts, and non-profile paths.
 * Persistence code can therefore reject an invalid identity instead of
 * accidentally turning arbitrary input text into a database key.
 */
export function linkedinProfileKey(value: string): string | undefined {
  try {
    const parsedUrl = new URL(value.trim());
    const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
    const profilePath = pathSegments[0];
    const encodedSlug = pathSegments[1];

    if (
      !isLinkedinHostname(parsedUrl.hostname) ||
      profilePath?.toLowerCase() !== LINKEDIN_PROFILE_PATH ||
      !encodedSlug
    ) {
      return undefined;
    }

    try {
      return decodeURIComponent(encodedSlug).normalize('NFC').toLowerCase();
    } catch {
      return undefined;
    }
  } catch {
    return undefined;
  }
}

/**
 * Builds a comparison key for a LinkedIn URL, not a URL meant to be fetched.
 * The provider echoes back profile URLs that differ cosmetically from the ones
 * we sent, and Map keys compare by exact string equality. This extracts the
 * complete profile slug, decodes URL escapes, normalizes Unicode, and removes
 * host/query formatting that does not change profile identity.
 *
 * Non-profile or malformed values retain the previous best-effort behavior so
 * callers can still compare them without an exception.
 */
export function normalizeLinkedinUrl(value: string): string {
  const trimmedValue = value.trim();
  const profileKey = linkedinProfileKey(trimmedValue);
  if (profileKey) {
    return `${CANONICAL_LINKEDIN_ORIGIN}/${LINKEDIN_PROFILE_PATH}/${profileKey}`;
  }

  return decodeComparisonText(trimmedValue.replace(/\/+$/, '')).toLowerCase();
}
