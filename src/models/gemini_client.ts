import { GoogleGenAI } from '@google/genai';
import type {
  GenerateContentParameters,
  GenerateContentResponse,
} from '@google/genai';

const GOOGLE_AI_DEFAULT_API_VERSION = 'v1beta';

/** Token counts reported by Gemini for one model response. */
export interface GeminiTokenUsage {
  promptTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  totalTokens?: number;
}

/** The narrow Gemini SDK operation injected into domain-level tests. */
export type GeminiContentGenerator = (
  parameters: GenerateContentParameters,
) => Promise<GenerateContentResponse>;

/** A cached SDK client and the credential it was created with. */
interface CachedGeminiClient {
  client: GoogleGenAI;
  apiKey: string;
}

let cachedClient: CachedGeminiClient | undefined;

/** Returns the shared Gemini API key used by every model request. */
function getGeminiApiKey(): string {
  const apiKey = process.env['GEMINI_API_KEY']?.trim();

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  return apiKey;
}

/**
 * Returns the shared Gemini client, rebuilding it when the API key changes.
 *
 * The environment is read on every access so credential rotation takes effect
 * without requiring a process restart.
 */
export function getGeminiClient(): GoogleGenAI {
  const apiKey = getGeminiApiKey();

  if (cachedClient?.apiKey === apiKey) return cachedClient.client;

  cachedClient = {
    apiKey,
    client: new GoogleGenAI({
      apiKey,
      apiVersion: GOOGLE_AI_DEFAULT_API_VERSION,
    }),
  };

  return cachedClient.client;
}

/** Sends one generic content request through the shared production client. */
export async function generateContentWithGemini(
  parameters: GenerateContentParameters,
): Promise<GenerateContentResponse> {
  return getGeminiClient().models.generateContent(parameters);
}

/** Maps optional SDK usage metadata into the application's stable shape. */
export function mapGeminiTokenUsage(
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
