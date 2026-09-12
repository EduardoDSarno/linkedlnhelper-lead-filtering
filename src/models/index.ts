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

export { DEFAULT_OPENROUTER_THINKING_EFFORT } from './model_client.js';
export type {
  ThinkingEffort,
  ModelPart,
  ModelTokenUsage,
  ModelRequest,
  ModelResponse,
  ModelClient,
} from './model_client.js';

export {
  DEFAULT_OPENROUTER_MAX_COMPLETION_PRICE,
  DEFAULT_OPENROUTER_MODEL,
  OPENROUTER_MAX_COMPLETION_PRICE_ENVIRONMENT_KEY,
  OPENROUTER_MAX_PROMPT_PRICE_ENVIRONMENT_KEY,
  OPENROUTER_MODEL_ENVIRONMENT_KEY,
  OPENROUTER_THINKING_EFFORT_ENVIRONMENT_KEY,
  THINKING_EFFORT_CHOICES,
  resolveOpenRouterMaxPrice,
  resolveProviderModelId,
  resolveThinkingEffort,
  resolveThinkingEffortChoice,
} from './model_provider.js';

