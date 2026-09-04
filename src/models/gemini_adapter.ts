import {
  createPartFromBase64,
  PartMediaResolutionLevel,
  ThinkingLevel,
} from '@google/genai';
import type { GenerateContentParameters, Part } from '@google/genai';

import {
  generateContentWithGemini,
  mapGeminiTokenUsage,
} from './gemini_client.js';
import type { GeminiContentGenerator } from './gemini_client.js';
import {
  DEFAULT_IMAGE_RESOLUTION,
  DEFAULT_THINKING_EFFORT,
  MODEL_RETRY_HTTP_STATUS_CODES,
} from './model_client.js';
import type {
  ImageResolution,
  ModelClient,
  ModelPart,
  ModelRequest,
  ModelResponse,
  ThinkingEffort,
} from './model_client.js';

/** Structured replies are always requested as JSON from every Gemini stage. */
const GEMINI_JSON_MIME_TYPE = 'application/json';

/**
 * SDK attempts per adapter call. Eval already retries at the app layer, so the
 * SDK must not retry the same request again.
 */
const GEMINI_SDK_ATTEMPTS_PER_CALL = 1;

/** Maps the provider-neutral thinking scale onto Gemini's enum. */
const GEMINI_THINKING_LEVEL: Readonly<Record<ThinkingEffort, ThinkingLevel>> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

/** Maps the provider-neutral image resolution onto Gemini media tokens. */
const GEMINI_MEDIA_RESOLUTION: Readonly<
  Record<ImageResolution, PartMediaResolutionLevel>
> = {
  low: PartMediaResolutionLevel.MEDIA_RESOLUTION_LOW,
  medium: PartMediaResolutionLevel.MEDIA_RESOLUTION_MEDIUM,
  high: PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH,
};

/**
 * Production Gemini client used by eval and image once those stages are rewired.
 *
 * Built from the shared SDK wrapper so credential lookup stays in one place.
 */
export const geminiModelClient: ModelClient = createGeminiModelClient();

/**
 * Builds a Gemini `ModelClient`, optionally replacing the SDK call so tests
 * never construct a real client or need an API key.
 */
export function createGeminiModelClient(
  generateContent: GeminiContentGenerator = generateContentWithGemini,
): ModelClient {
  return async function geminiModelClient(
    request: ModelRequest,
  ): Promise<ModelResponse> {
    const response = await generateContent(toGeminiParameters(request));
    const usage = mapGeminiTokenUsage(response);
    const blockReason = response.promptFeedback?.blockReason;

    return {
      text: response.text?.trim() ?? '',
      ...(usage ? { usage } : {}),
      ...(blockReason ? { blockReason: String(blockReason) } : {}),
    };
  };
}

/**
 * Translates a provider-neutral request into the Gemini SDK parameter object.
 *
 * Lives here so eval and image stop assembling Gemini-specific `contents` and
 * `config` themselves.
 */
function toGeminiParameters(request: ModelRequest): GenerateContentParameters {
  return {
    model: request.model,
    contents: request.parts.map(toGeminiPart),
    config: {
      ...(request.system ? { systemInstruction: request.system } : {}),
      thinkingConfig: {
        thinkingLevel:
          GEMINI_THINKING_LEVEL[request.thinking ?? DEFAULT_THINKING_EFFORT],
      },
      responseMimeType: GEMINI_JSON_MIME_TYPE,
      responseJsonSchema: request.jsonSchema,
      httpOptions: {
        timeout: request.timeoutMs,
        retryOptions: {
          attempts: GEMINI_SDK_ATTEMPTS_PER_CALL,
          httpStatusCodes: [...MODEL_RETRY_HTTP_STATUS_CODES],
        },
      },
    },
  };
}

/** Converts one provider-neutral part into a Gemini content part. */
function toGeminiPart(part: ModelPart): Part {
  if ('text' in part) {
    return { text: part.text };
  }

  const resolution = part.image.resolution ?? DEFAULT_IMAGE_RESOLUTION;
  return createPartFromBase64(
    Buffer.from(part.image.data).toString('base64'),
    part.image.mimeType,
    GEMINI_MEDIA_RESOLUTION[resolution],
  );
}
