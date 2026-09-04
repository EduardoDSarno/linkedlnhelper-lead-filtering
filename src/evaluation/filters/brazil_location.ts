import { normalizedText } from './helpers.js';

/**
 * Brazilian UF codes mapped to official state names.
 *
 * City chips in the campaign UI use this table so "Florianópolis, SC" can
 * match LinkedIn text that spells out Santa Catarina, uses the UF, or names
 * only the city / metro area.
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

/** Country tokens stripped from the end of a location before city/state checks. */
const BRAZIL_LOCATION_COUNTRY_TOKENS = ['brasil', 'brazil'] as const;

/** LinkedIn metro wording that follows the city name. */
const CITY_METRO_SUFFIX_TOKENS = [['e', 'regiao']] as const;

/** English metro wording that precedes the city name. */
const CITY_METRO_PREFIX_TOKENS = [['greater']] as const;

type BrazilUf = keyof typeof BRAZIL_STATE_BY_UF;

type ConfiguredPlace =
  | { kind: 'city'; city: string; state: string; uf: string }
  | { kind: 'state'; state: string; uf: string }
  | { kind: 'raw'; text: string };

const STATE_BY_NORMALIZED_NAME = new Map<string, { state: string; uf: string }>(
  Object.entries(BRAZIL_STATE_BY_UF).map(([uf, state]) => [
    normalizedText(state),
    { state, uf },
  ]),
);

/**
 * Reports whether LinkedIn-style location text matches one campaign place.
 *
 * A city chip such as "Florianópolis, SC" matches the city plus full state
 * name, the city plus UF, city-only text, and metro wording. A state name
 * also matches its UF as a whole token. The city is required at the start of
 * the place so "São Paulo, SP" does not keep every city in São Paulo state.
 */
export function locationTextMatches(
  profileLocationText: string,
  configuredLocation: string,
): boolean {
  const place = parseConfiguredPlace(configuredLocation);

  if (place.kind === 'city') {
    return cityPlaceMatches(profileLocationText, place.city, place.state, place.uf);
  }

  if (place.kind === 'state') {
    return statePlaceMatches(profileLocationText, place.state, place.uf);
  }

  return containsTokenSequence(
    locationTokens(profileLocationText),
    locationTokens(place.text),
  );
}

/** Interprets a campaign location as a city chip, a state, or raw search text. */
function parseConfiguredPlace(value: string): ConfiguredPlace {
  const trimmed = value.trim();
  const separatorIndex = trimmed.lastIndexOf(',');

  if (separatorIndex !== -1) {
    const city = trimmed.slice(0, separatorIndex).trim();
    const region = trimmed.slice(separatorIndex + 1).trim();
    const resolved = resolveBrazilRegion(region);

    if (city && resolved) {
      return { kind: 'city', city, state: resolved.state, uf: resolved.uf };
    }
  }

  const asState = resolveBrazilRegion(trimmed);
  if (asState) {
    return { kind: 'state', state: asState.state, uf: asState.uf };
  }

  return { kind: 'raw', text: trimmed };
}

/**
 * Matches a city campaign place against LinkedIn's city-first location text.
 *
 * The city must lead the string (or follow "Greater"). What follows may be
 * empty, a country, the state, the UF, or metro wording.
 */
function cityPlaceMatches(
  profileLocationText: string,
  city: string,
  state: string,
  uf: string,
): boolean {
  const rest = remainingAfterLeadingCity(
    locationTokens(profileLocationText),
    locationTokens(city),
  );

  return rest !== undefined && remainderAllowsCityMatch(
    rest,
    locationTokens(state),
    locationTokens(uf),
  );
}

/** Matches a state campaign place on the full name or the UF as its own token. */
function statePlaceMatches(
  profileLocationText: string,
  state: string,
  uf: string,
): boolean {
  const profileTokens = locationTokens(profileLocationText);

  return (
    containsTokenSequence(profileTokens, locationTokens(state)) ||
    containsTokenSequence(profileTokens, locationTokens(uf))
  );
}

/**
 * Returns the tokens after the city when the profile starts with that city.
 *
 * Also accepts English "Greater {city}" so metro listings still count as the
 * city rather than falling through as unrelated text.
 */
function remainingAfterLeadingCity(
  profileTokens: readonly string[],
  cityTokens: readonly string[],
): string[] | undefined {
  if (startsWithTokenSequence(profileTokens, cityTokens)) {
    return profileTokens.slice(cityTokens.length);
  }

  for (const prefix of CITY_METRO_PREFIX_TOKENS) {
    const cityStart = prefix.length;

    if (
      startsWithTokenSequence(profileTokens, prefix) &&
      startsWithTokenSequence(profileTokens.slice(cityStart), cityTokens)
    ) {
      return profileTokens.slice(cityStart + cityTokens.length);
    }
  }

  return undefined;
}

/**
 * Accepts city-only, city+country, city+state/UF, and metro remainder tokens.
 *
 * Country names are ignored at the end so "Florianópolis, Brasil" still counts
 * as the city. Metro suffixes may themselves be followed by a state or UF.
 */
function remainderAllowsCityMatch(
  rest: readonly string[],
  stateTokens: readonly string[],
  ufTokens: readonly string[],
): boolean {
  let current = stripTrailingCountryTokens(rest);

  for (const suffix of CITY_METRO_SUFFIX_TOKENS) {
    if (startsWithTokenSequence(current, suffix)) {
      current = stripTrailingCountryTokens(current.slice(suffix.length));
      break;
    }
  }

  if (current.length === 0) return true;
  if (startsWithTokenSequence(current, stateTokens)) return true;
  if (startsWithTokenSequence(current, ufTokens)) return true;

  return false;
}

/** Resolves a UF code or official state name to both forms. */
function resolveBrazilRegion(
  value: string,
): { state: string; uf: string } | undefined {
  const compact = value.trim().toUpperCase();

  if (compact.length === BRAZIL_UF_CODE_LENGTH) {
    const state = BRAZIL_STATE_BY_UF[compact as BrazilUf];
    if (state) return { state, uf: compact };
  }

  return STATE_BY_NORMALIZED_NAME.get(normalizedText(value));
}

/** Drops trailing Brazil/Brazil-equivalent country tokens. */
function stripTrailingCountryTokens(tokens: readonly string[]): string[] {
  let end = tokens.length;

  while (end > 0 && isCountryToken(tokens[end - 1])) {
    end -= 1;
  }

  return tokens.slice(0, end);
}

/** Reports whether a normalized token is a Brazil country label. */
function isCountryToken(token: string | undefined): boolean {
  return (
    token !== undefined &&
    BRAZIL_LOCATION_COUNTRY_TOKENS.some((country) => country === token)
  );
}

/** Tokenizes location text with the shared accent-insensitive normalizer. */
function locationTokens(value: string): string[] {
  const normalized = normalizedText(value);
  return normalized.length > 0 ? normalized.split(/\s+/) : [];
}

/** Reports whether haystack begins with the needle token sequence. */
function startsWithTokenSequence(
  haystack: readonly string[],
  needle: readonly string[],
): boolean {
  return (
    needle.length > 0 &&
    needle.length <= haystack.length &&
    needle.every((token, index) => haystack[index] === token)
  );
}

/** Reports whether haystack contains the needle as consecutive tokens. */
function containsTokenSequence(
  haystack: readonly string[],
  needle: readonly string[],
): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;

  const lastStart = haystack.length - needle.length;

  for (let start = 0; start <= lastStart; start += 1) {
    if (needle.every((token, offset) => haystack[start + offset] === token)) {
      return true;
    }
  }

  return false;
}
