import type { Profile } from './apify_profile.js';

/**
 * Complete application-facing profile.
 *
 * The normalized Apify profile remains the source of identity, employment,
 * education, and the original photo URL. The photo itself is read at
 * evaluation time and sent to the model, so no assessment is stored here.
 */
export interface FullProfile extends Profile {
  /** Exact `public_id` received from the originating Linked Helper CSV row. */
  linkedHelperPublicId?: string;
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

