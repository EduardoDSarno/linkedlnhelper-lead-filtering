/**
 * In-browser mock of the backend, for building and demoing the screens without
 * a real (paid, minutes-long) Apify + Gemini run.
 *
 * It is used only when the page is opened with `?mock` in the URL; otherwise the
 * real client in `api.ts` is used. The mock returns fabricated profiles with a
 * short simulated delay and reports a couple of "running" ticks before it
 * completes, so the loading screen is exercised too.
 */
import type {
  CompensationMatch,
  ImportResult,
  ProfileResult,
  RunResults,
  RunStatus,
  StartReviewResult,
} from './api';
import { DEFAULT_CRITERIA } from './criteria';

/** Whether the mock backend is active for this session. */
export const MOCK_ENABLED =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('mock');

/** Resolves after a delay, to imitate network/latency. */
function delay<T>(value: T, ms = 400): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/** Sample profiles: [name, role, company, location]. */
const SAMPLE: Array<[string, string, string, string]> = [
  ['Marina Albuquerque', 'Head de Novos Negócios', 'Contabilizei', 'São Paulo, SP'],
  ['Rafael Tanaka', 'Gerente de Customer Success', 'Pipefy', 'Curitiba, PR'],
  ['Juliana Vasconcelos', 'Coordenadora de Vendas B2B', 'Omie', 'São Paulo, SP'],
  ['Bruno Cavalcanti', 'Gerente de Relacionamento PJ', 'Banco BV', 'Rio de Janeiro, RJ'],
  ['Camila Rezende', 'Diretora Comercial', 'Nuvemshop', 'São Paulo, SP'],
  ['Diego Fontoura', 'Analista Sênior de Vendas', 'Resultados Digitais', 'Florianópolis, SC'],
  ['Patrícia Bittencourt', 'Gerente de Contas Estratégicas', 'TOTVS', 'São Paulo, SP'],
  ['Henrique Vilela', 'Coordenador de CS', 'Gympass', 'Belo Horizonte, MG'],
  ['Larissa Nakamura', 'Head de Parcerias', 'Conta Simples', 'São Paulo, SP'],
  ['Thiago Monteiro', 'Gerente de Vendas Inside', 'Zenvia', 'Porto Alegre, RS'],
  ['Aline Queiroz', 'Analista de Sucesso do Cliente', 'Neoway', 'Florianópolis, SC'],
  ['Vinícius Rangel', 'Executivo de Contas', 'Sankhya', 'Ribeirão Preto, SP'],
  ['Fernanda Sampaio', 'Gerente de Relacionamento', 'Itaú Empresas', 'São Paulo, SP'],
  ['Gustavo Peixoto', 'Diretor de Receita', 'Solides', 'Belo Horizonte, MG'],
  ['Renata Machado', 'Coordenadora de Pré-vendas', 'Rock Content', 'Belo Horizonte, MG'],
  ['Eduardo Sanches', 'Gerente Comercial Regional', 'Linx', 'Campinas, SP'],
  ['Beatriz Correia', 'Analista Sênior de CS', 'Hotmart', 'Belo Horizonte, MG'],
  ['Marcelo Duarte', 'Head Comercial', 'Cora', 'São Paulo, SP'],
  ['Tatiana Furtado', 'Gerente de Expansão', 'iFood Benefícios', 'Osasco, SP'],
  ['Leandro Aguiar', 'Especialista de Vendas Técnicas', 'Senior Sistemas', 'Blumenau, SC'],
  ['Priscila Mourão', 'Coordenadora de Relacionamento', 'Banco Inter', 'Belo Horizonte, MG'],
  ['Rodrigo Barcelos', 'Gerente de Novos Negócios', 'VTEX', 'São Paulo, SP'],
  ['Isabela Cunha', 'Analista de Vendas', 'Granatum', 'Curitiba, PR'],
  ['Felipe Andrade', 'Executivo Sênior de Contas', 'Salesforce', 'São Paulo, SP'],
  ['Natália Prado', 'Gerente de Customer Experience', 'Movidesk', 'Joinville, SC'],
  ['Caio Bezerra', 'Trainee de Vendas', 'Ambev Tech', 'Recife, PE'],
  ['Mariana Toledo', 'Consultora de RH', 'Gupy', 'São Paulo, SP'],
  ['Otávio Lins', 'Analista de Dados', 'Semantix', 'São Paulo, SP'],
  ['Sabrina Klein', 'Assistente Comercial', 'Contabilizei', 'Curitiba, PR'],
  ['Débora Antunes', 'Coordenadora de Vendas', 'Agendor', 'São Paulo, SP'],
];

const MOCK_REASONS = [
  'Trajetória consistente em vendas B2B consultivas com evolução para gestão em 8 anos.',
  'Sete anos ininterruptos em Customer Success, com progressão de analista a gestão.',
  'Perfil comercial forte, mas remuneração estimada abaixo da faixa desejada.',
  'Experiência em relacionamento PJ bancário aderente ao público da campanha.',
  'Senioridade acima da faixa configurada; ticket de decisão pode não se aplicar.',
  'Carreira curta e ainda em estágio inicial para os critérios da campanha.',
  'Histórico estável, mas sem evidência de experiência comercial ou de relacionamento.',
  'Progressão rápida de analista a coordenação, com forte aderência de área e região.',
];

/** Index of the row that imitates a keyword-filter exclusion. */
const FILTERED_INDEX = 25;

/** Indexes that imitate an enrichment timeout (no model score). */
const FAILED_INDEXES = new Set([13, 27]);

/** Cadence for the “no photo” warning chip. */
const NO_PHOTO_EVERY = 6;

/** Cadence for the uncertain-location warning chip. */
const UNCERTAIN_LOCATION_EVERY = 5;

/** Cadence for a compensation estimate the campaign would reject. */
const COMP_MISMATCH_EVERY = 5;

/** Width of a fake compensation range, in reais. */
const MOCK_COMP_SPAN_REAIS = 6_000;

/**
 * Builds one fabricated profile result from a sample row.
 *
 * A couple of indexes imitate the non-graded cases (keyword filter and
 * enrichment timeout) so every list tab has something to show.
 */
function mockProfile(row: (typeof SAMPLE)[number], index: number): ProfileResult {
  const [name, position, company, location] = row;
  const publicId = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z ]/g, '')
    .trim()
    .replace(/ +/g, '-');

  const filtered = index === FILTERED_INDEX;
  const failed = FAILED_INDEXES.has(index);
  const score = Math.max(12, Math.min(98, 96 - index * 2 - ((index * 7) % 9)));
  const ageLo = 26 + (index % 12);
  const hasPhoto = index % NO_PHOTO_EVERY !== 2;

  const base: ProfileResult = {
    publicId,
    name,
    linkedinUrl: `https://linkedin.com/in/${publicId}`,
    broadDecision: filtered ? 'Failed' : 'NextPhase',
    broadDecisionMessage: filtered
      ? 'Cargo atual contém “trainee”.'
      : failed
        ? 'Timeout no enriquecimento do perfil'
        : 'passou no filtro determinístico',
    headline: `${position} · ${company}`,
    position,
    company,
    location,
    apparentAge: `${ageLo}–${ageLo + 5}`,
    ...(hasPhoto ? { photo: `https://example.invalid/photo/${publicId}` } : {}),
  };

  if (filtered || failed) return base;

  const decision =
    score >= DEFAULT_CRITERIA.approveMin
      ? 'approved'
      : score >= DEFAULT_CRITERIA.manualMin
        ? 'manual_review'
        : 'rejected';
  const estimatedLo = (8 + (index % 5) * 3) * 1000;
  const estimatedHi = estimatedLo + MOCK_COMP_SPAN_REAIS;
  const insufficient = index % COMP_MISMATCH_EVERY === 0;
  const mismatched = !insufficient && index % COMP_MISMATCH_EVERY === 2;

  return {
    ...base,
    modelDecision: decision,
    matchPercent: score,
    reasons: [MOCK_REASONS[index % MOCK_REASONS.length]!],
    evidence: [`Cargo atual: ${position} na ${company}.`],
    uncertainties: mockUncertainties(index),
    compensation: insufficient
      ? { status: 'insufficient_evidence', reasons: ['Histórico salarial ausente.'] }
      : {
          status: 'estimated',
          currency: 'BRL',
          minimumMonthlyCompensation: estimatedLo,
          maximumMonthlyCompensation: estimatedHi,
          confidence: (['high', 'medium', 'low'] as const)[index % 3],
          basis: ['cargo', 'senioridade', 'mercado local'],
        },
    ...(insufficient
      ? {}
      : { compensationMatch: mockCompensationMatch(mismatched, estimatedLo, estimatedHi) }),
  };
}

/** Warning-like uncertainties the list turns into chips. */
function mockUncertainties(index: number): string[] {
  const items: string[] = [];
  if (index % UNCERTAIN_LOCATION_EVERY === 1) items.push('Localização incerta no perfil');
  if (index % 4 === 0) items.push('Tempo de casa não informado.');
  return items;
}

/** Fit of a fake estimate against the campaign's default compensation band. */
function mockCompensationMatch(
  mismatched: boolean,
  estimatedLo: number,
  estimatedHi: number,
): CompensationMatch {
  if (mismatched) {
    return {
      outcome: 'not_matched',
      explanation: `Remuneração estimada (R$ ${estimatedLo}–${estimatedHi}) fora da faixa`,
    };
  }
  return {
    outcome: 'matched',
    explanation: 'Estimativa sobrepõe a faixa desejada',
  };
}

const MOCK_PROFILES: ProfileResult[] = SAMPLE.map(mockProfile);

/** Counts status polls so the run reports running before it completes. */
let statusPolls = 0;

/** Mock of importCsv: returns fabricated counts. */
export function importCsv(_file: File): Promise<ImportResult> {
  return delay({
    processingId: 'mock-run',
    totalRows: MOCK_PROFILES.length,
    validProfiles: MOCK_PROFILES.length,
    duplicatedProfiles: 0,
    invalidProfiles: 0,
  });
}

/** Mock of startReview: resets the status counter and accepts the run. */
export function startReview(
  processingId: string,
  _criteria: unknown,
): Promise<StartReviewResult> {
  statusPolls = 0;
  return delay({ processingId });
}

/** Mock of getStatus: running for two polls, then completed. */
export function getStatus(processingId: string): Promise<RunStatus> {
  statusPolls += 1;
  const status = statusPolls >= 3 ? 'completed' : 'running';
  return delay(
    {
      processingId,
      status,
      ...(status === 'completed'
        ? {
            evaluationRunId: 'mock-eval',
            completedAt: new Date().toISOString(),
          }
        : {}),
    },
    300,
  );
}

/** Mock of getResults: returns the fabricated profiles. */
export function getResults(processingId: string): Promise<RunResults> {
  return delay({ processingId, results: MOCK_PROFILES });
}
