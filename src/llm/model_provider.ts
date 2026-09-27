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

/** Environment variables that cap what a backend provider may charge. */
export const OPENROUTER_MAX_PROMPT_PRICE_ENVIRONMENT_KEY =
  'OPENROUTER_MAX_PROMPT_PRICE';
export const OPENROUTER_MAX_COMPLETION_PRICE_ENVIRONMENT_KEY =
  'OPENROUTER_MAX_COMPLETION_PRICE';

/**
 * Most a backend provider may charge, in USD per million tokens.
 *
 * One model is served by roughly 25 backends running the same weights at
 * prices spanning about 6x, and routing considered only speed, so nothing
 * stopped a request landing on the dearest of them. These defaults sit on the
 * price the large majority charge: the few outliers above it drop out, and
 * around fifteen candidates remain for the throughput sort to choose between.
 *
 * Deliberately a ceiling rather than a price sort. Sorting by price pins every
 * request to the single cheapest backend, and the cheapest here are also the
 * slowest and least available — and a set `sort` turns off load balancing, so
 * a whole batch would ride one budget backend's uptime.
 *
 * Strings because that is the shape OpenRouter's `max_price` takes.
 */
export const DEFAULT_OPENROUTER_MAX_PROMPT_PRICE = '0.15';
export const DEFAULT_OPENROUTER_MAX_COMPLETION_PRICE = '0.50';

/** A per-million-token price ceiling, as OpenRouter's `max_price` expects it. */
export interface OpenRouterMaxPrice {
  prompt: string;
  completion: string;
}

/**
 * Reads the per-million-token ceiling applied to every OpenRouter request.
 *
 * Lowering it narrows the field to cheaper backends; raising it widens the
 * field. A blank or unparseable value falls back to the default rather than
 * lifting the cap, so a typo cannot silently reopen routing to any price.
 */
export function resolveOpenRouterMaxPrice(
  environment: NodeJS.ProcessEnv = process.env,
): OpenRouterMaxPrice {
  return {
    prompt: priceOrDefault(
      environment[OPENROUTER_MAX_PROMPT_PRICE_ENVIRONMENT_KEY],
      DEFAULT_OPENROUTER_MAX_PROMPT_PRICE,
    ),
    completion: priceOrDefault(
      environment[OPENROUTER_MAX_COMPLETION_PRICE_ENVIRONMENT_KEY],
      DEFAULT_OPENROUTER_MAX_COMPLETION_PRICE,
    ),
  };
}

/** Keeps a configured price only when it reads as a non-negative number. */
function priceOrDefault(raw: string | undefined, fallback: string): string {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? trimmed : fallback;
}

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
