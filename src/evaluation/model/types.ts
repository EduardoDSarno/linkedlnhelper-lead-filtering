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

/** Supported confidence levels for a model-estimated compensation range. */
export type CompensationEstimateConfidence = 'high' | 'medium' | 'low';

/** A total monthly professional-compensation range supported by profile evidence. */
export interface EstimatedTotalMonthlyCompensationRange {
  readonly status: 'estimated';
  readonly currency: 'BRL';
  readonly minimumMonthlyCompensation: number;
  readonly maximumMonthlyCompensation: number;
  readonly confidence: CompensationEstimateConfidence;
  readonly basis: readonly string[];
}

/** An explicit refusal to invent compensation when evidence is insufficient. */
export interface InsufficientCompensationEvidence {
  readonly status: 'insufficient_evidence';
  readonly reasons: readonly string[];
}

/** A supported range or an explicit statement that no range can be estimated. */
export type EstimatedTotalMonthlyCompensation =
  | EstimatedTotalMonthlyCompensationRange
  | InsufficientCompensationEvidence;

/** Stable outcomes from deterministic compensation-range comparison. */
export const COMPENSATION_RANGE_OUTCOME = {
  matched: 'matched',
  notMatched: 'not_matched',
  unknown: 'unknown',
} as const;

/** Result of comparing an estimate with the campaign's desired range. */
export interface CompensationRangeMatch {
  readonly outcome:
    (typeof COMPENSATION_RANGE_OUTCOME)[keyof typeof COMPENSATION_RANGE_OUTCOME];
  readonly overlapRatio?: number;
  readonly explanation: string;
}

/** One validated professional-fit assessment returned by Gemini. */
export interface ProfileModelEvaluation {
  readonly profileId: string;
  readonly matchPercent: number;
  readonly decision: ModelEvaluationDecision;
  readonly estimatedTotalMonthlyCompensation: EstimatedTotalMonthlyCompensation;
  readonly compensationRangeMatch?: CompensationRangeMatch;
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
