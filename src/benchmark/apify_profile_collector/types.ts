import type {
  ApifyCollectionResult,
  ApifyCollectionStats,
  ApifyCollectorOptions,
  ApifyProfileFailure,
  RawApifyProfile,
  ResolvedApifyCollectorConfig,
} from '../../dataCollector/apify_profile_collector/index.js';
import type { Logger } from '../../logging/index.js';

export type ApifyBenchmarkStatus =
  | 'dry_run'
  | 'completed'
  | 'invariant_failed'
  | 'fatal';

export type ApifyBenchmarkInputKind =
  | 'direct_links'
  | 'link_file'
  | 'linked_helper_csv';

/** Optional identity supplied by an input adapter for result verification. */
export interface ApifyBenchmarkExpectedIdentity {
  linkedinUrl: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
}

/** Uniform input returned by direct-link and file-specific adapters. */
export interface LoadedApifyBenchmarkInput {
  sourceKind: ApifyBenchmarkInputKind;
  sourcePath: string;
  profileLinks: string[];
  expectedIdentities: ApifyBenchmarkExpectedIdentity[];
}

/** Parsed command-line values before input loading and benchmark planning. */
export interface ApifyBenchmarkArguments {
  inputPath?: string;
  profileLinks: string[];
  execute: boolean;
  offset: number;
  limit?: number;
  label?: string;
  collectorOptions: ApifyCollectorOptions;
}

/** Caller-owned request for planning or executing one isolated benchmark. */
export interface ApifyBenchmarkRequest {
  runId: string;
  sourceKind: ApifyBenchmarkInputKind;
  sourcePath: string;
  profileLinks: readonly string[];
  expectedIdentities?: readonly ApifyBenchmarkExpectedIdentity[];
  execute: boolean;
  offset: number;
  limit?: number;
  label?: string;
  collectorOptions?: ApifyCollectorOptions;
  outputDirectory: string;
}

/** Immutable preview of the exact provider work selected for one run. */
export interface ApifyBenchmarkPlan {
  runId: string;
  label?: string;
  sourceKind: ApifyBenchmarkInputKind;
  sourcePath: string;
  mode: 'dry_run' | 'execute';
  availableProfiles: number;
  selectedProfiles: number;
  selectedProfileLinks: string[];
  expectedIdentityCount: number;
  offset: number;
  limit?: number;
  configuration: ResolvedApifyCollectorConfig;
  plannedInitialActorRuns: number;
  plannedInitialWaves: number;
}

/** Paths written by one run beneath its unique output directory. */
export interface ApifyBenchmarkArtifactPaths {
  directory: string;
  plan: string;
  profiles: string;
  failures: string;
  summary: string;
  log: string;
}

/** Correctness checks that determine whether a paid run can be trusted. */
export interface ApifyBenchmarkValidation {
  passed: boolean;
  reconciledCounts: boolean;
  noDuplicateProfiles: boolean;
  noDuplicateFailures: boolean;
  noOverlappingResults: boolean;
  noMissingInputs: boolean;
  noUnexpectedResults: boolean;
  noUnexpectedProviderRecords: boolean;
  missingProfileLinks: string[];
  unexpectedProfileLinks: string[];
  errors: string[];
}

/** One advisory name difference between the source and returned Apify data. */
export interface ApifyBenchmarkIdentityMismatch {
  linkedinUrl: string;
  expectedName: string;
  actualName?: string;
}

/** Advisory identity comparison that never changes correctness validation. */
export interface ApifyBenchmarkIdentityComparison {
  comparedProfiles: number;
  matchingProfiles: number;
  mismatches: ApifyBenchmarkIdentityMismatch[];
}

/** Final persisted record for a dry run, paid run, or fatal benchmark. */
export interface ApifyBenchmarkSummary {
  runId: string;
  status: ApifyBenchmarkStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  plan: ApifyBenchmarkPlan;
  collection?: ApifyCollectionStats;
  validation?: ApifyBenchmarkValidation;
  identityComparison?: ApifyBenchmarkIdentityComparison;
  fatalError?: string;
  artifacts: ApifyBenchmarkArtifactPaths;
}

/** In-memory result returned to the CLI and deterministic tests. */
export interface ApifyBenchmarkResult {
  plan: ApifyBenchmarkPlan;
  summary: ApifyBenchmarkSummary;
  profiles: RawApifyProfile[];
  failures: ApifyProfileFailure[];
  artifacts: ApifyBenchmarkArtifactPaths;
}

/** Production-compatible collector signature replaceable by a fake in tests. */
export type ApifyBenchmarkCollector = (
  profileLinks: readonly string[],
  logger?: Logger,
  options?: ApifyCollectorOptions,
) => Promise<ApifyCollectionResult>;

/** Replaceable time and collector dependencies for deterministic execution. */
export interface ApifyBenchmarkDependencies {
  collectProfiles: ApifyBenchmarkCollector;
  environment: NodeJS.ProcessEnv;
  now(): Date;
}
