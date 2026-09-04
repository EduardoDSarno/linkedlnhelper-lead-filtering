import { geminiModelClient } from './gemini_adapter.js';
import type { ModelClient, ThinkingEffort } from './model_client.js';
import {
  DEFAULT_OPENROUTER_THINKING_EFFORT,
  DEFAULT_THINKING_EFFORT,
  THINKING_EFFORTS,
} from './model_client.js';
import { openRouterModelClient } from './openrouter_adapter.js';

/** Environment variable that selects the production model adapter. */
export const MODEL_PROVIDER_ENVIRONMENT_KEY = 'MODEL_PROVIDER';

/** Environment variable that supplies the OpenRouter model id for every stage. */
export const OPENROUTER_MODEL_ENVIRONMENT_KEY = 'OPENROUTER_MODEL';

/** Environment variable that sets OpenRouter reasoning depth for every stage. */
export const OPENROUTER_THINKING_EFFORT_ENVIRONMENT_KEY =
  'OPENROUTER_MODEL_THINKING_EFFORT';

/**
 * Thinking depths the review UI may send. Default follows the provider env;
 * max forces the deepest supported effort.
 */
export const THINKING_EFFORT_CHOICES = {
  default: 'default',
  max: 'max',
} as const;

/** One thinking-effort choice accepted on POST /run_filter. */
export type ThinkingEffortChoice =
  (typeof THINKING_EFFORT_CHOICES)[keyof typeof THINKING_EFFORT_CHOICES];

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
 * Picks thinking depth for the active provider.
 *
 * OpenRouter reads OPENROUTER_MODEL_THINKING_EFFORT and falls back to high.
 * Gemini keeps the shared medium default so its existing runs stay unchanged.
 */
export function resolveThinkingEffort(
  environment: NodeJS.ProcessEnv = process.env,
): ThinkingEffort {
  if (resolveModelProvider(environment) !== MODEL_PROVIDERS.openrouter) {
    return DEFAULT_THINKING_EFFORT;
  }

  return resolveOpenRouterThinkingEffort(environment);
}

/**
 * Maps a UI thinking choice onto a provider effort.
 *
 * Blank or "default" keeps the env/provider fallback. "max" forces max.
 * Unknown values fail so a typo cannot silently keep the fallback.
 */
export function resolveThinkingEffortChoice(
  choice?: string,
  environment: NodeJS.ProcessEnv = process.env,
): ThinkingEffort {
  const raw = choice?.trim().toLowerCase();
  if (!raw || raw === THINKING_EFFORT_CHOICES.default) {
    return resolveThinkingEffort(environment);
  }
  if (raw === THINKING_EFFORT_CHOICES.max) {
    return 'max';
  }

  throw new Error(
    `thinkingEffort must be "${THINKING_EFFORT_CHOICES.default}" or "${THINKING_EFFORT_CHOICES.max}", got "${raw}".`,
  );
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

/** Reads OpenRouter thinking effort, falling back to high when the env is blank. */
function resolveOpenRouterThinkingEffort(
  environment: NodeJS.ProcessEnv,
): ThinkingEffort {
  const raw = environment[OPENROUTER_THINKING_EFFORT_ENVIRONMENT_KEY]
    ?.trim()
    .toLowerCase();
  if (!raw) return DEFAULT_OPENROUTER_THINKING_EFFORT;
  if (isThinkingEffort(raw)) return raw;

  throw new Error(
    `${OPENROUTER_THINKING_EFFORT_ENVIRONMENT_KEY} must be ${THINKING_EFFORTS.map((effort) => `"${effort}"`).join(', ')}, got "${raw}".`,
  );
}

/** Returns whether a string is one of the supported thinking-effort names. */
function isThinkingEffort(value: string): value is ThinkingEffort {
  return (THINKING_EFFORTS as readonly string[]).includes(value);
}
