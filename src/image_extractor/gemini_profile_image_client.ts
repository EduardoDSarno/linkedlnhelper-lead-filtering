import {
  createPartFromBase64,
  PartMediaResolutionLevel,
  ThinkingLevel,
} from '@google/genai';
import type { GenerateContentResponse } from '@google/genai';

import {
  generateContentWithGemini,
  mapGeminiTokenUsage,
} from '../models/index.js';
import type {
  GeminiContentGenerator,
  GeminiTokenUsage,
} from '../models/index.js';
import { GEMINI_IMAGE_RETRY_POLICY } from './config.js';
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

const MEDIA_RESOLUTION: Readonly<
  Record<ProfileImageResolution, PartMediaResolutionLevel>
> = {
  low: PartMediaResolutionLevel.MEDIA_RESOLUTION_LOW,
  medium: PartMediaResolutionLevel.MEDIA_RESOLUTION_MEDIUM,
  high: PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH,
};

/**
 * The single SDK call this module needs.
 *
 * Injecting the call rather than the whole `GoogleGenAI` client keeps the test
 * boundary as narrow as possible: a test supplies one function and never
 * constructs a client, so no API key is required and the memoized production
 * client is never created.
 */
export interface GeminiProfileImageRequest {
  image: LoadedProfileImage;
  model: string;
  resolution: ProfileImageResolution;
  timeoutMs: number;
  maxRetries: number;

  /**
   * Performs the model call. Production omits this and gets the shared Gemini
   * client; tests supply a stand-in so no Gemini request is ever made.
   */
  generateContent?: GeminiContentGenerator;
}

export interface GeminiProfileImageResponse {
  text: string;
  usage?: GeminiTokenUsage;
}

/**
 * A Gemini response that arrived but could not be used.
 *
 * Gemini bills for the tokens it read even when it declines to answer, so a
 * blocked or truncated response is a real cost with nothing to show for it.
 * Carrying `usage` on the error is what lets the batch and pipeline layers
 * report that spend instead of losing it.
 *
 * `usage` is absent when the model call itself failed, because no response
 * reached us and no token count exists to report.
 */
export class GeminiImageError extends Error {
  readonly usage: GeminiTokenUsage | undefined;

  /** Creates a failed assessment while retaining any usage the model reported. */
  constructor(message: string, usage?: GeminiTokenUsage) {
    super(message);
    this.name = 'GeminiImageError';
    this.usage = usage;
  }
}

/** Extracts usable response text or reports why Gemini produced none. */
function getResponseText(
  response: GenerateContentResponse,
  usage: GeminiTokenUsage | undefined,
): string {
  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason) {
    throw new GeminiImageError(
      `Gemini blocked the image request: ${blockReason}.`,
      usage,
    );
  }

  const text = response.text?.trim();
  if (text) return text;

  const finishReason = response.candidates?.[0]?.finishReason;
  throw new GeminiImageError(
    finishReason
      ? `Gemini returned no assessment (${finishReason}).`
      : 'Gemini returned no image assessment.',
    usage,
  );
}

/**
 * Sends one loaded image to Gemini and returns its raw assessment text.
 *
 * Retries are configured here but performed by the SDK; `maxRetries` is a retry
 * budget, so the SDK receives `maxRetries + 1` total attempts.
 *
 * @param request - Image, model, resolution, timeout, retry budget, and an
 * optional model call to use instead of the shared client.
 * @returns The response text and any token usage Gemini reported.
 * @throws {GeminiImageError} When a response arrived but was blocked or empty;
 * it carries the tokens that response was billed for. Failures of the model
 * call itself propagate unchanged, because no response and no usage exists.
 */
export async function recognizeProfileImageWithGemini(
  request: GeminiProfileImageRequest,
): Promise<GeminiProfileImageResponse> {
  const generateContent =
    request.generateContent ?? generateContentWithGemini;
  const response = await generateContent({
    model: request.model,
    contents: [
      { text: IMAGE_ASSESSMENT_PROMPT },
      createPartFromBase64(
        Buffer.from(request.image.data).toString('base64'),
        request.image.mimeType,
        MEDIA_RESOLUTION[request.resolution],
      ),
    ],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
      responseMimeType: 'application/json',
      responseJsonSchema: PROFILE_IMAGE_ASSESSMENT_JSON_SCHEMA,
      httpOptions: {
        timeout: request.timeoutMs,
        retryOptions: {
          attempts: request.maxRetries + 1,
          initialDelay: GEMINI_IMAGE_RETRY_POLICY.initialDelaySeconds,
          maxDelay: GEMINI_IMAGE_RETRY_POLICY.maximumDelaySeconds,
          httpStatusCodes: [...GEMINI_IMAGE_RETRY_POLICY.httpStatusCodes],
        },
      },
    },
  });
  const usage = mapGeminiTokenUsage(response);

  return {
    text: getResponseText(response, usage),
    ...(usage ? { usage } : {}),
  };
}
