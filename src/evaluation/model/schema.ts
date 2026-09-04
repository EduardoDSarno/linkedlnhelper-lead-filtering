import { asRecord, asString } from '../../helpers/index.js';
import { MODEL_EVALUATION_LIMITS } from './config.js';
import {
  type CompensationEstimateConfidence,
  type EstimatedTotalMonthlyCompensation,
  type ProfileHighlight,
  type ProfileHighlightKind,
  type ProfileModelAssessment,
} from './types.js';

/** The categories a profile highlight may use. */
const HIGHLIGHT_KINDS: readonly ProfileHighlightKind[] = ['strength', 'warning', 'info'];

/** Campaign currency stored on every accepted compensation estimate. */
const COMPENSATION_CURRENCY = 'BRL' as const;

/**
 * Provider spellings that still mean reais. Compared after trim and case fold,
 * with spaces removed so "R $" and "brl" both match.
 */
const BRL_CURRENCY_ALIASES = new Set(['brl', 'r$', 'brl$', 'r$brl']);

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
          highlights: {
            type: 'array',
            minItems: 1,
            maxItems: MODEL_EVALUATION_LIMITS.highlightsPerProfile,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', enum: ['strength', 'warning', 'info'] },
                text: { type: 'string' },
              },
              required: ['kind', 'text'],
            },
          },
        },
        required: [
          'profileId',
          'matchPercent',
          'estimatedTotalMonthlyCompensation',
          'reasons',
          'evidence',
          'uncertainties',
          'highlights',
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

/** One requested profile that a valid envelope still failed to score. */
export interface ModelEvaluationParseFailure {
  readonly profileId: string;
  readonly error: string;
}

/**
 * A parsed batch reply split into the profiles that scored and the ones that
 * did not. The JSON envelope was valid; individual objects are judged on their
 * own so one bad object never discards its siblings.
 */
export interface ParsedModelEvaluationResponse {
  readonly assessments: readonly ProfileModelAssessment[];
  readonly failures: readonly ModelEvaluationParseFailure[];
}

/** Converts an unknown thrown value into a stable per-profile failure message. */
function parseErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Parses one required, non-empty string field. */
function requiredString(value: unknown, field: string): string {
  const result = asString(value);
  if (result) return result;

  throw new ModelEvaluationResponseError(
    `The evaluation field "${field}" must be a non-empty string.`,
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
      `The evaluation field "${field}" must be an array.`,
    );
  }

  if (value.length < minimumItems || value.length > maximumItems) {
    throw new ModelEvaluationResponseError(
      `The evaluation field "${field}" has an invalid item count.`,
    );
  }

  return value.map((item, index) =>
    requiredString(item, `${field}[${String(index)}]`),
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
    'The model returned an invalid match percentage.',
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
    `The model returned an invalid ${field} monthly compensation.`,
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
    'The model returned an invalid compensation confidence.',
  );
}

/** Parses either a supported compensation range or insufficient evidence. */
function estimatedTotalMonthlyCompensation(
  value: unknown,
): EstimatedTotalMonthlyCompensation {
  const record = asRecord(value);
  if (!record) {
    throw new ModelEvaluationResponseError(
      'The evaluation field "estimatedTotalMonthlyCompensation" must be an object.',
    );
  }

  const status = asString(record['status']);
  if (status === 'insufficient_evidence') {
    // Some replies (seen at max thinking) put the explanation in `basis`, the
    // `estimated` field, instead of `reasons`. Accept it as an alias for the
    // explanation list; any numeric bounds or confidence on this status are
    // ignored. Do NOT invent a range — only the field name is aliased.
    const explanation =
      Array.isArray(record['reasons']) && record['reasons'].length > 0
        ? record['reasons']
        : record['basis'];
    return {
      status,
      reasons: stringList(
        explanation,
        'estimatedTotalMonthlyCompensation.reasons',
        MODEL_EVALUATION_LIMITS.compensationReasonItems,
        1,
      ),
    };
  }

  if (status !== 'estimated') {
    throw new ModelEvaluationResponseError(
      'The model returned an unsupported compensation-estimate status.',
    );
  }

  const currency = compensationCurrency(record['currency']);

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
      'The model returned an inverted estimated compensation range.',
    );
  }

  return {
    status,
    currency,
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

/**
 * Accepts BRL and the common ways models spell reais.
 *
 * The prompt only allows Brazilian-real estimates. A missing or blank currency
 * is treated as that campaign currency. Any other code is rejected, and the
 * error includes the received value so the failed reply can be diagnosed.
 */
function compensationCurrency(value: unknown): typeof COMPENSATION_CURRENCY {
  const raw = asString(value);
  if (!raw) return COMPENSATION_CURRENCY;

  const normalized = raw.toLowerCase().replaceAll(/\s+/g, '');
  if (BRL_CURRENCY_ALIASES.has(normalized)) return COMPENSATION_CURRENCY;

  throw new ModelEvaluationResponseError(
    `Compensation estimates must use BRL, got ${JSON.stringify(raw)}.`,
  );
}

/**
 * Parses up to three categorized highlights, tolerating a missing or partly
 * malformed list. Invalid items are skipped and text is capped rather than
 * failing the whole profile, since highlights are a presentation summary.
 */
function highlights(value: unknown): ProfileHighlight[] {
  if (!Array.isArray(value)) return [];

  const parsed: ProfileHighlight[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const kind = asString(record?.['kind']) as ProfileHighlightKind | undefined;
    const text = asString(record?.['text'])
      ?.slice(0, MODEL_EVALUATION_LIMITS.highlightTextMaxLength)
      .trimEnd();

    if (!text || !kind || !HIGHLIGHT_KINDS.includes(kind)) continue;

    parsed.push({ kind, text });
    if (parsed.length >= MODEL_EVALUATION_LIMITS.highlightsPerProfile) break;
  }

  return parsed;
}

/** Parses one profile result before batch-level identity checks run. */
function profileEvaluation(value: unknown): ProfileModelAssessment {
  const record = asRecord(value);
  if (!record) {
    throw new ModelEvaluationResponseError(
      'Each evaluation must be an object.',
    );
  }

  return {
    profileId: requiredString(record['profileId'], 'profileId'),
    matchPercent: matchPercent(record['matchPercent']),
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
    highlights: highlights(record['highlights']),
  };
}

/** Parses response JSON and reports malformed text as a permanent failure. */
function responseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ModelEvaluationResponseError(
      'The model returned invalid JSON for the evaluation request.',
    );
  }
}

/**
 * Validates a batch reply at profile grain and correlates it with the request.
 *
 * The JSON envelope must be usable (that still throws), but each profile object
 * is judged on its own: a valid object scores, an invalid one fails only that
 * profile, and its siblings survive. Identity is kept strict without discarding
 * good results — the first object for a requested id wins, extra duplicates are
 * ignored, objects for unrequested ids are ignored (never stealing a row), and
 * any requested id that never appears is failed individually.
 */
export function parseModelEvaluationResponse(
  text: string,
  expectedProfileIds: readonly string[],
): ParsedModelEvaluationResponse {
  const response = asRecord(responseJson(text));
  const values = response?.['evaluations'];

  if (!Array.isArray(values)) {
    throw new ModelEvaluationResponseError(
      'The evaluation response must contain an evaluations array.',
    );
  }

  const expectedIds = new Set(expectedProfileIds);
  const outcomeById = new Map<string, ProfileModelAssessment | { error: string }>();

  for (const value of values) {
    const record = asRecord(value);
    const id = record ? asString(record['profileId']) : undefined;

    // Ignore objects without a requested id: never fail a real person because
    // the model added an unexpected or malformed row, and never steal a slot.
    if (!id || !expectedIds.has(id)) continue;
    // Keep the first result for an id; drop later duplicates of the same id.
    if (outcomeById.has(id)) continue;

    try {
      outcomeById.set(id, profileEvaluation(value));
    } catch (error: unknown) {
      outcomeById.set(id, { error: parseErrorMessage(error) });
    }
  }

  const assessments: ProfileModelAssessment[] = [];
  const failures: ModelEvaluationParseFailure[] = [];

  for (const id of expectedProfileIds) {
    const outcome = outcomeById.get(id);
    if (!outcome) {
      failures.push({ profileId: id, error: `The model omitted profile ID "${id}".` });
    } else if ('error' in outcome) {
      failures.push({ profileId: id, error: outcome.error });
    } else {
      assessments.push(outcome);
    }
  }

  return { assessments, failures };
}
