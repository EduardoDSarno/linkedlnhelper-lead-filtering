/**
 * Builds a comparison key for a LinkedIn URL, not a URL meant to be fetched.
 * The provider echoes back profile URLs that differ cosmetically from the ones
 * we sent (stray whitespace, trailing slashes, different casing), and Map keys
 * compare by exact string equality, so those variants would never match. This
 * collapses them into one stable key, which is what makes profile lookups and
 * input deduplication hit.
 */
export function normalizeLinkedinUrl(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}
