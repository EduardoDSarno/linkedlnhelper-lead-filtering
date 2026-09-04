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
  DEFAULT_THINKING_EFFORT,
  MODEL_RETRY_HTTP_STATUS_CODES,
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
  resolveModelClient,
  resolveModelProvider,
  resolveProviderModelId,
} from './model_provider.js';
export type {
  ModelProvider,
  ProviderModelIdInput,
} from './model_provider.js';
