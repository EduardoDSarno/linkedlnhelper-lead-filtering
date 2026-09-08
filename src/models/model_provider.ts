import type { ThinkingEffort } from './model_client.js';
import {
  DEFAULT_OPENROUTER_THINKING_EFFORT,
  THINKING_EFFORTS,
} from './model_client.js';

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

/**
 * Used when OPENROUTER_MODEL is blank.
 *
 * Flash is the vision-capable GLM id; the non-flash GLM id is text-only.
 */
export const DEFAULT_OPENROUTER_MODEL = 'z-ai/glm-5.3-flash';

/**
 * Picks the model id every stage uses.
 *
 * A caller override always wins; otherwise one env serves every stage.
 */
export function resolveProviderModelId(
  callerModel: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return (
    callerModel?.trim() ||
    environment[OPENROUTER_MODEL_ENVIRONMENT_KEY]?.trim() ||
    DEFAULT_OPENROUTER_MODEL
  );
}

/** Reads OpenRouter thinking effort, falling back to high when the env is blank. */
export function resolveThinkingEffort(
  environment: NodeJS.ProcessEnv = process.env,
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

/**
 * Maps a UI thinking choice onto a provider effort.
 *
 * Blank or "default" keeps the env fallback. "max" forces max. Unknown values
 * fail so a typo cannot silently keep the fallback.
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

/** Returns whether a string is one of the supported thinking-effort names. */
function isThinkingEffort(value: string): value is ThinkingEffort {
  return (THINKING_EFFORTS as readonly string[]).includes(value);
}
