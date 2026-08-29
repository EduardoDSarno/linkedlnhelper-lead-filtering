/** A provider record is intentionally permissive and remains untouched. */
export type RawApifyProfile = Record<string, unknown>;

export type ApifyFailureCategory =
  | 'not_found'
  | 'invalid_request'
  | 'authentication'
  | 'timeout'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'invalid_response'
  | 'network'
  | 'unknown';

/** One profile that could not be collected after applying retry rules. */
export interface ApifyProfileFailure {
  linkedinUrl: string;
  inputIndex: number;
  category: ApifyFailureCategory;
  error: string;
  attempts: number;

  /** Whether this class of failure is normally safe to retry. */
  retryable: boolean;

  /** True when every configured attempt was used without success. */
  retryExhausted: boolean;

  status?: number;

  /** Untouched provider error record, when the Actor returned one. */
  raw?: RawApifyProfile;
}

/** Operational totals for one complete multi-round collection. */
export interface ApifyCollectionStats {
  requestedProfiles: number;
  collectedProfiles: number;
  failedProfiles: number;
  permanentFailures: number;
  exhaustedTransientFailures: number;
  retriedProfiles: number;
  totalProfileAttempts: number;
  roundsCompleted: number;
  retryRounds: number;
  actorRuns: number;
  batchSize: number;
  batchConcurrency: number;
  unexpectedProviderRecords: number;
}

/** Successful profiles and failures are returned independently. */
export interface ApifyCollectionResult {
  /** Successful untouched Apify profile objects in original input order. */
  profiles: RawApifyProfile[];

  /** Final permanent or retry-exhausted failures in input order. */
  failures: ApifyProfileFailure[];

  stats: ApifyCollectionStats;
}

export interface ApifyCollectorOptions {
  /** Profiles placed in one Actor run, subject to the configured safety limit. */
  batchSize?: number;

  /** Actor runs allowed in flight, subject to the plan's configured limit. */
  concurrency?: number;

  /** Total attempts per profile, including its initial request. */
  maxAttempts?: number;

  /** Initial wait before the first retry round. */
  retryBaseDelayMs?: number;
}

/** Context supplied to the batch executor and used by deterministic tests. */
export interface ApifyBatchContext {
  round: number;
  batchNumber: number;
  totalBatches: number;
}

/** Raw result from one completed Actor run. */
export interface ApifyBatchExecution {
  records: RawApifyProfile[];
  actorRunId?: string;
  datasetId?: string;
}

export type ApifyBatchExecutor = (
  profileLinks: readonly string[],
  context: ApifyBatchContext,
) => Promise<ApifyBatchExecution>;

/** One profile still waiting to be collected, carried across retry rounds. */
export interface PendingProfile {
  linkedinUrl: string;
  inputIndex: number;

  /** Attempts already spent on this profile, used against `maxAttempts`. */
  attempts: number;
}

/** A successfully collected record kept with its position in the original input. */
export interface CollectedProfile {
  inputIndex: number;
  raw: RawApifyProfile;
}

/**
 * Result of one Actor run batch, successful or not. Either `execution` or
 * `error` is set, and the profiles plus context are kept so failures can be
 * attributed back to the exact profiles sent in that batch.
 */
export interface BatchOutcome {
  profiles: PendingProfile[];
  context: ApifyBatchContext;
  durationMs: number;
  execution?: ApifyBatchExecution;
  error?: unknown;
}
