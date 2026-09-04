import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_MODEL_PROVIDER,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_OPENROUTER_THINKING_EFFORT,
  DEFAULT_THINKING_EFFORT,
  MODEL_PROVIDER_ENVIRONMENT_KEY,
  MODEL_PROVIDERS,
  OPENROUTER_MODEL_ENVIRONMENT_KEY,
  OPENROUTER_THINKING_EFFORT_ENVIRONMENT_KEY,
  THINKING_EFFORT_CHOICES,
  geminiModelClient,
  openRouterModelClient,
  resolveModelClient,
  resolveModelProvider,
  resolveProviderModelId,
  resolveThinkingEffort,
  resolveThinkingEffortChoice,
} from '../index.js';

const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
const GEMINI_ENVIRONMENT_MODEL = 'gemini-from-env';
const OPENROUTER_ENVIRONMENT_MODEL = 'openrouter/test-model';
const CALLER_MODEL = 'caller-override-model';

/** Builds the Gemini-stage inputs used by every model-id test. */
function geminiStageInput(
  overrides: Partial<Parameters<typeof resolveProviderModelId>[0]> = {},
) {
  return {
    geminiEnvironmentModel: GEMINI_ENVIRONMENT_MODEL,
    geminiDefault: GEMINI_DEFAULT_MODEL,
    ...overrides,
  };
}

test('defaults a blank provider to Gemini', () => {
  assert.equal(resolveModelProvider({}), DEFAULT_MODEL_PROVIDER);
  assert.equal(
    resolveModelProvider({ [MODEL_PROVIDER_ENVIRONMENT_KEY]: '   ' }),
    MODEL_PROVIDERS.gemini,
  );
});

test('accepts either supported provider name, ignoring case', () => {
  assert.equal(
    resolveModelProvider({ [MODEL_PROVIDER_ENVIRONMENT_KEY]: 'Gemini' }),
    MODEL_PROVIDERS.gemini,
  );
  assert.equal(
    resolveModelProvider({ [MODEL_PROVIDER_ENVIRONMENT_KEY]: 'OpenRouter' }),
    MODEL_PROVIDERS.openrouter,
  );
});

test('rejects an unknown provider instead of guessing', () => {
  assert.throws(
    () =>
      resolveModelProvider({ [MODEL_PROVIDER_ENVIRONMENT_KEY]: 'anthropic' }),
    /MODEL_PROVIDER must be "gemini" or "openrouter"/,
  );
});

test('returns the Gemini adapter until OpenRouter is selected', () => {
  assert.equal(resolveModelClient({}), geminiModelClient);
  assert.equal(
    resolveModelClient({ [MODEL_PROVIDER_ENVIRONMENT_KEY]: 'openrouter' }),
    openRouterModelClient,
  );
});

test('lets a caller model override every environment model', () => {
  assert.equal(
    resolveProviderModelId(geminiStageInput({ callerModel: `  ${CALLER_MODEL}  ` }), {
      [MODEL_PROVIDER_ENVIRONMENT_KEY]: 'openrouter',
      [OPENROUTER_MODEL_ENVIRONMENT_KEY]: OPENROUTER_ENVIRONMENT_MODEL,
    }),
    CALLER_MODEL,
  );
});

test('uses the Gemini stage env and default while Gemini is selected', () => {
  assert.equal(
    resolveProviderModelId(geminiStageInput(), {}),
    GEMINI_ENVIRONMENT_MODEL,
  );
  assert.equal(
    resolveProviderModelId(geminiStageInput({ geminiEnvironmentModel: '  ' }), {}),
    GEMINI_DEFAULT_MODEL,
  );
});

test('uses one OpenRouter model for every stage', () => {
  const environment = {
    [MODEL_PROVIDER_ENVIRONMENT_KEY]: 'openrouter',
    [OPENROUTER_MODEL_ENVIRONMENT_KEY]: OPENROUTER_ENVIRONMENT_MODEL,
  };

  assert.equal(
    resolveProviderModelId(geminiStageInput(), environment),
    OPENROUTER_ENVIRONMENT_MODEL,
  );
  assert.equal(
    resolveProviderModelId({ geminiDefault: GEMINI_DEFAULT_MODEL }, environment),
    OPENROUTER_ENVIRONMENT_MODEL,
  );
});

test('falls back to the configured OpenRouter default when that env is blank', () => {
  assert.equal(
    resolveProviderModelId(geminiStageInput(), {
      [MODEL_PROVIDER_ENVIRONMENT_KEY]: 'openrouter',
    }),
    DEFAULT_OPENROUTER_MODEL,
  );
});

test('keeps Gemini thinking at medium until OpenRouter is selected', () => {
  assert.equal(resolveThinkingEffort({}), DEFAULT_THINKING_EFFORT);
  assert.equal(
    resolveThinkingEffort({ [MODEL_PROVIDER_ENVIRONMENT_KEY]: 'gemini' }),
    DEFAULT_THINKING_EFFORT,
  );
});

test('defaults OpenRouter thinking to high when the env is blank', () => {
  assert.equal(
    resolveThinkingEffort({ [MODEL_PROVIDER_ENVIRONMENT_KEY]: 'openrouter' }),
    DEFAULT_OPENROUTER_THINKING_EFFORT,
  );
  assert.equal(
    resolveThinkingEffort({
      [MODEL_PROVIDER_ENVIRONMENT_KEY]: 'openrouter',
      [OPENROUTER_THINKING_EFFORT_ENVIRONMENT_KEY]: '   ',
    }),
    DEFAULT_OPENROUTER_THINKING_EFFORT,
  );
});

test('reads OpenRouter thinking effort from the environment', () => {
  assert.equal(
    resolveThinkingEffort({
      [MODEL_PROVIDER_ENVIRONMENT_KEY]: 'openrouter',
      [OPENROUTER_THINKING_EFFORT_ENVIRONMENT_KEY]: 'Max',
    }),
    'max',
  );
});

test('rejects an unknown OpenRouter thinking effort', () => {
  assert.throws(
    () =>
      resolveThinkingEffort({
        [MODEL_PROVIDER_ENVIRONMENT_KEY]: 'openrouter',
        [OPENROUTER_THINKING_EFFORT_ENVIRONMENT_KEY]: 'turbo',
      }),
    /OPENROUTER_MODEL_THINKING_EFFORT must be/,
  );
});

test('maps a UI thinking choice onto provider effort', () => {
  assert.equal(resolveThinkingEffortChoice(), DEFAULT_THINKING_EFFORT);
  assert.equal(
    resolveThinkingEffortChoice(THINKING_EFFORT_CHOICES.default, {
      [MODEL_PROVIDER_ENVIRONMENT_KEY]: 'openrouter',
    }),
    DEFAULT_OPENROUTER_THINKING_EFFORT,
  );
  assert.equal(
    resolveThinkingEffortChoice(THINKING_EFFORT_CHOICES.max, {
      [MODEL_PROVIDER_ENVIRONMENT_KEY]: 'gemini',
    }),
    'max',
  );
});

test('rejects an unknown UI thinking choice', () => {
  assert.throws(
    () => resolveThinkingEffortChoice('turbo'),
    /thinkingEffort must be "default" or "max"/,
  );
});
