import { geminiModelClient } from './gemini_adapter.js';
import type { ModelClient } from './model_client.js';
import { MODEL_PROVIDERS, resolveModelProvider } from './model_provider.js';
import { openRouterModelClient } from './openrouter_adapter.js';

/**
 * Returns the production `ModelClient` for the configured provider.
 *
 * Eval and image call this as their default so both stages follow one switch.
 * Tests keep injecting their own client and never reach this function.
 */
export function resolveModelClient(
  environment: NodeJS.ProcessEnv = process.env,
): ModelClient {
  return resolveModelProvider(environment) === MODEL_PROVIDERS.openrouter
    ? openRouterModelClient
    : geminiModelClient;
}

export {
  createGeminiModelClient,
  geminiModelClient,
} from './gemini_adapter.js';
export {
  generateContentWithGemini,
  getGeminiClient,
  mapGeminiTokenUsage,
} from './gemini_client.js';
export type {
  GeminiContentGenerator,
  GeminiTokenUsage,
} from './gemini_client.js';
export {
  createOpenRouterModelClient,
  openRouterModelClient,
} from './openrouter_adapter.js';
export type { OpenRouterChatSender } from './openrouter_adapter.js';

export {
  DEFAULT_IMAGE_RESOLUTION,
  DEFAULT_OPENROUTER_THINKING_EFFORT,
  DEFAULT_THINKING_EFFORT,
  MODEL_RETRY_HTTP_STATUS_CODES,
  THINKING_EFFORTS,
} from './model_client.js';
export type {
  ImageResolution,
  ThinkingEffort,
  ModelPart,
  ModelTokenUsage,
  ModelRequest,
  ModelResponse,
  ModelClient,
} from './model_client.js';

export {
  DEFAULT_MODEL_PROVIDER,
  DEFAULT_OPENROUTER_MODEL,
  MODEL_PROVIDER_ENVIRONMENT_KEY,
  MODEL_PROVIDERS,
  OPENROUTER_MODEL_ENVIRONMENT_KEY,
  OPENROUTER_THINKING_EFFORT_ENVIRONMENT_KEY,
  THINKING_EFFORT_CHOICES,
  resolveModelProvider,
  resolveProviderModelId,
  resolveThinkingEffort,
  resolveThinkingEffortChoice,
} from './model_provider.js';
export type {
  ModelProvider,
  ProviderModelIdInput,
  ThinkingEffortChoice,
} from './model_provider.js';
