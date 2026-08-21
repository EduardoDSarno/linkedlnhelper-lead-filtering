import {
  createPartFromBase64,
  GoogleGenAI,
  PartMediaResolutionLevel,
  ThinkingLevel,
} from '@google/genai';
import type { GenerateContentResponse } from '@google/genai';

import type { LoadedProfileImage } from './profile_image_loader.js';
import { PROFILE_IMAGE_ASSESSMENT_JSON_SCHEMA } from './profile_image_types.js';
import type {
  GeminiTokenUsage,
  ProfileImageResolution,
} from './profile_image_types.js';

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

export interface GeminiProfileImageRequest {
  image: LoadedProfileImage;
  model: string;
  resolution: ProfileImageResolution;
  timeoutMs: number;
  maxRetries: number;
}

export interface GeminiProfileImageResponse {
  text: string;
  usage?: GeminiTokenUsage;
}

let geminiClient: GoogleGenAI | undefined;

function getGeminiClient(): GoogleGenAI {
  if (geminiClient) return geminiClient;

  const apiKey = process.env['GEMINI_API_KEY']?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  geminiClient = new GoogleGenAI({ apiKey, apiVersion: 'v1beta' });
  return geminiClient;
}

function getResponseText(response: GenerateContentResponse): string {
  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason) {
    throw new Error(`Gemini blocked the image request: ${blockReason}.`);
  }

  const text = response.text?.trim();
  if (text) return text;

  const finishReason = response.candidates?.[0]?.finishReason;
  throw new Error(
    finishReason
      ? `Gemini returned no assessment (${finishReason}).`
      : 'Gemini returned no image assessment.',
  );
}

function mapTokenUsage(
  response: GenerateContentResponse,
): GeminiTokenUsage | undefined {
  const usage = response.usageMetadata;
  if (!usage) return undefined;

  return {
    ...(usage.promptTokenCount !== undefined
      ? { promptTokens: usage.promptTokenCount }
      : {}),
    ...(usage.candidatesTokenCount !== undefined
      ? { outputTokens: usage.candidatesTokenCount }
      : {}),
    ...(usage.thoughtsTokenCount !== undefined
      ? { thinkingTokens: usage.thoughtsTokenCount }
      : {}),
    ...(usage.totalTokenCount !== undefined
      ? { totalTokens: usage.totalTokenCount }
      : {}),
  };
}

export async function recognizeProfileImageWithGemini(
  request: GeminiProfileImageRequest,
): Promise<GeminiProfileImageResponse> {
  const response = await getGeminiClient().models.generateContent({
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
          initialDelay: 0.25,
          maxDelay: 4,
          httpStatusCodes: [408, 429, 500, 502, 503, 504],
        },
      },
    },
  });
  const usage = mapTokenUsage(response);

  return {
    text: getResponseText(response),
    ...(usage ? { usage } : {}),
  };
}
