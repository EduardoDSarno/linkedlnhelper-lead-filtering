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
