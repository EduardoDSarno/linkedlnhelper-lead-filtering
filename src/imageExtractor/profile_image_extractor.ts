import type { Profile } from '../profile/index.js';
import {
  resolveProfileImageBatchConcurrency,
  resolveProfileImageExtractionOptions,
} from './config.js';
import {
  GeminiImageError,
  recognizeProfileImageWithGemini,
} from './gemini_profile_image_client.js';
import { parseProfileImageAssessment } from './profile_image_assessment.js';
import { loadProfileImage } from './profile_image_loader.js';
import type {
  GeminiTokenUsage,
  ProfileImageBatchOptions,
  ProfileImageExtractionOptions,
  ProfileImageExtractionResult,
  ProfileImageJob,
  ProfileImageJobResult,
  ProfileImageSource,
} from './profile_image_types.js';

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
  const resolved = resolveProfileImageExtractionOptions(options);
  const image = await loadProfileImage(source, {
    downloadTimeoutMs: resolved.imageDownloadTimeoutMs,
    maximumBytes: resolved.maxImageBytes,
  });
  const response = await recognizeProfileImageWithGemini({
    image,
    model: resolved.model,
    resolution: resolved.resolution,
    timeoutMs: resolved.requestTimeoutMs,
    maxRetries: resolved.maxRetries,
    ...(options.generateContent
      ? { generateContent: options.generateContent }
      : {}),
  });

  let assessment;
  try {
    assessment = parseProfileImageAssessment(response.text);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new GeminiImageError(message, response.usage);
  }

  return {
    assessment,
    model: resolved.model,
    resolution: resolved.resolution,
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
 * Processes one profile image. Production supplies {@link extractProfileImage};
 * tests supply a stand-in so a batch can be exercised without Gemini.
 */
export type ProfileImageExecutor = (
  source: ProfileImageSource,
  options: ProfileImageExtractionOptions,
) => Promise<ProfileImageExtractionResult>;

/**
 * Reads the tokens Gemini billed before refusing an image, when it reported
 * any. Only {@link GeminiImageError} carries them; a download or network
 * failure has no response and therefore no usage to report.
 */
function usageFromFailure(error: unknown): GeminiTokenUsage | undefined {
  return error instanceof GeminiImageError ? error.usage : undefined;
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
  return extractProfileImagesWithExecutor(jobs, extractProfileImage, options);
}

/**
 * Runs a batch against an injected per-image executor.
 *
 * A fixed pool of `concurrency` workers pulls from a shared job index, so slow
 * images never leave workers idle and no more than `concurrency` requests are
 * ever in flight. Each job's error is captured into its own result rather than
 * thrown, which is what stops one bad image from cancelling the rest.
 */
export async function extractProfileImagesWithExecutor(
  jobs: readonly ProfileImageJob[],
  executor: ProfileImageExecutor,
  options: ProfileImageBatchOptions = {},
): Promise<ProfileImageJobResult[]> {
  const { concurrency: requestedConcurrency, ...extractionOptions } = options;

  // A non-finite request carries no usable value, so it is treated the same as
  // omitting one. Clamping it instead would leave NaN intact all the way to the
  // worker count, and Array.from({ length: NaN }) starts no workers at all,
  // silently returning empty slots for every job.
  const concurrency = resolveProfileImageBatchConcurrency(requestedConcurrency);
  const results = new Array<ProfileImageJobResult>(jobs.length);
  let nextJobIndex = 0;

  /** Claims and processes jobs until the shared batch queue is empty. */
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
          result: await executor(job.source, extractionOptions),
        };
      } catch (error: unknown) {
        const usage = usageFromFailure(error);
        results[jobIndex] = {
          id: job.id,
          status: 'rejected',
          error: error instanceof Error ? error.message : String(error),
          ...(usage ? { usage } : {}),
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
