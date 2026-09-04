import { geminiModelClient } from './gemini_adapter.js';
import type { ModelClient } from './model_client.js';
import { openRouterModelClient } from './openrouter_adapter.js';

/** Environment variable that selects the production model adapter. */
export const MODEL_PROVIDER_ENVIRONMENT_KEY = 'MODEL_PROVIDER';

/** Environment variable that supplies the OpenRouter model id for every stage. */
export const OPENROUTER_MODEL_ENVIRONMENT_KEY = 'OPENROUTER_MODEL';

/** Supported production model APIs. */
export const MODEL_PROVIDERS = {
  gemini: 'gemini',
  openrouter: 'openrouter',
} as const;

/** One of the supported production model APIs. */
export type ModelProvider =
  (typeof MODEL_PROVIDERS)[keyof typeof MODEL_PROVIDERS];

/** Used when MODEL_PROVIDER is blank so existing Gemini runs stay unchanged. */
export const DEFAULT_MODEL_PROVIDER: ModelProvider = MODEL_PROVIDERS.gemini;

/**
 * Used when MODEL_PROVIDER is OpenRouter and OPENROUTER_MODEL is blank.
 *
 * Flash is the vision-capable GLM id; the non-flash GLM id is text-only.
 */
export const DEFAULT_OPENROUTER_MODEL = 'z-ai/glm-5.3-flash';

/** Inputs used to pick a model id for the active provider. */
export interface ProviderModelIdInput {
  callerModel?: string | undefined;
  geminiEnvironmentModel?: string | undefined;
  geminiDefault: string;
}

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

/**
 * Picks the model id for the active provider.
 *
 * A caller override always wins. OpenRouter uses one env for every stage.
 * Gemini keeps the existing per-stage env and default so current `.env` files
 * keep working.
 */
export function resolveProviderModelId(
  input: ProviderModelIdInput,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const callerModel = input.callerModel?.trim();
  if (callerModel) return callerModel;

  if (resolveModelProvider(environment) === MODEL_PROVIDERS.openrouter) {
    return resolveOpenRouterModelId(environment);
  }

  return input.geminiEnvironmentModel?.trim() || input.geminiDefault;
}

/**
 * Reads MODEL_PROVIDER and returns a supported API name.
 *
 * Blank means Gemini. Any other unknown value fails immediately so a typo
 * cannot silently keep sending traffic to the wrong API.
 */
export function resolveModelProvider(
  environment: NodeJS.ProcessEnv = process.env,
): ModelProvider {
  const raw = environment[MODEL_PROVIDER_ENVIRONMENT_KEY]?.trim().toLowerCase();
  if (!raw) return DEFAULT_MODEL_PROVIDER;

  if (raw === MODEL_PROVIDERS.gemini || raw === MODEL_PROVIDERS.openrouter) {
    return raw;
  }

  throw new Error(
    `${MODEL_PROVIDER_ENVIRONMENT_KEY} must be "${MODEL_PROVIDERS.gemini}" or "${MODEL_PROVIDERS.openrouter}", got "${raw}".`,
  );
}

/** Returns the shared OpenRouter model id, falling back to the configured default. */
function resolveOpenRouterModelId(environment: NodeJS.ProcessEnv): string {
  return (
    environment[OPENROUTER_MODEL_ENVIRONMENT_KEY]?.trim() ||
    DEFAULT_OPENROUTER_MODEL
  );
}
