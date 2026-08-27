import type {
  GeminiContentGenerator,
  GeminiTokenUsage,
} from '../../models/index.js';

/** Final decisions the model stage may return for professional fit. */
export const MODEL_EVALUATION_DECISION = {
  approved: 'approved',
  rejected: 'rejected',
  manualReview: 'manual_review',
} as const;

/** A final model-stage decision for one profile. */
export type ModelEvaluationDecision =
  (typeof MODEL_EVALUATION_DECISION)[keyof typeof MODEL_EVALUATION_DECISION];

/** A monthly salary range estimated by the model from professional evidence. */
export interface EstimatedSalaryRange {
  readonly minimumMonthlyIncome: number;
  readonly maximumMonthlyIncome: number;
}

/** One validated professional-fit assessment returned by Gemini. */
export interface ProfileModelEvaluation {
  readonly profileId: string;
  readonly matchPercent: number;
  readonly decision: ModelEvaluationDecision;
  readonly estimatedSalary: EstimatedSalaryRange;
  readonly reasons: readonly string[];
  readonly evidence: readonly string[];
  readonly uncertainties: readonly string[];
}

/** Tokens consumed by all successful and failed model-evaluation attempts. */
export type ModelEvaluationTokenUsage = Required<GeminiTokenUsage>;

/** One request group that could not produce a usable structured response. */
export interface ModelEvaluationFailure {
  readonly profileIds: readonly string[];
  readonly attempts: number;
  readonly retryable: boolean;
  readonly retryExhausted: boolean;
  readonly error: string;
  readonly tokenUsage?: ModelEvaluationTokenUsage;
}

/** Complete result of evaluating every profile that reached Gemini. */
export interface ModelEvaluationOutcome {
  readonly requestedProfiles: number;
  readonly successfulProfiles: number;
  readonly failedProfiles: number;
  readonly evaluations: readonly ProfileModelEvaluation[];
  readonly failures: readonly ModelEvaluationFailure[];
  readonly tokenUsage: ModelEvaluationTokenUsage;
}

/** Injectable delay used to keep retry tests deterministic and immediate. */
export type ModelEvaluationWait = (milliseconds: number) => Promise<void>;

/** Caller overrides and test boundaries for the model-evaluation stage. */
export interface ModelEvaluationOptions {
  model?: string;
  profilesPerRequest?: number;
  concurrency?: number;
  requestTimeoutMs?: number;
  maximumAttempts?: number;
  retryBaseDelayMs?: number;
  generateContent?: GeminiContentGenerator;
  wait?: ModelEvaluationWait;
}
