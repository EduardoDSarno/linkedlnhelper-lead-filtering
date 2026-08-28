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
