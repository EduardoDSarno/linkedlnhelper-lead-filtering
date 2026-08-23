import {
  HTTP_BAD_REQUEST,
  HTTP_CLIENT_ERROR,
  HTTP_FORBIDDEN,
  HTTP_NOT_FOUND,
  HTTP_REQUEST_TIMEOUT,
  HTTP_SERVER_ERROR,
  HTTP_TOO_MANY_REQUESTS,
  HTTP_UNAUTHORIZED,
  HTTP_UNPROCESSABLE_ENTITY,
} from './constants.js';
import type {
  ApifyFailureCategory,
  ApifyProfileFailure,
  PendingProfile,
  RawApifyProfile,
} from './types.js';
import {
  isHttpNumberValue,
  isRecord,
  isStringValue,
} from '../../helpers/type_guards.js';

/**
 * A failure classified but not yet tied to a profile or a retry count. The
 * collector uses `retryable` to decide whether to schedule another round, then
 * turns the survivors into `ApifyProfileFailure` via `finalFailure`.
 */
export interface FailureDescriptor {
  category: ApifyFailureCategory;
  error: string;
  retryable: boolean;
  status?: number;
  raw?: RawApifyProfile;
}

/**
 * Reads an HTTP status out of a provider record, when the Actor put one there.
 */
export function providerStatus(record: RawApifyProfile): number | undefined {
  return isHttpNumberValue(record['status']);
}

/**
 * Reads an error message out of a provider record, when the Actor put one there.
 */
export function providerError(record: RawApifyProfile): string | undefined {
  return isStringValue(record['error']);
}

/**
 * Digs an HTTP status out of a thrown value. The Apify client is not consistent
 * about where it puts one, so the three known shapes are tried in order.
 */
export function statusFromThrownError(error: unknown): number | undefined {
  const errorRecord = isRecord(error);
  if (!errorRecord) return undefined;

  const response = isRecord(errorRecord['response']);
  return (
    isHttpNumberValue(errorRecord['statusCode']) ??
    isHttpNumberValue(errorRecord['status']) ??
    (response ? isHttpNumberValue(response['status']) : undefined)
  );
}

/**
 * Turns any thrown value into a message. Anything can be thrown in JavaScript,
 * not only an Error, so non-Error values are stringified rather than dropped.
 */
export function messageFromThrownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The single place that decides what a failure means. Maps an HTTP status and
 * message onto a category and, most importantly, whether retrying is worthwhile:
 * a bad key or a missing profile will fail identically forever, while a timeout,
 * a rate limit, or a 5xx usually will not. Everything else is assumed retryable,
 * so an unrecognized fault costs an extra attempt instead of a lost profile.
 */
export function classifyFailure(
  error: string,
  status?: number,
  raw?: RawApifyProfile,
): FailureDescriptor {
  const normalizedError = error.toLocaleLowerCase();

  if (status === HTTP_UNAUTHORIZED || status === HTTP_FORBIDDEN) {
    return {
      category: 'authentication',
      error,
      retryable: false,
      status,
      ...(raw ? { raw } : {}),
    };
  }

  if (status === HTTP_NOT_FOUND || normalizedError.includes('not found')) {
    return {
      category: 'not_found',
      error,
      retryable: false,
      ...(status !== undefined ? { status } : {}),
      ...(raw ? { raw } : {}),
    };
  }

  if (status === HTTP_BAD_REQUEST || status === HTTP_UNPROCESSABLE_ENTITY) {
    return {
      category: 'invalid_request',
      error,
      retryable: false,
      status,
      ...(raw ? { raw } : {}),
    };
  }

  if (status === HTTP_REQUEST_TIMEOUT || normalizedError.includes('timeout')) {
    return {
      category: 'timeout',
      error,
      retryable: true,
      ...(status !== undefined ? { status } : {}),
      ...(raw ? { raw } : {}),
    };
  }

  if (status === HTTP_TOO_MANY_REQUESTS) {
    return {
      category: 'rate_limited',
      error,
      retryable: true,
      status,
      ...(raw ? { raw } : {}),
    };
  }

  if (status !== undefined && status >= HTTP_SERVER_ERROR) {
    return {
      category: 'provider_unavailable',
      error,
      retryable: true,
      status,
      ...(raw ? { raw } : {}),
    };
  }

  return {
    category: raw ? 'unknown' : 'network',
    error,
    retryable: true,
    ...(status !== undefined ? { status } : {}),
    ...(raw ? { raw } : {}),
  };
}

/**
 * Inspects one record the Actor returned successfully and decides whether it is
 * actually a failure in disguise. A run can succeed at the HTTP level and still
 * hand back an error record, or a profile with no linkedinUrl that cannot be
 * matched back to its request. Returns undefined when the record is usable.
 */
export function classifyProviderRecord(
  record: RawApifyProfile,
): FailureDescriptor | undefined {
  const status = providerStatus(record);
  const error = providerError(record);

  if (error || (status !== undefined && status >= HTTP_CLIENT_ERROR)) {
    return classifyFailure(
      error ?? `Provider returned status ${String(status)}.`,
      status,
      record,
    );
  }

  if (!isStringValue(record['linkedinUrl'])) {
    return {
      category: 'invalid_response',
      error: 'Provider profile record is missing linkedinUrl.',
      retryable: true,
      ...(status !== undefined ? { status } : {}),
      raw: record,
    };
  }

  return undefined;
}

/**
 * Classifies a whole Actor run that threw, rather than a single record. No raw
 * record is passed on, which is what makes such failures land in the `network`
 * category instead of `unknown`.
 */
export function classifyThrownError(error: unknown): FailureDescriptor {
  return classifyFailure(
    messageFromThrownError(error),
    statusFromThrownError(error),
  );
}

/**
 * Builds the failure that is reported to the caller, joining a descriptor with
 * the profile it belongs to and how the retry budget was spent on it. Optional
 * fields are spread in only when present, because exactOptionalPropertyTypes
 * distinguishes an absent property from one explicitly set to undefined.
 */
export function finalFailure(
  profile: PendingProfile,
  descriptor: FailureDescriptor,
  attempts: number,
  retryExhausted: boolean,
): ApifyProfileFailure {
  return {
    linkedinUrl: profile.linkedinUrl,
    inputIndex: profile.inputIndex,
    category: descriptor.category,
    error: descriptor.error,
    attempts,
    retryable: descriptor.retryable,
    retryExhausted,
    ...(descriptor.status !== undefined ? { status: descriptor.status } : {}),
    ...(descriptor.raw ? { raw: descriptor.raw } : {}),
  };
}
