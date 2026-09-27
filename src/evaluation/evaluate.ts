import type { EvaluationBatchContext, EvaluationProfileData } from './context.js';
import { evaluateProfilesWithModel } from './model/index.js';
import type {
  ModelEvaluationOptions,
  ModelEvaluationOutcome,
} from './model/index.js';
import {
  loadProfileImage,
  PROFILE_IMAGE_DOWNLOAD,
} from './photos/index.js';
import { errorMessage } from '../shared/helpers/index.js';
import { PIPELINE_PROGRESS_MESSAGE } from '../shared/logging/index.js';
import type { Logger } from '../shared/logging/index.js';

/** One profile whose photo could not be downloaded for the model request. */
export interface ProfilePhotoLoadFailure {
  readonly profileId: string;
  readonly error: string;
}

/** The model's results for one evaluation run. */
export interface EvaluationRunResult {
  readonly modelEvaluation: ModelEvaluationOutcome;
  /** Profiles evaluated on text alone because their photo would not load. */
  readonly photoLoadFailures: readonly ProfilePhotoLoadFailure[];
}

/** Options controlling how profile photos reach the evaluation request. */
interface EvaluationPhotoOptions {
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
 * Restates a profile whose photo could not be fetched as one without a photo.
 *
 * `hasPhoto` is derived when the profile is mapped, from a URL recorded at
 * collection time. LinkedIn signs those URLs with an expiry roughly two weeks
 * out, so by evaluation the address can be dead while the field still reads
 * true. The model would then be told a photo exists and handed no image, and
 * `requirePhoto` would rank the profile as though it had one.
 *
 * Dropping the photo fields here keeps the description the model reads in
 * agreement with what it was actually sent. The profile itself is still
 * evaluated: an unreachable photo is a gap in the evidence, not grounds to
 * discard the candidate.
 */
function withoutUnreachablePhoto(
  profile: EvaluationProfileData,
): EvaluationProfileData {
  const {
    photoConfirmedByProvider: _confirmed,
    photoUrl: _photoUrl,
    ...rest
  } = profile;

  return { ...rest, hasPhoto: false };
}

/**
 * Downloads each profile's photo and attaches the bytes for the model request.
 *
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
  const results = [...profiles];
  const failures: ProfilePhotoLoadFailure[] = [];
  const concurrency = Math.max(
    1,
    options.concurrency ?? DEFAULT_PHOTO_LOAD_CONCURRENCY,
  );
  let nextIndex = 0;
  let completed = 0;

  /** Claims and downloads photos until the shared queue is empty. */
  async function worker(): Promise<void> {
    while (nextIndex < profiles.length) {
      const index = nextIndex;
      nextIndex += 1;
      const profile = profiles[index];
      if (!profile?.photoUrl) continue;

      try {
        const photo = await load(
          profile.photoUrl,
          {
            downloadTimeoutMs: PROFILE_IMAGE_DOWNLOAD.timeoutMs,
            maximumBytes: PROFILE_IMAGE_DOWNLOAD.maximumBytes,
          },
        );
        results[index] = { ...profile, photo };
      } catch (error: unknown) {
        failures.push({
          profileId: profile.profileId,
          error: errorMessage(error),
        });
        results[index] = withoutUnreachablePhoto(profile);
      }

      // Reported as it goes rather than only at the end: a few hundred
      // downloads is long enough that a caller watching progress would
      // otherwise see this stage sit still and then finish all at once.
      completed += 1;
      options.logger?.info(
        { completed, total: withPhotoUrl },
        PIPELINE_PROGRESS_MESSAGE.photoLoadProgress,
      );
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
 * Loads photos, then requests a fit evaluation for every profile.
 *
 * Every campaign criterion is judged by the model from the customer's own
 * description, so no profile is dropped before it. The model stage isolates
 * request-group failures, so one bad group never costs the others.
 */
export async function evaluateProfiles(
  context: EvaluationBatchContext,
  options: ModelEvaluationOptions = {},
  photoOptions: EvaluationPhotoOptions = {},
): Promise<EvaluationRunResult> {
  const withPhotos = await attachProfilePhotos(context.profiles, photoOptions);
  const modelEvaluation = await evaluateProfilesWithModel(
    withPhotos.profiles,
    context.criteria,
    options,
  );

  return {
    modelEvaluation,
    photoLoadFailures: withPhotos.failures,
  };
}
