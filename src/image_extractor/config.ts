import type {
  ProfileImageExtractionOptions,
  ProfileImageResolution,
} from './profile_image_types.js';

/** Defaults used when an image-extraction caller omits an option. */
export const PROFILE_IMAGE_DEFAULTS = {
  model: 'gemini-3.7-flash',
  resolution: 'medium' as ProfileImageResolution,
  requestTimeoutMs: 30_000,
  downloadTimeoutMs: 15_000,
  maximumBytes: 10 * 1024 * 1024,
  maxRetries: 3,
  batchConcurrency: 25,
} as const;

/** Safety ceilings and schema bounds shared by runtime code and validation. */
export const PROFILE_IMAGE_LIMITS = {
  batchConcurrency: 50,
  faceCount: 20,
  observationCount: 5,
} as const;

/** Retry policy passed to the Google Gen AI SDK. */
export const GEMINI_IMAGE_RETRY_POLICY = {
  initialDelaySeconds: 0.25,
  maximumDelaySeconds: 4,
  httpStatusCodes: [408, 429, 500, 502, 503, 504],
} as const;

/** Fully validated options used for one image extraction. */
export interface ResolvedProfileImageExtractionOptions {
  model: string;
  resolution: ProfileImageResolution;
  requestTimeoutMs: number;
  imageDownloadTimeoutMs: number;
  maxImageBytes: number;
  maxRetries: number;
}

/** Returns a positive integer or the supplied fallback. */
function positiveInteger(value: unknown, fallback: number): number {
  const numericValue = Number(value);
  const integerValue = Math.floor(numericValue);
  return Number.isFinite(numericValue) && integerValue > 0
    ? integerValue
    : fallback;
}

/** Returns a non-negative integer or the supplied fallback. */
function nonNegativeInteger(value: unknown, fallback: number): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0
    ? Math.floor(numericValue)
    : fallback;
}

/**
 * Resolves untrusted extraction options into values safe for downloads and the
 * Gemini SDK. The optional injected model call remains outside this result.
 */
export function resolveProfileImageExtractionOptions(
  options: ProfileImageExtractionOptions = {},
): ResolvedProfileImageExtractionOptions {
  const model = options.model?.trim() || PROFILE_IMAGE_DEFAULTS.model;
  const resolution = ['low', 'medium', 'high'].includes(
    options.resolution ?? '',
  )
    ? (options.resolution as ProfileImageResolution)
    : PROFILE_IMAGE_DEFAULTS.resolution;

  return {
    model,
    resolution,
    requestTimeoutMs: positiveInteger(
      options.requestTimeoutMs,
      PROFILE_IMAGE_DEFAULTS.requestTimeoutMs,
    ),
    imageDownloadTimeoutMs: positiveInteger(
      options.imageDownloadTimeoutMs,
      PROFILE_IMAGE_DEFAULTS.downloadTimeoutMs,
    ),
    maxImageBytes: positiveInteger(
      options.maxImageBytes,
      PROFILE_IMAGE_DEFAULTS.maximumBytes,
    ),
    maxRetries: nonNegativeInteger(
      options.maxRetries,
      PROFILE_IMAGE_DEFAULTS.maxRetries,
    ),
  };
}

/** Resolves a batch worker count within the module's configured safety bound. */
export function resolveProfileImageBatchConcurrency(value: unknown): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return PROFILE_IMAGE_DEFAULTS.batchConcurrency;
  }

  return Math.max(
    1,
    Math.min(Math.floor(numericValue), PROFILE_IMAGE_LIMITS.batchConcurrency),
  );
}
