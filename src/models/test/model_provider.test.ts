import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_OPENROUTER_THINKING_EFFORT,
  OPENROUTER_MODEL_ENVIRONMENT_KEY,
  OPENROUTER_THINKING_EFFORT_ENVIRONMENT_KEY,
  THINKING_EFFORT_CHOICES,
  openRouterModelClient,
  resolveModelClient,
  resolveProviderModelId,
  resolveThinkingEffort,
  resolveThinkingEffortChoice,
} from '../index.js';

const ENVIRONMENT_MODEL = 'openrouter/test-model';
const CALLER_MODEL = 'caller-override-model';

test('returns the OpenRouter client for every stage', () => {
  assert.equal(resolveModelClient({}), openRouterModelClient);
});

test('lets a caller model override the environment model', () => {
  assert.equal(
    resolveProviderModelId(CALLER_MODEL, {
      [OPENROUTER_MODEL_ENVIRONMENT_KEY]: ENVIRONMENT_MODEL,
    }),
    CALLER_MODEL,
  );
});

test('uses one environment model for every stage', () => {
  assert.equal(
    resolveProviderModelId(undefined, {
      [OPENROUTER_MODEL_ENVIRONMENT_KEY]: ENVIRONMENT_MODEL,
    }),
    ENVIRONMENT_MODEL,
  );
});

test('falls back to the configured default when the model env is blank', () => {
  assert.equal(resolveProviderModelId(undefined, {}), DEFAULT_OPENROUTER_MODEL);
  assert.equal(
    resolveProviderModelId('   ', { [OPENROUTER_MODEL_ENVIRONMENT_KEY]: '  ' }),
    DEFAULT_OPENROUTER_MODEL,
  );
});

test('defaults thinking to high when the env is blank', () => {
  assert.equal(resolveThinkingEffort({}), DEFAULT_OPENROUTER_THINKING_EFFORT);
  assert.equal(
    resolveThinkingEffort({
      [OPENROUTER_THINKING_EFFORT_ENVIRONMENT_KEY]: '   ',
    }),
    DEFAULT_OPENROUTER_THINKING_EFFORT,
  );
});

test('reads thinking effort from the environment, ignoring case', () => {
  assert.equal(
    resolveThinkingEffort({
      [OPENROUTER_THINKING_EFFORT_ENVIRONMENT_KEY]: 'Max',
    }),
    'max',
  );
});

test('rejects an unknown thinking effort', () => {
  assert.throws(
    () =>
      resolveThinkingEffort({
        [OPENROUTER_THINKING_EFFORT_ENVIRONMENT_KEY]: 'turbo',
      }),
    /OPENROUTER_MODEL_THINKING_EFFORT must be/,
  );
});

test('maps a UI thinking choice onto provider effort', () => {
  assert.equal(
    resolveThinkingEffortChoice(),
    DEFAULT_OPENROUTER_THINKING_EFFORT,
  );
  assert.equal(
    resolveThinkingEffortChoice(THINKING_EFFORT_CHOICES.default, {}),
    DEFAULT_OPENROUTER_THINKING_EFFORT,
  );
  assert.equal(resolveThinkingEffortChoice(THINKING_EFFORT_CHOICES.max, {}), 'max');
});

test('rejects an unknown UI thinking choice', () => {
  assert.throws(
    () => resolveThinkingEffortChoice('turbo'),
    /thinkingEffort must be "default" or "max"/,
  );
});
