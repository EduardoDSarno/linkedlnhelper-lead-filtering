import { asRecord, asString } from '../../helpers/index.js';
import { errorMessage as parseErrorMessage } from '../../helpers/error_message.js';
import { MODEL_EVALUATION_LIMITS } from './config.js';
import {
  type CompensationEstimateConfidence,
  type EstimatedAge,
  type EstimatedAgeConfidence,
  type EstimatedTotalMonthlyCompensation,
  type ModelImageAssessment,
  type ProfileModelAssessment,
} from './types.js';

/** Campaign currency stored on every accepted compensation estimate. */
const COMPENSATION_CURRENCY = 'BRL' as const;

/**
 * Provider spellings that still mean reais. Compared after trim and case fold,
 * with spaces removed so "R $" and "brl" both match.
 */
const BRL_CURRENCY_ALIASES = new Set(['brl', 'r$', 'brl$', 'r$brl']);

/**
 * JSON Schema supplied to model for a machine-readable batch response.
 *
 * The evaluations array omits maxItems because model rejects this schema
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
          positives: {
            type: 'array',
            maxItems: MODEL_EVALUATION_LIMITS.positivesPerProfile,
            items: { type: 'string' },
          },
          negatives: {
            type: 'array',
            maxItems: MODEL_EVALUATION_LIMITS.negativesPerProfile,
            items: { type: 'string' },
          },
          summary: { type: 'string' },
          estimatedAge: {
            type: 'object',
            additionalProperties: false,
            properties: {
              minimumAge: {
                type: 'integer',
                minimum: MODEL_EVALUATION_LIMITS.ageMinimum,
                maximum: MODEL_EVALUATION_LIMITS.ageMaximum,
              },
              maximumAge: {
                type: 'integer',
                minimum: MODEL_EVALUATION_LIMITS.ageMinimum,
                maximum: MODEL_EVALUATION_LIMITS.ageMaximum,
              },
              confidence: {
                type: 'string',
                enum: ['high', 'medium', 'low', 'unknown'],
              },
              basis: {
                type: 'array',
                maxItems: MODEL_EVALUATION_LIMITS.ageBasisItems,
                items: { type: 'string' },
              },
            },
            required: ['minimumAge', 'maximumAge', 'confidence', 'basis'],
          },
          imageAssessment: {
            type: 'object',
            additionalProperties: false,
            properties: {
              hasFace: { type: 'boolean' },
              faceCount: { type: 'integer', minimum: 0 },
              faceVisibility: {
                type: 'string',
                enum: ['clear', 'partial', 'unclear', 'not_applicable'],
              },
              imageQuality: {
                type: 'string',
                enum: ['good', 'usable', 'poor'],
              },
              isBlurry: { type: 'boolean' },
              isPoorlyLit: { type: 'boolean' },
              photoType: {
                type: 'string',
                enum: [
                  'professional_portrait',
                  'selfie',
                  'mirror_selfie',
                  'group_photo',
                  'other',
                ],
              },
              framing: {
                type: 'string',
                enum: ['headshot', 'upper_body', 'full_body', 'unclear'],
              },
              background: {
                type: 'string',
                enum: [
                  'plain',
                  'workplace',
                  'outdoor',
                  'domestic',
                  'other',
                  'unclear',
                ],
              },
              attire: {
                type: 'string',
                enum: ['formal', 'business_casual', 'casual', 'unclear'],
              },
              reviewRequired: { type: 'boolean' },
              observations: {
                type: 'array',
                maxItems: MODEL_EVALUATION_LIMITS.imageObservationItems,
                items: { type: 'string' },
              },
            },
            required: [
              'hasFace',
              'faceCount',
              'faceVisibility',
              'imageQuality',
              'isBlurry',
              'isPoorlyLit',
              'photoType',
              'framing',
              'background',
              'attire',
              'reviewRequired',
              'observations',
            ],
          },
        },
        required: [
          'profileId',
          'matchPercent',
          'estimatedTotalMonthlyCompensation',
          'positives',
          'negatives',
          'summary',
          'estimatedAge',
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

/** Parses one required, non-empty string field. */
function requiredString(value: unknown, field: string): string {
  const result = asString(value);
  if (result) return result;

  throw new ModelEvaluationResponseError(
    `The evaluation field "${field}" must be a non-empty string.`,
  );
}

/**
 * Parses a bounded collection of non-empty strings.
 *
 * A lone string is read as a one-item list: replies regularly write the single
 * justification they have as `"basis": "..."` rather than wrapping it, and the
 * text is exactly what the list was asking for, so rejecting the shape would
 * discard a good evaluation over a pair of brackets.
 */
function stringList(
  value: unknown,
  field: string,
  maximumItems: number,
  minimumItems: number,
): string[] {
  const items = asString(value) ? [value as string] : value;

  if (!Array.isArray(items)) {
    throw new ModelEvaluationResponseError(
      `The evaluation field "${field}" must be an array.`,
    );
  }

  if (items.length < minimumItems || items.length > maximumItems) {
    throw new ModelEvaluationResponseError(
      `The evaluation field "${field}" has an invalid item count.`,
    );
  }

  return items.map((item, index) =>
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
 * Parses a bounded list of short points, tolerating a missing or partly
 * malformed list. Invalid items are skipped and text is capped rather than
 * failing the whole profile, since positives/negatives are a presentation
 * summary, not the source of truth for the score.
 */
function points(value: unknown, maximumItems: number): string[] {
  if (!Array.isArray(value)) return [];

  const parsed: string[] = [];
  for (const item of value) {
    const text = asString(item)
      ?.slice(0, MODEL_EVALUATION_LIMITS.pointTextMaxLength)
      .trimEnd();
    if (!text) continue;

    parsed.push(text);
    if (parsed.length >= maximumItems) break;
  }

  return parsed;
}

/**
 * Reads the decision summary, tolerating the shapes providers substitute.
 *
 * Preference order is the contract field, then a single "rationale" string,
 * and finally the strongest point available. The fallbacks keep a scored
 * profile whose reply merged its explanation into another field instead of
 * dropping the person; only a reply with nothing usable at all fails.
 */
function summaryText(
  record: Record<string, unknown>,
  positives: readonly string[],
  negatives: readonly string[],
): string {
  const summary = asString(record['summary'])
    ?.slice(0, MODEL_EVALUATION_LIMITS.summaryMaxLength)
    .trim();
  if (summary) return summary;

  const rationale = asString(record['rationale'])
    ?.slice(0, MODEL_EVALUATION_LIMITS.summaryMaxLength)
    .trim();
  if (rationale) return rationale;

  const fallbackPoint = positives[0] ?? negatives[0];
  if (fallbackPoint) return fallbackPoint;

  throw new ModelEvaluationResponseError(
    'The evaluation field "summary" must be a non-empty string.',
  );
}

/** Parses one profile result before batch-level identity checks run. */
function profileEvaluation(value: unknown): ProfileModelAssessment {
  const record = asRecord(value);
  if (!record) {
    throw new ModelEvaluationResponseError(
      'Each evaluation must be an object.',
    );
  }

  const parsedPositives = points(
    record['positives'],
    MODEL_EVALUATION_LIMITS.positivesPerProfile,
  );
  const parsedNegatives = points(
    record['negatives'],
    MODEL_EVALUATION_LIMITS.negativesPerProfile,
  );
  // Some replies file the age and compensation estimates inside
  // `imageAssessment` instead of beside it, because the photo is what they
  // reasoned from. The values are the profile-level ones that were asked for,
  // so read them one level down when the top level omitted them.
  const nested = asRecord(record['imageAssessment']);
  const parsedAge = estimatedAge(
    record['estimatedAge'] ?? nested?.['estimatedAge'],
  );
  const parsedImage = imageAssessment(record['imageAssessment']);

  return {
    profileId: requiredString(record['profileId'], 'profileId'),
    matchPercent: matchPercent(record['matchPercent']),
    estimatedTotalMonthlyCompensation: estimatedTotalMonthlyCompensation(
      record['estimatedTotalMonthlyCompensation'] ??
        nested?.['estimatedTotalMonthlyCompensation'],
    ),
    positives: parsedPositives,
    negatives: parsedNegatives,
    summary: summaryText(record, parsedPositives, parsedNegatives),
    ...(parsedAge ? { estimatedAge: parsedAge } : {}),
    ...(parsedImage ? { imageAssessment: parsedImage } : {}),
  };
}

/** Accepted confidence values on an age estimate. */
const AGE_CONFIDENCES: readonly EstimatedAgeConfidence[] = [
  'high',
  'medium',
  'low',
  'unknown',
];

/**
 * Validates the age range, keeping the interval ordered and bounded.
 *
 * A reversed or absurdly wide range means the model did not follow the range
 * rule, so it is dropped rather than stored as if it were a real estimate.
 */
function estimatedAge(value: unknown): EstimatedAge | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const minimumAge = record['minimumAge'];
  const maximumAge = record['maximumAge'];
  const confidence = asString(record['confidence']);

  if (
    typeof minimumAge !== 'number' ||
    typeof maximumAge !== 'number' ||
    !Number.isInteger(minimumAge) ||
    !Number.isInteger(maximumAge) ||
    minimumAge < MODEL_EVALUATION_LIMITS.ageMinimum ||
    maximumAge > MODEL_EVALUATION_LIMITS.ageMaximum ||
    minimumAge > maximumAge ||
    maximumAge - minimumAge > MODEL_EVALUATION_LIMITS.ageRangeMaximumSpanYears
  ) {
    return undefined;
  }

  if (
    !confidence ||
    !AGE_CONFIDENCES.includes(confidence as EstimatedAgeConfidence)
  ) {
    return undefined;
  }

  return {
    minimumAge,
    maximumAge,
    confidence: confidence as EstimatedAgeConfidence,
    basis: stringList(
      record['basis'],
      'estimatedAge.basis',
      MODEL_EVALUATION_LIMITS.ageBasisItems,
      0,
    ),
  };
}

/**
 * Validates one image assessment, dropping it whole when a field is unusable.
 *
 * The assessment is advisory: it annotates the review UI and never changes a
 * score, so a malformed one is discarded instead of failing the whole profile.
 */
function imageAssessment(value: unknown): ModelImageAssessment | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const booleans = ['hasFace', 'isBlurry', 'isPoorlyLit', 'reviewRequired'] as const;
  for (const field of booleans) {
    if (typeof record[field] !== 'boolean') return undefined;
  }

  const faceCount = record['faceCount'];
  if (typeof faceCount !== 'number' || !Number.isInteger(faceCount) || faceCount < 0) {
    return undefined;
  }

  const enums = {
    faceVisibility: ['clear', 'partial', 'unclear', 'not_applicable'],
    imageQuality: ['good', 'usable', 'poor'],
    photoType: [
      'professional_portrait',
      'selfie',
      'mirror_selfie',
      'group_photo',
      'other',
    ],
    framing: ['headshot', 'upper_body', 'full_body', 'unclear'],
    background: ['plain', 'workplace', 'outdoor', 'domestic', 'other', 'unclear'],
    attire: ['formal', 'business_casual', 'casual', 'unclear'],
  } as const;

  for (const [field, accepted] of Object.entries(enums)) {
    const parsed = asString(record[field]);
    if (!parsed || !(accepted as readonly string[]).includes(parsed)) {
      return undefined;
    }
  }

  return {
    hasFace: record['hasFace'] as boolean,
    faceCount,
    faceVisibility: record['faceVisibility'] as ModelImageAssessment['faceVisibility'],
    imageQuality: record['imageQuality'] as ModelImageAssessment['imageQuality'],
    isBlurry: record['isBlurry'] as boolean,
    isPoorlyLit: record['isPoorlyLit'] as boolean,
    photoType: record['photoType'] as ModelImageAssessment['photoType'],
    framing: record['framing'] as ModelImageAssessment['framing'],
    background: record['background'] as ModelImageAssessment['background'],
    attire: record['attire'] as ModelImageAssessment['attire'],
    reviewRequired: record['reviewRequired'] as boolean,
    observations: stringList(
      record['observations'],
      'imageAssessment.observations',
      MODEL_EVALUATION_LIMITS.imageObservationItems,
      0,
    ),
  };
}

/** A fenced ``` or ```json block wrapping an otherwise valid reply. */
const MARKDOWN_CODE_FENCE = /^\s*```(?:json)?\s*\r?\n([\s\S]*?)\r?\n?\s*```\s*$/;

/**
 * Removes a markdown code fence some providers wrap around structured replies.
 *
 * The fenced payload is still the model's real answer, so unwrapping it keeps a
 * paid batch instead of discarding it over formatting.
 */
function stripCodeFence(text: string): string {
  return MARKDOWN_CODE_FENCE.exec(text)?.[1]?.trim() ?? text;
}

/** Parses response JSON and reports malformed text as a permanent failure. */
function responseJson(text: string): unknown {
  try {
    return JSON.parse(stripCodeFence(text)) as unknown;
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
  // Some providers name the batch array "results" or "profiles". The rows
  // inside are still the scored profiles, so accept the aliases rather than
  // discarding a whole batch over the envelope's key.
  const values =
    response?.['evaluations'] ?? response?.['results'] ?? response?.['profiles'];

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
