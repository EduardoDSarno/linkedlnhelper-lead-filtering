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
}
