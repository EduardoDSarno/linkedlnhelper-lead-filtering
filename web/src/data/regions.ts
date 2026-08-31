/**
 * Brazil's five regions mapped to their states, and the flat list of all 27
 * states.
 *
 * The criteria form expands a region or an exclude choice into concrete state
 * names before sending them, because the backend matches location as an
 * include-list against the profile's location text. Full state names are used
 * (never 2-letter UFs), since the backend does a substring match and short
 * codes like "PA" or "SP" would match unrelated text.
 */
export const BRAZIL_REGIONS: Record<string, string[]> = {
  Norte: [
    'Acre',
    'Amapá',
    'Amazonas',
    'Pará',
    'Rondônia',
    'Roraima',
    'Tocantins',
  ],
  Nordeste: [
    'Alagoas',
    'Bahia',
    'Ceará',
    'Maranhão',
    'Paraíba',
    'Pernambuco',
    'Piauí',
    'Rio Grande do Norte',
    'Sergipe',
  ],
  'Centro-Oeste': ['Distrito Federal', 'Goiás', 'Mato Grosso', 'Mato Grosso do Sul'],
  Sudeste: ['Espírito Santo', 'Minas Gerais', 'Rio de Janeiro', 'São Paulo'],
  Sul: ['Paraná', 'Rio Grande do Sul', 'Santa Catarina'],
};

/** Region names, used as autocomplete shortcuts. */
export const REGION_NAMES = Object.keys(BRAZIL_REGIONS);

/** Every Brazilian state, by full name. */
export const BRAZIL_STATES = Object.values(BRAZIL_REGIONS).flat();
