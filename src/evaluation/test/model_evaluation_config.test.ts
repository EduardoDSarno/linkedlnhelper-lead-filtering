import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_OPENROUTER_THINKING_EFFORT,
  DEFAULT_THINKING_EFFORT,
  MODEL_PROVIDER_ENVIRONMENT_KEY,
  OPENROUTER_MODEL_ENVIRONMENT_KEY,
  OPENROUTER_THINKING_EFFORT_ENVIRONMENT_KEY,
} from '../../models/index.js';
import {
  MODEL_EVALUATION_DEFAULTS,
  MODEL_EVALUATION_ENVIRONMENT_KEYS,
  resolveModelEvaluationOptions,
} from '../model/config.js';

test('uses the Gemini evaluation model until OpenRouter is selected', () => {
  assert.equal(
    resolveModelEvaluationOptions({}, {}).model,
    MODEL_EVALUATION_DEFAULTS.model,
  );
  assert.equal(
    resolveModelEvaluationOptions(
      {},
      { [MODEL_EVALUATION_ENVIRONMENT_KEYS.model]: 'gemini-from-env' },
    ).model,
    'gemini-from-env',
  );
});

test('uses the shared OpenRouter model when that provider is selected', () => {
  assert.equal(
    resolveModelEvaluationOptions(
      {},
      {
        [MODEL_PROVIDER_ENVIRONMENT_KEY]: 'openrouter',
        [OPENROUTER_MODEL_ENVIRONMENT_KEY]: 'openrouter/eval-model',
      },
    ).model,
    'openrouter/eval-model',
  );
  assert.equal(
    resolveModelEvaluationOptions(
      {},
      { [MODEL_PROVIDER_ENVIRONMENT_KEY]: 'openrouter' },
    ).model,
    DEFAULT_OPENROUTER_MODEL,
  );
});

test('resolves thinking effort from the selected provider', () => {
  assert.equal(
    resolveModelEvaluationOptions({}, {}).thinkingEffort,
    DEFAULT_THINKING_EFFORT,
  );
  assert.equal(
    resolveModelEvaluationOptions(
      {},
      { [MODEL_PROVIDER_ENVIRONMENT_KEY]: 'openrouter' },
    ).thinkingEffort,
    DEFAULT_OPENROUTER_THINKING_EFFORT,
  );
  assert.equal(
    resolveModelEvaluationOptions(
      {},
      {
        [MODEL_PROVIDER_ENVIRONMENT_KEY]: 'openrouter',
        [OPENROUTER_THINKING_EFFORT_ENVIRONMENT_KEY]: 'max',
      },
    ).thinkingEffort,
    'max',
  );
});

test('lets a caller thinking effort override the environment', () => {
  assert.equal(
    resolveModelEvaluationOptions(
      { thinkingEffort: 'low' },
      {
        [MODEL_PROVIDER_ENVIRONMENT_KEY]: 'openrouter',
        [OPENROUTER_THINKING_EFFORT_ENVIRONMENT_KEY]: 'max',
      },
    ).thinkingEffort,
    'low',
  );
});

test('lets a caller model override the selected provider model', () => {
  assert.equal(
    resolveModelEvaluationOptions(
      { model: ' caller-model ' },
      {
        [MODEL_PROVIDER_ENVIRONMENT_KEY]: 'openrouter',
        [OPENROUTER_MODEL_ENVIRONMENT_KEY]: 'openrouter/eval-model',
      },
    ).model,
    'caller-model',
  );
});
