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

  try {
    const parsedUrl = new URL(trimmedValue);
    const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
    const profilePath = pathSegments[0];
    const encodedSlug = pathSegments[1];

    if (
      isLinkedinHostname(parsedUrl.hostname) &&
      profilePath?.toLowerCase() === LINKEDIN_PROFILE_PATH &&
      encodedSlug
    ) {
      const normalizedSlug = decodeComparisonText(encodedSlug).toLowerCase();
      return `${CANONICAL_LINKEDIN_ORIGIN}/${LINKEDIN_PROFILE_PATH}/${normalizedSlug}`;
    }
  } catch {
    // The best-effort fallback below preserves the helper's non-throwing API.
  }

  return decodeComparisonText(trimmedValue.replace(/\/+$/, '')).toLowerCase();
}
