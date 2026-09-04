import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_MODEL_PROVIDER,
  DEFAULT_OPENROUTER_MODEL,
  MODEL_PROVIDER_ENVIRONMENT_KEY,
  MODEL_PROVIDERS,
  OPENROUTER_MODEL_ENVIRONMENT_KEY,
  geminiModelClient,
  openRouterModelClient,
  resolveModelClient,
  resolveModelProvider,
  resolveProviderModelId,
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
