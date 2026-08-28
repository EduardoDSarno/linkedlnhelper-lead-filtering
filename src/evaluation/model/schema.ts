import { asRecord, asString } from '../../helpers/index.js';
import type { ModelApprovalCriteria } from '../criterias/index.js';
import { MODEL_EVALUATION_LIMITS } from './config.js';
import {
  MODEL_EVALUATION_DECISION,
  type CompensationEstimateConfidence,
  type EstimatedTotalMonthlyCompensation,
  type ModelEvaluationDecision,
  type ProfileModelEvaluation,
} from './types.js';

/**
 * JSON Schema supplied to Gemini for a machine-readable batch response.
 *
 * The evaluations array omits maxItems because Gemini rejects this schema
 * when that bound is present. Request grouping and response parsing already
 * enforce group size.
 */
export const MODEL_EVALUATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    evaluations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          profileId: { type: 'string' },
          matchPercent: {
            type: 'integer',
            minimum: MODEL_EVALUATION_LIMITS.matchPercentMinimum,
            maximum: MODEL_EVALUATION_LIMITS.matchPercentMaximum,
          },
          decision: {
            type: 'string',
            enum: Object.values(MODEL_EVALUATION_DECISION),
          },
          estimatedTotalMonthlyCompensation: {
            type: 'object',
            additionalProperties: false,
            properties: {
              status: {
                type: 'string',
                enum: ['estimated', 'insufficient_evidence'],
              },
              currency: {
                type: 'string',
                enum: ['BRL'],
              },
              minimumMonthlyCompensation: {
                type: 'integer',
                minimum: MODEL_EVALUATION_LIMITS.monthlyCompensationMinimum,
              },
              maximumMonthlyCompensation: {
                type: 'integer',
                minimum: MODEL_EVALUATION_LIMITS.monthlyCompensationMinimum,
              },
              confidence: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
              },
              basis: {
                type: 'array',
                minItems: 1,
                maxItems: MODEL_EVALUATION_LIMITS.compensationBasisItems,
                items: { type: 'string' },
              },
              reasons: {
                type: 'array',
                minItems: 1,
                maxItems: MODEL_EVALUATION_LIMITS.compensationReasonItems,
                items: { type: 'string' },
              },
            },
            required: ['status'],
          },
          reasons: {
            type: 'array',
            minItems: 1,
            maxItems: MODEL_EVALUATION_LIMITS.reasonsPerProfile,
            items: { type: 'string' },
          },
          evidence: {
            type: 'array',
            minItems: 1,
            maxItems: MODEL_EVALUATION_LIMITS.evidencePerProfile,
            items: { type: 'string' },
          },
          uncertainties: {
            type: 'array',
            maxItems: MODEL_EVALUATION_LIMITS.uncertaintiesPerProfile,
            items: { type: 'string' },
          },
        },
        required: [
          'profileId',
          'matchPercent',
          'decision',
          'estimatedTotalMonthlyCompensation',
          'reasons',
          'evidence',
          'uncertainties',
        ],
      },
    },
  },
  required: ['evaluations'],
} as const;

/** Identifies a response that is valid JSON but unusable by the application. */
export class ModelEvaluationResponseError extends Error {
  /** Creates a permanent response-validation failure. */
  constructor(message: string) {
    super(message);
    this.name = 'ModelEvaluationResponseError';
  }
}

/** Parses one required, non-empty string field. */
function requiredString(value: unknown, field: string): string {
  const result = asString(value);
  if (result) return result;

  throw new ModelEvaluationResponseError(
    `Gemini evaluation field "${field}" must be a non-empty string.`,
  );
}

/** Parses a bounded collection of non-empty strings. */
function stringList(
  value: unknown,
  field: string,
  maximumItems: number,
  minimumItems: number,
): string[] {
  if (!Array.isArray(value)) {
    throw new ModelEvaluationResponseError(
      `Gemini evaluation field "${field}" must be an array.`,
    );
  }

  if (value.length < minimumItems || value.length > maximumItems) {
    throw new ModelEvaluationResponseError(
      `Gemini evaluation field "${field}" has an invalid item count.`,
    );
  }

  return value.map((item, index) =>
    requiredString(item, `${field}[${String(index)}]`),
  );
}

/** Parses the model decision without accepting unknown response values. */
function modelDecision(value: unknown): ModelEvaluationDecision {
  const decision = asString(value);
  const allowedDecisions = Object.values(MODEL_EVALUATION_DECISION);

  if (
    decision &&
    allowedDecisions.includes(decision as ModelEvaluationDecision)
  ) {
    return decision as ModelEvaluationDecision;
  }

  throw new ModelEvaluationResponseError(
    'Gemini returned an unsupported evaluation decision.',
  );
}

/** Parses a percentage while rejecting fake precision and out-of-range values. */
function matchPercent(value: unknown): number {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MODEL_EVALUATION_LIMITS.matchPercentMinimum &&
    value <= MODEL_EVALUATION_LIMITS.matchPercentMaximum
  ) {
    return value;
  }

  throw new ModelEvaluationResponseError(
    'Gemini returned an invalid match percentage.',
  );
}

/** Parses one non-negative integer monthly-compensation bound. */
function monthlyCompensation(value: unknown, field: string): number {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MODEL_EVALUATION_LIMITS.monthlyCompensationMinimum
  ) {
    return value;
  }

  throw new ModelEvaluationResponseError(
    `Gemini returned an invalid ${field} monthly compensation.`,
  );
}

/** Parses an allowed confidence value for a supported estimate. */
function compensationConfidence(
  value: unknown,
): CompensationEstimateConfidence {
  const confidence = asString(value);
  if (confidence === 'high' || confidence === 'medium' || confidence === 'low') {
    return confidence;
  }

  throw new ModelEvaluationResponseError(
    'Gemini returned an invalid compensation confidence.',
  );
}

/** Parses either a supported compensation range or insufficient evidence. */
function estimatedTotalMonthlyCompensation(
  value: unknown,
): EstimatedTotalMonthlyCompensation {
  const record = asRecord(value);
  if (!record) {
    throw new ModelEvaluationResponseError(
      'Gemini evaluation field "estimatedTotalMonthlyCompensation" must be an object.',
    );
  }

  const status = asString(record['status']);
  if (status === 'insufficient_evidence') {
    return {
      status,
      reasons: stringList(
        record['reasons'],
        'estimatedTotalMonthlyCompensation.reasons',
        MODEL_EVALUATION_LIMITS.compensationReasonItems,
        1,
      ),
    };
  }

  if (status !== 'estimated') {
    throw new ModelEvaluationResponseError(
      'Gemini returned an unsupported compensation-estimate status.',
    );
  }

  if (record['currency'] !== 'BRL') {
    throw new ModelEvaluationResponseError(
      'Gemini compensation estimates must use BRL.',
    );
  }

  const minimumMonthlyCompensation = monthlyCompensation(
    record['minimumMonthlyCompensation'],
    'minimumMonthlyCompensation',
  );
  const maximumMonthlyCompensation = monthlyCompensation(
    record['maximumMonthlyCompensation'],
    'maximumMonthlyCompensation',
  );

  if (maximumMonthlyCompensation < minimumMonthlyCompensation) {
    throw new ModelEvaluationResponseError(
      'Gemini returned an inverted estimated compensation range.',
    );
  }

  return {
    status,
    currency: 'BRL',
    minimumMonthlyCompensation,
    maximumMonthlyCompensation,
    confidence: compensationConfidence(record['confidence']),
    basis: stringList(
      record['basis'],
      'estimatedTotalMonthlyCompensation.basis',
      MODEL_EVALUATION_LIMITS.compensationBasisItems,
      1,
    ),
  };
}

/** Ensures the returned decision respects the caller's approval configuration. */
function validateApprovalPolicy(
  evaluation: ProfileModelEvaluation,
  approval: ModelApprovalCriteria | undefined,
): void {
  if (!approval?.enabled) {
    if (evaluation.decision !== MODEL_EVALUATION_DECISION.manualReview) {
      throw new ModelEvaluationResponseError(
        'Gemini made a final decision while model approval is disabled.',
      );
    }
    return;
  }

  if (
    evaluation.decision === MODEL_EVALUATION_DECISION.approved &&
    evaluation.matchPercent < approval.minimumMatchPercent
  ) {
    throw new ModelEvaluationResponseError(
      'Gemini approved a profile below the configured match threshold.',
    );
  }
}

/** Parses one profile result before batch-level identity checks run. */
function profileEvaluation(
  value: unknown,
  approval: ModelApprovalCriteria | undefined,
): ProfileModelEvaluation {
  const record = asRecord(value);
  if (!record) {
    throw new ModelEvaluationResponseError(
      'Each Gemini evaluation must be an object.',
    );
  }

  const evaluation: ProfileModelEvaluation = {
    profileId: requiredString(record['profileId'], 'profileId'),
    matchPercent: matchPercent(record['matchPercent']),
    decision: modelDecision(record['decision']),
    estimatedTotalMonthlyCompensation: estimatedTotalMonthlyCompensation(
      record['estimatedTotalMonthlyCompensation'],
    ),
    reasons: stringList(
      record['reasons'],
      'reasons',
      MODEL_EVALUATION_LIMITS.reasonsPerProfile,
      1,
    ),
    evidence: stringList(
      record['evidence'],
      'evidence',
      MODEL_EVALUATION_LIMITS.evidencePerProfile,
      1,
    ),
    uncertainties: stringList(
      record['uncertainties'],
      'uncertainties',
      MODEL_EVALUATION_LIMITS.uncertaintiesPerProfile,
      0,
    ),
  };

  validateApprovalPolicy(evaluation, approval);
  return evaluation;
}

/** Parses response JSON and reports malformed text as a permanent failure. */
function responseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ModelEvaluationResponseError(
      'Gemini returned invalid JSON for the evaluation request.',
    );
  }
}

/**
 * Validates one Gemini response and correlates it with the requested profiles.
 *
 * The identity checks prevent a syntactically valid response from silently
 * dropping, duplicating, or inventing a profile result.
 */
export function parseModelEvaluationResponse(
  text: string,
  expectedProfileIds: readonly string[],
  approval?: ModelApprovalCriteria,
): readonly ProfileModelEvaluation[] {
  const response = asRecord(responseJson(text));
  const values = response?.['evaluations'];

  if (!Array.isArray(values)) {
    throw new ModelEvaluationResponseError(
      'Gemini evaluation response must contain an evaluations array.',
    );
  }

  const evaluations = values.map((value) =>
    profileEvaluation(value, approval),
  );
  const expectedIds = new Set(expectedProfileIds);
  const returnedIds = new Set<string>();

  for (const evaluation of evaluations) {
    if (returnedIds.has(evaluation.profileId)) {
      throw new ModelEvaluationResponseError(
        `Gemini duplicated profile ID "${evaluation.profileId}".`,
      );
    }
    if (!expectedIds.has(evaluation.profileId)) {
      throw new ModelEvaluationResponseError(
        `Gemini returned unexpected profile ID "${evaluation.profileId}".`,
      );
    }
    returnedIds.add(evaluation.profileId);
  }

  const missingIds = expectedProfileIds.filter((id) => !returnedIds.has(id));
  if (missingIds.length > 0) {
    throw new ModelEvaluationResponseError(
      `Gemini omitted profile IDs: ${missingIds.join(', ')}.`,
    );
  }

  return expectedProfileIds.map((id) => {
    const evaluation = evaluations.find((item) => item.profileId === id);
    if (!evaluation) {
      throw new ModelEvaluationResponseError(
        `Gemini omitted profile ID "${id}".`,
      );
    }
    return evaluation;
  });
}
