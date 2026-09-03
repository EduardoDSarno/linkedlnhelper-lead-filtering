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
  ArtifactKind,
  CampaignSummary,
  CompensationMatch,
  DecisionsResult,
  ImportResult,
  ManualOverride,
  ProfileDetails,
  ProfileHighlight,
  ProfileResult,
  RunResults,
  RunStatus,
  StartReviewResult,
} from './api';
import { DEFAULT_CRITERIA } from './criteria';
import { LIST_TAB, tabCounts, type OverrideMap } from './listView';

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

/** Previous employers cycled through the fabricated career histories. */
const MOCK_PRIOR_COMPANIES = [
  'RD Station',
  'Conta Azul',
  'Stone',
  'Loft',
  'Mercado Livre',
  'Neon',
] as const;

/** Schools cycled through the fabricated education histories. */
const MOCK_SCHOOLS = [
  'Fundação Getulio Vargas',
  'Universidade de São Paulo',
  'PUC Minas',
  'Universidade Federal do Paraná',
] as const;

/** Degrees cycled through the fabricated education histories. */
const MOCK_DEGREES = [
  'Administração de Empresas',
  'Gestão Comercial',
  'Economia',
  'Marketing',
] as const;

/** Current calendar year represented by the fixed mock career data. */
const MOCK_CURRENT_YEAR = 2026;

/** Typical duration of the current role in the fabricated histories. */
const MOCK_CURRENT_ROLE_YEARS = 2;

/** Typical duration of a previous role in the fabricated histories. */
const MOCK_PREVIOUS_ROLE_YEARS = 4;

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
    ...(hasPhoto ? { photo: mockPhoto(name, index) } : {}),
    ...(failed
      ? {}
      : { details: mockDetails(name, position, company, location, index, hasPhoto) }),
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
    highlights: mockHighlights(index, decision),
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

/** Builds the career, education, and About fields used by the expanded mock view. */
function mockDetails(
  name: string,
  position: string,
  company: string,
  location: string,
  index: number,
  hasPhoto: boolean,
): ProfileDetails {
  const currentStartYear = MOCK_CURRENT_YEAR - MOCK_CURRENT_ROLE_YEARS - (index % 3);
  const previousStartYear = currentStartYear - MOCK_PREVIOUS_ROLE_YEARS;
  const priorCompany = MOCK_PRIOR_COMPANIES[index % MOCK_PRIOR_COMPANIES.length]!;
  const school = MOCK_SCHOOLS[index % MOCK_SCHOOLS.length]!;
  const degree = MOCK_DEGREES[index % MOCK_DEGREES.length]!;
  const firstName = name.split(' ')[0] ?? name;

  return {
    about: `${firstName} atua na construção de operações comerciais e de relacionamento com clientes, com experiência em ambientes B2B e foco em crescimento sustentável.`,
    openToWork: index % UNCERTAIN_LOCATION_EVERY === 0,
    experience: [
      {
        position,
        companyName: company,
        location,
        startDate: { month: 2 + (index % 8), year: currentStartYear },
        endDate: { text: 'Present' },
        description:
          'Responsável por estratégia da área, acompanhamento de indicadores e desenvolvimento do time.',
      },
      {
        position: index % 2 === 0 ? 'Executivo de Contas Sênior' : 'Coordenador de Customer Success',
        companyName: priorCompany,
        location,
        startDate: { month: 1, year: previousStartYear },
        endDate: { month: 12, year: currentStartYear - 1 },
        description:
          'Atuação em carteira B2B, negociação consultiva e melhoria dos processos de aquisição e retenção.',
      },
    ],
    education: [
      {
        schoolName: school,
        degree: 'Bacharelado',
        fieldOfStudy: degree,
        startDate: { year: previousStartYear - MOCK_PREVIOUS_ROLE_YEARS },
        endDate: { year: previousStartYear },
      },
    ],
    ...(hasPhoto
      ? {
          photoSummary:
            index % 3 === 0
              ? 'Retrato profissional, rosto visível e imagem nítida.'
              : 'Foto utilizável, com rosto claramente identificável.',
        }
      : {}),
  };
}

/**
 * A real face photo per profile so the row avatar is unmistakably a photo, not
 * an initials circle. If the network is unavailable the row falls back to
 * initials on its own via the image's onError handler.
 */
function mockPhoto(_name: string, index: number): string {
  return `https://i.pravatar.cc/150?img=${(index % 70) + 1}`;
}

/** Fabricated strength/warning/info one-liners cycled into the row chips. */
const MOCK_STRENGTHS = [
  'Progressão consistente em vendas B2B',
  'Gestão de contas estratégicas (key account)',
  'Experiência consultiva em SaaS',
];
const MOCK_WARNINGS = [
  'Pouco tempo na posição atual',
  'Foco recente em marketing, não vendas',
  'Senioridade acima da faixa da campanha',
];
const MOCK_INFOS = ['Baseado em Goiânia, GO', 'MBA Executivo (FGV)'];

/** Builds 1–3 categorized highlights whose mix matches the model decision. */
function mockHighlights(
  index: number,
  decision: 'approved' | 'manual_review' | 'rejected',
): ProfileHighlight[] {
  const strength: ProfileHighlight = { kind: 'strength', text: MOCK_STRENGTHS[index % MOCK_STRENGTHS.length]! };
  const warning: ProfileHighlight = { kind: 'warning', text: MOCK_WARNINGS[index % MOCK_WARNINGS.length]! };
  const info: ProfileHighlight = { kind: 'info', text: MOCK_INFOS[index % MOCK_INFOS.length]! };

  if (decision === 'approved') {
    return index % 2 === 0 ? [strength, info] : [strength, info, warning];
  }
  if (decision === 'rejected') {
    return [warning, info];
  }
  return index % 2 === 0 ? [strength, warning] : [strength, warning, info];
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

/** In-memory campaigns store, seeded with a couple of past runs. */
let mockRuns: CampaignSummary[] = [
  {
    processingId: 'mock-past-1',
    name: 'Gestores comerciais SaaS — ago/2026',
    status: 'completed',
    createdAt: '2026-08-20T14:00:00.000Z',
    updatedAt: '2026-08-21T10:15:00.000Z',
    completedAt: '2026-08-20T14:08:00.000Z',
    systemPrompt:
      'Gestores comerciais e de Customer Success em SaaS B2B, com carreira consultiva e progressão de analista a gestão.',
  },
  {
    processingId: 'mock-past-2',
    name: 'Relacionamento bancário PJ — jul/2026',
    status: 'completed',
    createdAt: '2026-07-11T09:30:00.000Z',
    updatedAt: '2026-07-11T09:41:00.000Z',
    completedAt: '2026-07-11T09:41:00.000Z',
    systemPrompt:
      'Profissionais de relacionamento e contas PJ em bancos e fintechs, foco em ticket alto.',
  },
];

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
  name: string,
): Promise<StartReviewResult> {
  statusPolls = 0;
  const systemPrompt = (_criteria as { systemPrompt?: string })?.systemPrompt;
  // Record (or update) this run in the in-memory campaigns store.
  mockRuns = [
    {
      processingId,
      name,
      status: 'completed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      ...(systemPrompt ? { systemPrompt } : {}),
    },
    ...mockRuns.filter((run) => run.processingId !== processingId),
  ];
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

/** Decisions saved per run, so reopening a run restores them like the backend. */
const mockOverrides: Record<string, ManualOverride[]> = {};

/** Builds the run's profiles with any saved decisions merged back in. */
function resultsFor(processingId: string): ProfileResult[] {
  const saved = mockOverrides[processingId];
  const byId = new Map((saved ?? []).map((override) => [override.publicId, override]));
  return MOCK_PROFILES.map((profile) => {
    const override = byId.get(profile.publicId);
    return override ? { ...profile, override } : profile;
  });
}

/** Tallies a run's final decisions the way the backend's /runs route does. */
function countsFor(processingId: string) {
  const saved = mockOverrides[processingId] ?? [];
  const overrides: OverrideMap = Object.fromEntries(
    saved.map((override) => [override.publicId, override.decision]),
  );
  const counts = tabCounts(resultsFor(processingId), overrides);
  return {
    approved: counts[LIST_TAB.approved],
    rejected: counts[LIST_TAB.rejected],
    manual: counts[LIST_TAB.manual],
    failed: counts[LIST_TAB.failed],
  };
}

/**
 * Mock of getResults: returns the fabricated profiles, with any decisions
 * previously saved for this run merged back in so a reopened run shows them.
 */
export function getResults(processingId: string): Promise<RunResults> {
  return delay({ processingId, results: resultsFor(processingId) });
}

/** Mock of submitDecisions: stores the decisions and reports rebuilt counts. */
export function submitDecisions(
  processingId: string,
  overrides: ManualOverride[],
  _name: string,
): Promise<DecisionsResult> {
  mockOverrides[processingId] = overrides;
  mockRuns = mockRuns.map((run) =>
    run.processingId === processingId
      ? { ...run, updatedAt: new Date().toISOString() }
      : run,
  );

  const autoApproved = MOCK_PROFILES.filter(
    (profile) => profile.modelDecision === 'approved',
  ).length;
  const approved = overrides.filter((o) => o.decision === 'approved').length;
  const rejected = overrides.filter((o) => o.decision === 'rejected').length;

  return delay({
    processingId,
    finalApprovedCount: Math.max(0, autoApproved + approved - rejected),
    overridesApplied: overrides.length,
  });
}

/**
 * Mock of startDownload: builds a small CSV from the fabricated profiles and
 * downloads it client-side, since there is no backend to stream a file.
 *
 * It reflects the model's own decisions (not in-browser overrides), which is
 * enough to prove the download UX without the real pipeline.
 */
export function startDownload(_processingId: string, artifact: ArtifactKind): void {
  const rows =
    artifact === 'approved'
      ? MOCK_PROFILES.filter((profile) => profile.modelDecision === 'approved')
      : MOCK_PROFILES;

  const header = 'public_id;name;decision;score';
  const body = rows.map(
    (profile) =>
      `${profile.publicId};${profile.name};${profile.modelDecision ?? ''};${profile.matchPercent ?? ''}`,
  );
  const csv = `﻿${[header, ...body].join('\r\n')}\r\n`;

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download =
    artifact === 'approved' ? 'approved-linked-helper.csv' : 'evaluation-report.csv';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Mock of listRuns: returns the campaigns store with fresh decision counts. */
export function listRuns(): Promise<CampaignSummary[]> {
  const runs = mockRuns.map((run) =>
    run.status === 'completed'
      ? { ...run, counts: countsFor(run.processingId) }
      : run,
  );
  return delay(runs, 200);
}

/** Mock of renameRun: updates the campaign name in the store. */
export function renameRun(processingId: string, name: string): Promise<void> {
  mockRuns = mockRuns.map((run) =>
    run.processingId === processingId
      ? { ...run, name, updatedAt: new Date().toISOString() }
      : run,
  );
  return delay(undefined, 150);
}

/** Mock of deleteRun: removes the campaign from the store. */
export function deleteRun(processingId: string): Promise<void> {
  mockRuns = mockRuns.filter((run) => run.processingId !== processingId);
  return delay(undefined, 150);
}
