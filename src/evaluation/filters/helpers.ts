import { BROAD_OUTCOME, type BroadCriterionOutcome } from './constants.js';

/** Maps a definite yes/no check onto the shared criterion outcome constants. */
export function criterionOutcome(matched: boolean): BroadCriterionOutcome {
  return matched ? BROAD_OUTCOME.matched : BROAD_OUTCOME.notMatched;
}

/** Normalizes text so direct comparisons ignore casing, accents, and spacing. */
export function normalizedText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Checks whether a normalized word or phrase occurs at token boundaries. */
export function containsNormalizedTerm(
  value: string,
  normalizedTerm: string,
): boolean {
  const normalizedValue = normalizedText(value);

  if (!normalizedValue || !normalizedTerm) return false;

  return ` ${normalizedValue} `.includes(` ${normalizedTerm} `);
}
