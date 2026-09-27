/**
 * Limits on downloading one profile photo for the evaluation request.
 *
 * A photo is supporting evidence, not a requirement: a download that is too
 * slow or too large is abandoned and the profile is evaluated on its text,
 * rather than holding up the model request it belongs to.
 */
export const PROFILE_IMAGE_DOWNLOAD = {
  timeoutMs: 15_000,
  maximumBytes: 10 * 1024 * 1024,
} as const;
