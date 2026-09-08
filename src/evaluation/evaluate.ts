import type { EvaluationBatchContext, EvaluationProfileData } from './context.js';
import { filterEvaluationBatch } from './filters/broad_filter.js';
import type { BroadFilterBatchResult } from './filters/types.js';
import { evaluateProfilesWithModel } from './model/index.js';
import type {
  ModelEvaluationOptions,
  ModelEvaluationOutcome,
} from './model/index.js';
import {
  loadProfileImage,
  resolveProfileImageExtractionOptions,
} from '../imageExtractor/index.js';
import { errorMessage } from '../helpers/index.js';
import { PIPELINE_PROGRESS_MESSAGE } from '../logging/index.js';
import type { Logger } from '../logging/index.js';

/** One profile whose photo could not be downloaded for the model request. */
export interface ProfilePhotoLoadFailure {
  readonly profileId: string;
  readonly error: string;
}

/** The deterministic and model-assisted results of one evaluation run. */
export interface EvaluationRunResult {
  readonly broadFilter: BroadFilterBatchResult;
  readonly modelEvaluation: ModelEvaluationOutcome;
  /** Profiles evaluated on text alone because their photo would not load. */
  readonly photoLoadFailures: readonly ProfilePhotoLoadFailure[];
}

/** Options controlling how profile photos reach the evaluation request. */
export interface EvaluationPhotoOptions {
  /** Skips downloading photos entirely; the model then sees text only. */
  skipPhotos?: boolean;
  /** Structured logger, used to report download progress. */
  logger?: Logger;
  /** Photos downloaded at once. */
  concurrency?: number;
  /** Injected loader so tests never contact a real image URL. */
  loadPhoto?: typeof loadProfileImage;
}

/** Photos downloaded at once when the caller does not choose a limit. */
const DEFAULT_PHOTO_LOAD_CONCURRENCY = 25;

/**
 * Downloads each profile's photo and attaches the bytes for the model request.
 *
 * Runs after the broad filter so an excluded profile never costs a download.
 * A failed download is never fatal: that profile keeps its text and is
 * evaluated without an image, because losing one photo is a far smaller loss
 * than dropping the profile from a paid request.
 */
async function attachProfilePhotos(
  profiles: readonly EvaluationProfileData[],
  options: EvaluationPhotoOptions,
): Promise<{
  profiles: EvaluationProfileData[];
  failures: ProfilePhotoLoadFailure[];
}> {
  if (options.skipPhotos) {
    return { profiles: [...profiles], failures: [] };
  }

  const withPhotoUrl = profiles.filter((profile) => profile.photoUrl).length;
  options.logger?.info(
    { photos: withPhotoUrl, profiles: profiles.length },
    PIPELINE_PROGRESS_MESSAGE.photoLoadStarted,
  );

  const load = options.loadPhoto ?? loadProfileImage;
  const loadingOptions = resolveProfileImageExtractionOptions();
  const results = [...profiles];
  const failures: ProfilePhotoLoadFailure[] = [];
  const concurrency = Math.max(
    1,
    options.concurrency ?? DEFAULT_PHOTO_LOAD_CONCURRENCY,
  );
  let nextIndex = 0;

  /** Claims and downloads photos until the shared queue is empty. */
  async function worker(): Promise<void> {
    while (nextIndex < profiles.length) {
      const index = nextIndex;
      nextIndex += 1;
      const profile = profiles[index];
      if (!profile?.photoUrl) continue;

      try {
        const photo = await load(
          { kind: 'url', url: profile.photoUrl },
          {
            downloadTimeoutMs: loadingOptions.imageDownloadTimeoutMs,
            maximumBytes: loadingOptions.maxImageBytes,
          },
        );
        results[index] = { ...profile, photo };
      } catch (error: unknown) {
        failures.push({
          profileId: profile.profileId,
          error: errorMessage(error),
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, profiles.length) }, worker),
  );

  options.logger?.info(
    { photos: withPhotoUrl, failures: failures.length },
    PIPELINE_PROGRESS_MESSAGE.photoLoadCompleted,
  );

  return { profiles: results, failures };
}

/**
 * Runs deterministic exclusions, loads photos, then requests fit evaluations.
 *
 * Profiles already excluded by the photo cut never consume model tokens or a
 * photo download. The model stage isolates request-group failures and
 * preserves every broad result regardless of downstream availability.
 */
export async function evaluateProfiles(
  context: EvaluationBatchContext,
  options: ModelEvaluationOptions = {},
  photoOptions: EvaluationPhotoOptions = {},
): Promise<EvaluationRunResult> {
  const broadFilter = filterEvaluationBatch(context);
  const withPhotos = await attachProfilePhotos(
    broadFilter.profilesForAi,
    photoOptions,
  );
  const modelEvaluation = await evaluateProfilesWithModel(
    withPhotos.profiles,
    context.criteria,
    options,
  );

  return {
    broadFilter,
    modelEvaluation,
    photoLoadFailures: withPhotos.failures,
  };
}
