import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_OPENROUTER_THINKING_EFFORT,
  OPENROUTER_MODEL_ENVIRONMENT_KEY,
  OPENROUTER_THINKING_EFFORT_ENVIRONMENT_KEY,
} from '../../models/index.js';
import { resolveModelEvaluationOptions } from '../model/config.js';

test('uses the shared model env for evaluation, falling back to the default', () => {
  assert.equal(
    resolveModelEvaluationOptions(
      {},
      { [OPENROUTER_MODEL_ENVIRONMENT_KEY]: 'openrouter/eval-model' },
    ).model,
    'openrouter/eval-model',
  );
  assert.equal(
    resolveModelEvaluationOptions({}, {}).model,
    DEFAULT_OPENROUTER_MODEL,
  );
});

test('resolves thinking effort from the environment', () => {
  assert.equal(
    resolveModelEvaluationOptions({}, {}).thinkingEffort,
    DEFAULT_OPENROUTER_THINKING_EFFORT,
  );
  assert.equal(
    resolveModelEvaluationOptions(
      {},
      {
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
        [OPENROUTER_MODEL_ENVIRONMENT_KEY]: 'openrouter/eval-model',
      },
    ).model,
    'caller-model',
  );
});
