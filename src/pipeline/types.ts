import type { DatabaseSync } from 'node:sqlite';

import type {
  ApifyCollectionResult,
  ApifyCollectionStats,
  ApifyProfileFailure,
} from '../dataCollector/apify_profile_collector/index.js';
import type { StoredEvaluationRun } from '../database/types.js';
import type { ModelEvaluationOptions } from '../evaluation/index.js';
import type {
  GeminiTokenUsage,
  ProfileImageBatchOptions,
  ProfileImageJob,
  ProfileImageJobResult,
} from '../imageExtractor/index.js';
import type { Logger } from '../logging/index.js';
import type { FullProfile } from '../profile/index.js';

/** Tokens billed across a whole run, with every count present. */
export type ImageTokenUsageTotal = Required<GeminiTokenUsage>;

/** One profile photo the analyzer returned an error for. */
export interface ImageAnalysisFailure {
  profileId: string;
  error: string;

  /** Tokens Gemini billed before rejecting this image, when it reported any. */
  usage?: GeminiTokenUsage;
}

/** Injectable image-analysis boundary used by production and tests. */
export type ProfileImageAnalyzer = (
  jobs: readonly ProfileImageJob[],
  options: ProfileImageBatchOptions,
) => Promise<ProfileImageJobResult[]>;

/** Everything one image-analysis stage produces for the run summary. */
export interface ProfileImageAnalysisOutcome {
  /** Every supplied profile, with an assessment attached where one succeeded. */
  fullProfiles: FullProfile[];

  profilesWithoutPhoto: number;
  successfulImageAnalyses: number;
  failedImageAnalyses: number;
  failures: ImageAnalysisFailure[];
  tokenUsage: ImageTokenUsageTotal;
  /** True when the stage never ran because the campaign's criteria skipped it. */
  analysisSkipped: boolean;
}

/** One provider record that could not be mapped into an application profile. */
export interface ProfileMappingFailure {
  providerRecordIndex: number;
  error: string;
}

/** Successful profiles and isolated failures produced by normalization. */
export interface ProfileNormalizationOutcome {
  profiles: FullProfile[];
  failures: ProfileMappingFailure[];
}

/** Where one run writes its artifacts. */
export interface FullProfilePipelineOutputPaths {
  rawApifyProfiles: string;
  apifyProfileFailures: string;
  fullProfiles: string;
  summary: string;
}

/** External boundaries that production provides and tests can replace. */
export interface FullProfilePipelineDependencies {
  collectProfiles: (
    profileLinks: readonly string[],
    logger: Logger,
  ) => Promise<ApifyCollectionResult>;

  extractImages: ProfileImageAnalyzer;
  writeJson: (path: string, value: unknown) => Promise<void>;

  /** Opens the run's database, which the pipeline always closes before return. */
  openDatabase: () => DatabaseSync;

  /** Saves a completed profile and returns its persistent application identity. */
  insertProfile: (profile: FullProfile, db: DatabaseSync) => FullProfile;
  now: () => Date;
}

/** Runtime settings a caller may override, such as test output paths. */
export interface FullProfilePipelineOptions {
  imageConcurrency?: number;
  /** When true, skips the image-analysis stage entirely; see analyzeProfileImages. */
  skipImageAnalysis?: boolean;
  outputPaths?: FullProfilePipelineOutputPaths;
}

/** Serializable operational record of one completed pipeline run. */
export interface FullProfilePipelineSummary {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  requestedProfiles: number;
  collectedProfiles: number;
  providerCollection: ApifyCollectionStats;
  providerFailures: ApifyProfileFailure[];
  normalizedProfiles: number;
  profilesWithoutPhoto: number;
  successfulImageAnalyses: number;
  failedImageAnalyses: number;
  fullProfilesWritten: number;
  mappingFailures: ProfileMappingFailure[];
  imageAnalysisFailures: ImageAnalysisFailure[];

  /** Includes usage from failed responses because Gemini may still bill them. */
  imageTokenUsage: ImageTokenUsageTotal;
  outputs: FullProfilePipelineOutputPaths;
}

/** Profiles produced by a run together with its operational summary. */
export interface FullProfilePipelineResult {
  summary: FullProfilePipelineSummary;
  profiles: FullProfile[];
}

/** Runtime overrides passed to the two stages coordinated by a review run. */
export interface ReviewPipelineOptions {
  profilePipeline?: FullProfilePipelineOptions;
  modelEvaluation?: ModelEvaluationOptions;

  /**
   * When true, reuse already-collected full profiles instead of calling Apify
   * and the image model. Intended for API-only bake-offs; the UI never sets it.
   */
  skipCollection?: boolean;

  /** In-memory full profiles used when tests skip the on-disk cache artifact. */
  cachedProfiles?: readonly FullProfile[];

  /** Override for the default `output/full-profiles.json` cache path. */
  cachedProfilesPath?: string;
}

/** External boundaries replaced by deterministic review-pipeline tests. */
export interface ReviewPipelineDependencies {
  profilePipeline: FullProfilePipelineDependencies;
  openDatabase: () => DatabaseSync;
  insertEvaluationRun: (
    run: StoredEvaluationRun,
    db: DatabaseSync,
  ) => StoredEvaluationRun;
  createRunId: () => string;
  now: () => Date;

  /** Reads the cached full-profile artifact when a review skips collection. */
  readCachedProfiles?: (path: string) => Promise<unknown>;
}

/** Complete acquisition and evaluation result returned to a future interface. */
export interface ReviewPipelineResult {
  profilePipeline: FullProfilePipelineResult;
  evaluationRun: StoredEvaluationRun;
}

/** Stage results needed to build the serializable pipeline summary. */
export interface FullProfilePipelineSummaryInput {
  startedAt: Date;
  completedAt: Date;
  requestedProfiles: number;
  collection: ApifyCollectionResult;
  normalization: ProfileNormalizationOutcome;
  imageAnalysis: ProfileImageAnalysisOutcome;
  outputPaths: FullProfilePipelineOutputPaths;
}
