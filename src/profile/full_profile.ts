import type { ProfileImageExtractionResult } from '../image_extractor/index.js';
import type { Profile } from './apify_profile.js';

/**
 * Complete application-facing profile after optional image analysis.
 *
 * The normalized Apify profile remains the source of identity, employment,
 * education, and the original photo URL. `imageAnalysis` is added only after
 * the photo has been successfully processed by the image extractor.
 */
export interface FullProfile extends Profile {
  imageAnalysis?: ProfileImageExtractionResult;
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
