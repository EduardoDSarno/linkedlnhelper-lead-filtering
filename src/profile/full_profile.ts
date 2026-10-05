import type { Profile } from './profile.js';

/**
 * Complete application-facing profile.
 *
 * Built from one Linked Helper CSV row. The photo itself is read at
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

