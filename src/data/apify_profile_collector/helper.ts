/**
 * Helper function to verify if it's a valid record, if not returns
 * undefined
 */
export function isRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Generic function to check if it is a string value, return undefined
 * if not
 */
export function isStringValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Function to parse 3 digit number from unknown http message
 * returns number if match or undefined
 */
export function isHttpNumberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const text = isStringValue(value);
  if (!text || !/^\d{3}$/.test(text)) return undefined;
  return Number.parseInt(text, 10);
}

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

/**
 * Coerces untrusted config (option or env string) into a positive integer no
 * larger than `maximum`. Anything unusable — NaN, Infinity, zero, negative —
 * falls back to `fallback`. Env vars are always strings and TypeScript cannot
 * check them, so this is what keeps provider limits from being exceeded.
 */
export function boundedInteger(
  value: unknown,
  fallback: number,
  maximum: number,
): number {
  const numericValue = Number(value); // converts anything to a number
  if (!Number.isFinite(numericValue) || numericValue <= 0) return fallback;
  return Math.min(maximum, Math.floor(numericValue));
}

/**
 * Same idea as `boundedInteger`, but for values where zero is legitimate and
 * no ceiling or rounding applies, such as a retry delay in milliseconds.
 */
export function nonNegativeNumber(value: unknown, fallback: number): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0
    ? numericValue
    : fallback;
}
