import { readFile } from 'node:fs/promises';

import { asRecord, asString } from '../../helpers/index.js';
import { CRITERIA_MATCH } from '../filters/constants.js';
import {
  MODEL_APPROVAL_PERCENT,
  type AgeCriteria,
  type DesiredMonthlyCompensationCriteria,
  type FullEvaluationCriteria,
  type KeywordList,
  type LocationCriteria,
  type LocationField,
  type ModelApprovalCriteria,
  type NetWorthCriteria,
} from './user_criteria.js';

const FULL_CRITERIA_FIELDS = [
  'location',
  'keywordLists',
  'age',
  'desiredMonthlyCompensation',
  'netWorth',
  'modelApproval',
  'requirePhoto',
  'openToWork',
  'systemPrompt',
  'userPrompt',
] as const;
const LOCATION_FIELDS = [
  'text',
  'city',
  'state',
  'country',
  'countryCode',
] as const satisfies readonly LocationField[];
const LOCATION_CRITERIA_FIELDS = ['locations', 'fields', 'match'] as const;
const KEYWORD_LIST_FIELDS = ['list', 'match'] as const;
const AGE_FIELDS = ['minimumAge', 'maximumAge'] as const;
const COMPENSATION_FIELDS = [
  'minimumMonthlyCompensation',
  'maximumMonthlyCompensation',
] as const;
const NET_WORTH_FIELDS = ['minimumNetWorth', 'maximumNetWorth'] as const;
const MODEL_APPROVAL_FIELDS = ['enabled', 'minimumMatchPercent'] as const;
const MINIMUM_RANGE_VALUE = 0;

/** Identifies criteria JSON that cannot be trusted as application input. */
export class EvaluationCriteriaFileError extends Error {
  /** Creates a criteria validation failure with a user-facing message. */
  constructor(message: string) {
    super(message);
    this.name = 'EvaluationCriteriaFileError';
  }
}

/** Rejects misspelled or unsupported properties before they are ignored. */
function assertKnownFields(
  record: Record<string, unknown>,
  allowedFields: readonly string[],
  context: string,
): void {
  const allowed = new Set(allowedFields);
  const unexpected = Object.keys(record).filter((field) => !allowed.has(field));

  if (unexpected.length > 0) {
    throw new EvaluationCriteriaFileError(
      `${context} contains unsupported fields: ${unexpected.join(', ')}.`,
    );
  }
}

/** Requires an object for a nested criteria section. */
function criteriaRecord(value: unknown, field: string): Record<string, unknown> {
  const record = asRecord(value);
  if (record) return record;

  throw new EvaluationCriteriaFileError(`${field} must be an object.`);
}

/** Requires a non-empty string and returns its trimmed representation. */
function requiredString(value: unknown, field: string): string {
  const result = asString(value);
  if (result) return result;

  throw new EvaluationCriteriaFileError(
    `${field} must be a non-empty string.`,
  );
}

/** Parses an optional string while rejecting an explicitly unusable value. */
function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

/** Parses a string collection without silently dropping invalid entries. */
function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new EvaluationCriteriaFileError(`${field} must be an array.`);
  }

  return value.map((item, index) =>
    requiredString(item, `${field}[${String(index)}]`),
  );
}

/** Parses one required location or keyword match mode. */
function criteriaMatch(value: unknown, field: string): LocationCriteria['match'] {
  if (value === CRITERIA_MATCH.any || value === CRITERIA_MATCH.all) {
    return value;
  }

  throw new EvaluationCriteriaFileError(`${field} must be "any" or "all".`);
}

/** Parses an optional boolean without coercing strings or numbers. */
function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;

  throw new EvaluationCriteriaFileError(`${field} must be a boolean.`);
}

/** Parses an optional non-negative integer used by criteria boundaries. */
function optionalBoundary(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MINIMUM_RANGE_VALUE
  ) {
    return value;
  }

  throw new EvaluationCriteriaFileError(
    `${field} must be a non-negative integer.`,
  );
}

/** Rejects an inverted pair of optional range boundaries. */
function assertOrderedRange(
  minimum: number | undefined,
  maximum: number | undefined,
  field: string,
): void {
  if (minimum !== undefined && maximum !== undefined && maximum < minimum) {
    throw new EvaluationCriteriaFileError(`${field} cannot be inverted.`);
  }
}

/** Parses the optional deterministic location criterion. */
function locationCriteria(value: unknown): LocationCriteria {
  const record = criteriaRecord(value, 'location');
  assertKnownFields(record, LOCATION_CRITERIA_FIELDS, 'location');
  const fields = stringList(record['fields'], 'location.fields');

  for (const field of fields) {
    if (!(LOCATION_FIELDS as readonly string[]).includes(field)) {
      throw new EvaluationCriteriaFileError(
        `location.fields contains unsupported field "${field}".`,
      );
    }
  }

  return {
    locations: stringList(record['locations'], 'location.locations'),
    fields: fields as LocationField[],
    match: criteriaMatch(record['match'], 'location.match'),
  };
}

/** Parses one optional collection of deterministic keyword reject lists. */
function keywordLists(value: unknown): KeywordList[] {
  if (!Array.isArray(value)) {
    throw new EvaluationCriteriaFileError('keywordLists must be an array.');
  }

  return value.map((item, index) => {
    const field = `keywordLists[${String(index)}]`;
    const record = criteriaRecord(item, field);
    assertKnownFields(record, KEYWORD_LIST_FIELDS, field);
    const list =
      record['list'] === undefined
        ? undefined
        : stringList(record['list'], `${field}.list`);

    return {
      ...(list === undefined ? {} : { list }),
      match: criteriaMatch(record['match'], `${field}.match`),
    };
  });
}

/** Parses an age range used by deterministic and model-assisted evaluation. */
function ageCriteria(value: unknown, field = 'age'): AgeCriteria {
  const record = criteriaRecord(value, field);
  assertKnownFields(record, AGE_FIELDS, field);
  const minimumAge = optionalBoundary(record['minimumAge'], `${field}.minimumAge`);
  const maximumAge = optionalBoundary(record['maximumAge'], `${field}.maximumAge`);
  assertOrderedRange(minimumAge, maximumAge, field);
  return {
    ...(minimumAge === undefined ? {} : { minimumAge }),
    ...(maximumAge === undefined ? {} : { maximumAge }),
  };
}

/** Parses one desired total-monthly-compensation range. */
function compensationCriteria(
  value: unknown,
  field = 'desiredMonthlyCompensation',
): DesiredMonthlyCompensationCriteria {
  const record = criteriaRecord(value, field);
  assertKnownFields(record, COMPENSATION_FIELDS, field);
  const minimumMonthlyCompensation = optionalBoundary(
    record['minimumMonthlyCompensation'],
    `${field}.minimumMonthlyCompensation`,
  );
  const maximumMonthlyCompensation = optionalBoundary(
    record['maximumMonthlyCompensation'],
    `${field}.maximumMonthlyCompensation`,
  );
  assertOrderedRange(
    minimumMonthlyCompensation,
    maximumMonthlyCompensation,
    field,
  );
  return {
    ...(minimumMonthlyCompensation === undefined
      ? {}
      : { minimumMonthlyCompensation }),
    ...(maximumMonthlyCompensation === undefined
      ? {}
      : { maximumMonthlyCompensation }),
  };
}

/** Parses an optional net-worth range retained for criteria compatibility. */
function netWorthCriteria(value: unknown): NetWorthCriteria {
  const record = criteriaRecord(value, 'netWorth');
  assertKnownFields(record, NET_WORTH_FIELDS, 'netWorth');
  const minimumNetWorth = optionalBoundary(
    record['minimumNetWorth'],
    'netWorth.minimumNetWorth',
  );
  const maximumNetWorth = optionalBoundary(
    record['maximumNetWorth'],
    'netWorth.maximumNetWorth',
  );
  assertOrderedRange(minimumNetWorth, maximumNetWorth, 'netWorth');
  return {
    ...(minimumNetWorth === undefined ? {} : { minimumNetWorth }),
    ...(maximumNetWorth === undefined ? {} : { maximumNetWorth }),
  };
}

/** Parses whether the model may return final approval decisions. */
function modelApprovalCriteria(value: unknown): ModelApprovalCriteria {
  const record = criteriaRecord(value, 'modelApproval');
  assertKnownFields(record, MODEL_APPROVAL_FIELDS, 'modelApproval');
  const enabled = optionalBoolean(record['enabled'], 'modelApproval.enabled');
  const minimumMatchPercent = optionalBoundary(
    record['minimumMatchPercent'],
    'modelApproval.minimumMatchPercent',
  );

  if (enabled === undefined || minimumMatchPercent === undefined) {
    throw new EvaluationCriteriaFileError(
      'modelApproval requires enabled and minimumMatchPercent.',
    );
  }
  if (minimumMatchPercent > MODEL_APPROVAL_PERCENT.maximum) {
    throw new EvaluationCriteriaFileError(
      `modelApproval.minimumMatchPercent must not exceed ${String(MODEL_APPROVAL_PERCENT.maximum)}.`,
    );
  }

  return { enabled, minimumMatchPercent };
}

/** Validates untrusted JSON as the criteria accepted by the review pipeline. */
export function parseFullEvaluationCriteria(
  value: unknown,
): FullEvaluationCriteria {
  const record = criteriaRecord(value, 'Evaluation criteria');
  assertKnownFields(record, FULL_CRITERIA_FIELDS, 'Evaluation criteria');
  const userPrompt = optionalString(record['userPrompt'], 'userPrompt');
  const requirePhoto = optionalBoolean(record['requirePhoto'], 'requirePhoto');
  const openToWork = optionalBoolean(record['openToWork'], 'openToWork');

  return {
    systemPrompt: requiredString(record['systemPrompt'], 'systemPrompt'),
    ...(userPrompt === undefined ? {} : { userPrompt }),
    ...(record['location'] === undefined
      ? {}
      : { location: locationCriteria(record['location']) }),
    ...(record['keywordLists'] === undefined
      ? {}
      : { keywordLists: keywordLists(record['keywordLists']) }),
    ...(record['age'] === undefined
      ? {}
      : { age: ageCriteria(record['age']) }),
    ...(record['desiredMonthlyCompensation'] === undefined
      ? {}
      : {
          desiredMonthlyCompensation: compensationCriteria(
            record['desiredMonthlyCompensation'],
          ),
        }),
    ...(record['netWorth'] === undefined
      ? {}
      : { netWorth: netWorthCriteria(record['netWorth']) }),
    ...(record['modelApproval'] === undefined
      ? {}
      : { modelApproval: modelApprovalCriteria(record['modelApproval']) }),
    ...(requirePhoto === undefined ? {} : { requirePhoto }),
    ...(openToWork === undefined ? {} : { openToWork }),
  };
}

/** Reads and validates one criteria JSON file before any paid work begins. */
export async function loadFullEvaluationCriteria(
  path: string,
): Promise<FullEvaluationCriteria> {
  const text = await readFile(path, 'utf8');

  try {
    return parseFullEvaluationCriteria(JSON.parse(text) as unknown);
  } catch (error: unknown) {
    if (error instanceof EvaluationCriteriaFileError) throw error;
    throw new EvaluationCriteriaFileError(
      `Could not parse evaluation criteria JSON at ${path}.`,
    );
  }
}
