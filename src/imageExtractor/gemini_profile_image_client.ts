import { DEFAULT_THINKING_EFFORT, resolveModelClient } from '../models/index.js';
import type {
  ModelClient,
  ModelResponse,
  ModelTokenUsage,
} from '../models/index.js';
import type { LoadedProfileImage } from './profile_image_loader.js';
import { PROFILE_IMAGE_ASSESSMENT_JSON_SCHEMA } from './profile_image_types.js';
import type { ProfileImageResolution } from './profile_image_types.js';

const IMAGE_ASSESSMENT_PROMPT = `
Analyze this profile image using only directly visible, neutral properties.

Classify image composition and technical usability.

Also report an apparent age bracket in "apparentAge":
- Judge only from visible facial appearance. Ignore attire, background, image
  style, photo age and any impression of professional seniority.
- Choose one of the provided brackets. Never state an exact age.
- Use the "unknown" bracket with "unassessable" confidence whenever no face is
  visible, the face is too unclear to judge, or the subject is not a person.

Use "reviewRequired": true whenever the image is ambiguous, unassessable, or
the requested categories cannot be determined confidently. Keep observations
brief, factual, and limited to composition and image quality. Do not mention
age, or any other personal characteristic, in "observations".
`.trim();

/**
 * The single model call this module needs.
 *
 * Injecting the call rather than a provider client keeps the test boundary
 * narrow: a test supplies one function and never constructs a client, so no
 * API key is required and the memoized production client is never created.
 */
export interface GeminiProfileImageRequest {
  image: LoadedProfileImage;
  model: string;
  resolution: ProfileImageResolution;
  timeoutMs: number;
  /**
   * Caller-facing retry budget. Not forwarded on `ModelRequest` yet; the
   * Gemini adapter still uses its own single-attempt SDK policy.
   */
  maxRetries: number;

  /**
   * Performs the model call. Production omits this and gets the configured
   * provider adapter; tests supply a stand-in so no provider request is ever made.
   */
  generateContent?: ModelClient;
}

export interface GeminiProfileImageResponse {
  text: string;
  usage?: ModelTokenUsage;
}

/**
 * A model response that arrived but could not be used.
 *
 * Providers bill for the tokens they read even when they decline to answer, so
 * a blocked or empty response is a real cost with nothing to show for it.
 * Carrying `usage` on the error is what lets the batch and pipeline layers
 * report that spend instead of losing it.
 *
 * `usage` is absent when the model call itself failed, because no response
 * reached us and no token count exists to report.
 */
export class GeminiImageError extends Error {
  readonly usage: ModelTokenUsage | undefined;

  /** Creates a failed assessment while retaining any usage the model reported. */
  constructor(message: string, usage?: ModelTokenUsage) {
    super(message);
    this.name = 'GeminiImageError';
    this.usage = usage;
  }
}

/**
 * Sends one loaded image through the model client and returns its raw
 * assessment text.
 *
 * @param request - Image, model, resolution, timeout, and an optional model
 * call to use instead of the configured provider adapter.
 * @returns The response text and any token usage the model reported.
 * @throws {GeminiImageError} When a response arrived but was blocked or empty;
 * it carries the tokens that response was billed for. Failures of the model
 * call itself propagate unchanged, because no response and no usage exists.
 */
export async function recognizeProfileImageWithGemini(
  request: GeminiProfileImageRequest,
): Promise<GeminiProfileImageResponse> {
  const generateContent = request.generateContent ?? resolveModelClient();
  const response = await generateContent({
    model: request.model,
    parts: [
      { text: IMAGE_ASSESSMENT_PROMPT },
      {
        image: {
          data: request.image.data,
          mimeType: request.image.mimeType,
          resolution: request.resolution,
        },
      },
    ],
    jsonSchema: PROFILE_IMAGE_ASSESSMENT_JSON_SCHEMA,
    thinking: DEFAULT_THINKING_EFFORT,
    timeoutMs: request.timeoutMs,
  });
  const usage = response.usage;

  return {
    text: getResponseText(response, usage),
    ...(usage ? { usage } : {}),
  };
}

/** Extracts usable response text or reports why the model produced none. */
function getResponseText(
  response: ModelResponse,
  usage: ModelTokenUsage | undefined,
): string {
  if (response.blockReason) {
    throw new GeminiImageError(
      `The model blocked the image request: ${response.blockReason}.`,
      usage,
    );
  }

  const text = response.text.trim();
  if (text) return text;

  throw new GeminiImageError(
    'The model returned no image assessment.',
    usage,
  );
}
