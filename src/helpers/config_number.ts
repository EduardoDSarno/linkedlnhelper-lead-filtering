/** Common lower bounds used by numeric application configuration. */
export const CONFIG_NUMBER_MINIMUMS = {
  nonNegative: 0,
  positive: 1,
} as const;

/** Rules for converting an untrusted value into a usable configuration number. */
export interface ConfigNumberOptions {
  fallback: number;
  minimum?: number;
  maximum?: number;
  integer?: boolean;
  clampMinimum?: boolean;
  clampMaximum?: boolean;
}

/**
 * Converts a supplied setting into a finite number under caller-owned rules.
 * Missing and blank values use the fallback before JavaScript can coerce them
 * to zero. The helper intentionally has no knowledge of environment variables.
 */
export function resolveConfigNumber(
  value: unknown,
  options: ConfigNumberOptions,
): number {
  if (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim().length === 0)
  ) {
    return options.fallback;
  }

  if (typeof value !== 'number' && typeof value !== 'string') {
    return options.fallback;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return options.fallback;

  const resolvedValue = options.integer
    ? Math.floor(numericValue)
    : numericValue;

  if (
    options.minimum !== undefined &&
    resolvedValue < options.minimum
  ) {
    return options.clampMinimum ? options.minimum : options.fallback;
  }

  if (
    options.maximum !== undefined &&
    resolvedValue > options.maximum
  ) {
    return options.clampMaximum ? options.maximum : options.fallback;
  }

  return resolvedValue;
}
