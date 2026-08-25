import type {
  ProfileImageExtractionOptions,
  ProfileImageResolution,
} from './profile_image_types.js';
import {
  CONFIG_NUMBER_MINIMUMS,
  resolveConfigNumber,
} from '../helpers/index.js';

/** Environment variables this module reads when caller options are absent. */
const ENVIRONMENT_KEYS = {
  model: 'GEMINI_MODEL',
  resolution: 'IMAGE_ANALYSIS_RESOLUTION',
  requestTimeoutMs: 'GEMINI_REQUEST_TIMEOUT_MS',
} as const;

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

/**
 * Resolves untrusted extraction options into values safe for downloads and the
 * Gemini SDK. The optional injected model call remains outside this result.
 */
export function resolveProfileImageResolution(
  value: unknown,
): ProfileImageResolution {
  return typeof value === 'string' &&
    ['low', 'medium', 'high'].includes(value.trim())
    ? (value.trim() as ProfileImageResolution)
    : PROFILE_IMAGE_DEFAULTS.resolution;
}

export function resolveProfileImageExtractionOptions(
  options: ProfileImageExtractionOptions = {},
  environment: NodeJS.ProcessEnv = process.env,
): ResolvedProfileImageExtractionOptions {
  // Precedence for each setting: caller option, environment, module default.
  const model =
    options.model?.trim() ||
    environment[ENVIRONMENT_KEYS.model]?.trim() ||
    PROFILE_IMAGE_DEFAULTS.model;
  const resolution = resolveProfileImageResolution(
    options.resolution ?? environment[ENVIRONMENT_KEYS.resolution],
  );

  return {
    model,
    resolution,
    requestTimeoutMs: resolveConfigNumber(
      options.requestTimeoutMs ??
        environment[ENVIRONMENT_KEYS.requestTimeoutMs],
      {
        fallback: PROFILE_IMAGE_DEFAULTS.requestTimeoutMs,
        minimum: CONFIG_NUMBER_MINIMUMS.positive,
        integer: true,
      },
    ),
    imageDownloadTimeoutMs: resolveConfigNumber(
      options.imageDownloadTimeoutMs,
      {
        fallback: PROFILE_IMAGE_DEFAULTS.downloadTimeoutMs,
        minimum: CONFIG_NUMBER_MINIMUMS.positive,
        integer: true,
      },
    ),
    maxImageBytes: resolveConfigNumber(
      options.maxImageBytes,
      {
        fallback: PROFILE_IMAGE_DEFAULTS.maximumBytes,
        minimum: CONFIG_NUMBER_MINIMUMS.positive,
        integer: true,
      },
    ),
    maxRetries: resolveConfigNumber(
      options.maxRetries,
      {
        fallback: PROFILE_IMAGE_DEFAULTS.maxRetries,
        minimum: CONFIG_NUMBER_MINIMUMS.nonNegative,
        integer: true,
      },
    ),
  };
}

/** Resolves a batch worker count within the module's configured safety bound. */
export function resolveProfileImageBatchConcurrency(value: unknown): number {
  return resolveConfigNumber(value, {
    fallback: PROFILE_IMAGE_DEFAULTS.batchConcurrency,
    minimum: CONFIG_NUMBER_MINIMUMS.positive,
    maximum: PROFILE_IMAGE_LIMITS.batchConcurrency,
    integer: true,
    clampMinimum: true,
    clampMaximum: true,
  });
}
