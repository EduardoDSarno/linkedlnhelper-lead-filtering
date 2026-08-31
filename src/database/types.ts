import type {
  EvaluationRunResult,
  FullEvaluationCriteria,
} from '../evaluation/index.js';

/** One durable evaluation of a CSV batch under a specific criteria set. */
export interface StoredEvaluationRun {
  readonly id: string;
  readonly createdAt: string;
  readonly criteria: FullEvaluationCriteria;
  readonly evaluation: EvaluationRunResult;
}

/** Lifecycle states one uploaded CSV moves through while being processed. */
export const PROCESSING_STATUS = {
  queued: 'queued',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
} as const;

/** A single processing status value. */
export type ProcessingStatus =
  (typeof PROCESSING_STATUS)[keyof typeof PROCESSING_STATUS];

/** Decisions a human reviewer may assign to one profile. */
export const MANUAL_DECISION = {
  approved: 'approved',
  rejected: 'rejected',
} as const;

/** A single manual-decision value. */
export type ManualDecision =
  (typeof MANUAL_DECISION)[keyof typeof MANUAL_DECISION];

/** One human decision overriding the automatic result for a profile. */
export interface ManualOverride {
  readonly publicId: string;
  readonly decision: ManualDecision;
  readonly reason?: string;
}

/** Metadata and on-disk artifact paths for one uploaded-CSV processing run. */
export interface ProcessingRun {
  readonly id: string;
  readonly status: ProcessingStatus;
  readonly originalCsvPath: string;
  readonly approvedCsvPath?: string;
  readonly evaluationReportPath?: string;
  readonly evaluationRunId?: string;
  readonly error?: string;
  readonly createdAt: string;
  readonly completedAt?: string;

  /** Latest human decisions submitted for this run; replaced on re-submission. */
  readonly manualOverrides?: readonly ManualOverride[];
}
