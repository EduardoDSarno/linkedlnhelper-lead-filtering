import type { ProfileLocation } from '../profile/index.js';

/** Country fields attached to a location that resolved to a Brazilian state. */
const BRAZIL_COUNTRY = { country: 'Brasil', countryCode: 'BR' } as const;

/**
 * Splits a LinkedIn "City, State, Country" location into its parts.
 *
 * The country word is localized to whoever viewed the profile, so the state is
 * found by testing each segment against the state table rather than trusting
 * its position. The last match wins, so a city named after its state ("São
 * Paulo, São Paulo, Brasil") keeps its city. Text with no Brazilian state is
 * kept whole instead of guessed at.
 */
export function parseBrazilLocation(text: string): ProfileLocation {
  const segments = text
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const stateIndex = segments.findLastIndex(
    (segment) => resolveBrazilRegion(segment) !== undefined,
  );
  const region =
    stateIndex === -1 ? undefined : resolveBrazilRegion(segments[stateIndex] as string);
  if (!region) return { text };

  const city = segments.slice(0, stateIndex).join(', ');
  return { text, ...(city ? { city } : {}), state: region.state, ...BRAZIL_COUNTRY };
}

/** Brazilian UF codes mapped to official state names. */
const BRAZIL_STATE_BY_UF = {
  AC: 'Acre',
  AL: 'Alagoas',
  AP: 'Amapá',
  AM: 'Amazonas',
  BA: 'Bahia',
  CE: 'Ceará',
  DF: 'Distrito Federal',
  ES: 'Espírito Santo',
  GO: 'Goiás',
  MA: 'Maranhão',
  MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais',
  PA: 'Pará',
  PB: 'Paraíba',
  PR: 'Paraná',
  PE: 'Pernambuco',
  PI: 'Piauí',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul',
  RO: 'Rondônia',
  RR: 'Roraima',
  SC: 'Santa Catarina',
  SP: 'São Paulo',
  SE: 'Sergipe',
  TO: 'Tocantins',
} as const;

/** Length of a Brazilian UF code; shorter fragments must not be treated as UFs. */
const BRAZIL_UF_CODE_LENGTH = 2;

type BrazilUf = keyof typeof BRAZIL_STATE_BY_UF;

/** Normalizes text so direct comparisons ignore casing, accents, and spacing. */
function normalizedText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const STATE_BY_NORMALIZED_NAME = new Map<string, { state: string; uf: string }>(
  Object.entries(BRAZIL_STATE_BY_UF).map(([uf, state]) => [
    normalizedText(state),
    { state, uf },
  ]),
);

/** Resolves a UF code or full state name into its canonical state and UF. */
export function resolveBrazilRegion(
  value: string,
): { state: string; uf: string } | undefined {
  const compact = value.trim().toUpperCase();

  if (compact.length === BRAZIL_UF_CODE_LENGTH) {
    const state = BRAZIL_STATE_BY_UF[compact as BrazilUf];
    if (state) return { state, uf: compact };
  }

  return STATE_BY_NORMALIZED_NAME.get(normalizedText(value));
}
