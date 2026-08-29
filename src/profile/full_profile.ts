import type { ProfileImageExtractionResult } from '../imageExtractor/index.js';
import type { Profile } from './apify_profile.js';

/**
 * Complete application-facing profile after optional image analysis.
 *
 * The normalized Apify profile remains the source of identity, employment,
 * education, and the original photo URL. `imageAnalysis` is added only after
 * the photo has been successfully processed by the image extractor.
 */
export interface FullProfile extends Profile {
  /** Exact `public_id` received from the originating Linked Helper CSV row. */
  linkedHelperPublicId?: string;

  imageAnalysis?: ProfileImageExtractionResult;
}

/** Attaches the source CSV identity used to correlate evaluation results. */
export function attachLinkedHelperPublicId(
  profile: Profile,
  linkedHelperPublicId: string,
): FullProfile {
  return {
    ...profile,
    linkedHelperPublicId,
  };
}

/** Returns a new full profile without mutating the normalized profile. */
export function attachProfileImageAnalysis(
  profile: Profile,
  imageAnalysis: ProfileImageExtractionResult,
): FullProfile {
  return {
    ...profile,
    imageAnalysis,
  };
}
