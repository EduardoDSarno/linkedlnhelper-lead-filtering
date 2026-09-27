/**
 * Narrowing helpers for values that arrive as `unknown` from outside the
 * program: provider payloads, environment variables, parsed JSON.
 *
 * Each returns the usable value or `undefined`, rather than a boolean, so a
 * caller can narrow and capture in one step. That is why they are named `as*`
 * and not `is*` — an `is*` name would suggest a predicate returning true or
 * false.
 */

/** Returns `value` as a plain object, or undefined for arrays and non-objects. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Returns `value` as a trimmed non-empty string, or undefined.
 *
 * A blank string is treated as absent, because a provider that sends `"  "`
 * for a missing field means the same thing as omitting it.
 */
export function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Returns `value` as an HTTP status number, or undefined.
 *
 * Numbers pass through when finite. Strings must be exactly three digits,
 * which is what stops an unrelated numeric string from being read as a status.
 */
export function asHttpStatus(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const text = asString(value);
  if (!text || !/^\d{3}$/.test(text)) return undefined;
  return Number.parseInt(text, 10);
}
