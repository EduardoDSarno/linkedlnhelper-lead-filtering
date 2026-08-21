import type { Profile } from '../profile/index.js';
import { recognizeProfileImageWithGemini } from './gemini_profile_image_client.js';
import { parseProfileImageAssessment } from './profile_image_assessment.js';
import { loadProfileImage } from './profile_image_loader.js';
import type {
  ProfileImageBatchOptions,
  ProfileImageExtractionOptions,
  ProfileImageExtractionResult,
  ProfileImageJob,
  ProfileImageJobResult,
  ProfileImageResolution,
  ProfileImageSource,
} from './profile_image_types.js';

const DEFAULT_MODEL = 'gemini-3.7-flash';
const DEFAULT_RESOLUTION: ProfileImageResolution = 'medium';
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_IMAGE_DOWNLOAD_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BATCH_CONCURRENCY = 25;
const MAX_BATCH_CONCURRENCY = 50;

/**
 * Classifies one profile image using Gemini 3.7 Flash.
 *
 * The result intentionally contains mostly observable composition and quality
 * fields. It must not be used as an automated candidate-fit decision.
 */
export async function extractProfileImage(
  source: ProfileImageSource,
  options: ProfileImageExtractionOptions = {},
): Promise<ProfileImageExtractionResult> {
  const model = options.model ?? DEFAULT_MODEL;
  const resolution = options.resolution ?? DEFAULT_RESOLUTION;
  const image = await loadProfileImage(source, {
    downloadTimeoutMs:
      options.imageDownloadTimeoutMs ?? DEFAULT_IMAGE_DOWNLOAD_TIMEOUT_MS,
    maximumBytes: options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
  });
  const response = await recognizeProfileImageWithGemini({
    image,
    model,
    resolution,
    timeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    maxRetries: Math.max(
      0,
      Math.floor(options.maxRetries ?? DEFAULT_MAX_RETRIES),
    ),
  });

  return {
    assessment: parseProfileImageAssessment(response.text),
    model,
    resolution,
    ...(response.usage ? { usage: response.usage } : {}),
  };
}

/** Extracts the photo already present on a normalized Apify profile. */
export async function extractProfilePhoto(
  profile: Pick<Profile, 'photo'>,
  options: ProfileImageExtractionOptions = {},
): Promise<ProfileImageExtractionResult> {
  if (!profile.photo) {
    throw new Error('The profile does not have a photo URL.');
  }

  return extractProfileImage({ kind: 'url', url: profile.photo }, options);
}

/**
 * Processes a large set with bounded parallelism and preserves input order.
 * Individual failures are returned alongside successes instead of cancelling
 * the remaining profile images.
 */
export async function extractProfileImages(
  jobs: readonly ProfileImageJob[],
  options: ProfileImageBatchOptions = {},
): Promise<ProfileImageJobResult[]> {
  const { concurrency: requestedConcurrency, ...extractionOptions } = options;
  const concurrency = Math.max(
    1,
    Math.min(
      MAX_BATCH_CONCURRENCY,
      Math.floor(requestedConcurrency ?? DEFAULT_BATCH_CONCURRENCY),
    ),
  );
  const results = new Array<ProfileImageJobResult>(jobs.length);
  let nextJobIndex = 0;

  async function worker(): Promise<void> {
    while (nextJobIndex < jobs.length) {
      const jobIndex = nextJobIndex;
      nextJobIndex += 1;
      const job = jobs[jobIndex];

      if (!job) continue;

      try {
        results[jobIndex] = {
          id: job.id,
          status: 'fulfilled',
          result: await extractProfileImage(job.source, extractionOptions),
        };
      } catch (error: unknown) {
        results[jobIndex] = {
          id: job.id,
          status: 'rejected',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, jobs.length) },
      async () => worker(),
    ),
  );

  return results;
}
