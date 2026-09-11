import type { ModelClient } from './model_client.js';
import { openRouterModelClient } from './openrouter_adapter.js';

/**
 * Returns the production `ModelClient`.
 *
 * Eval and image call this as their default so both stages share one client.
 * Tests keep injecting their own client and never reach this function.
 */
export function resolveModelClient(
  _environment: NodeJS.ProcessEnv = process.env,
): ModelClient {
  return openRouterModelClient;
}

export {
  createOpenRouterModelClient,
  openRouterModelClient,
} from './openrouter_adapter.js';
export type { OpenRouterChatSender } from './openrouter_adapter.js';

export {
  DEFAULT_IMAGE_RESOLUTION,
  DEFAULT_OPENROUTER_THINKING_EFFORT,
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
  DEFAULT_OPENROUTER_MAX_COMPLETION_PRICE,
  DEFAULT_OPENROUTER_MAX_PROMPT_PRICE,
  DEFAULT_OPENROUTER_MODEL,
  OPENROUTER_MAX_COMPLETION_PRICE_ENVIRONMENT_KEY,
  OPENROUTER_MAX_PROMPT_PRICE_ENVIRONMENT_KEY,
  OPENROUTER_MODEL_ENVIRONMENT_KEY,
  OPENROUTER_PROVIDER_SORTS,
  OPENROUTER_PROVIDER_SORT_ENVIRONMENT_KEY,
  OPENROUTER_THINKING_EFFORT_ENVIRONMENT_KEY,
  THINKING_EFFORT_CHOICES,
  DEFAULT_OPENROUTER_PROVIDER_SORT,
  resolveOpenRouterMaxPrice,
  resolveOpenRouterProviderSort,
  resolveProviderModelId,
  resolveThinkingEffort,
  resolveThinkingEffortChoice,
} from './model_provider.js';
export type {
  OpenRouterMaxPrice,
  OpenRouterProviderSort,
  ThinkingEffortChoice,
} from './model_provider.js';
