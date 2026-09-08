/**
 * Brazilian UF codes mapped to official state names.
 *
 * Bebity returns a single location string whose country word is localized to
 * whatever language its scrape ran in ("Brésil", "Brezilya"), so the adapter
 * finds the state by testing every comma-separated segment against this table
 * rather than trusting the segment's position.
 */
export const BRAZIL_STATE_BY_UF = {
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
