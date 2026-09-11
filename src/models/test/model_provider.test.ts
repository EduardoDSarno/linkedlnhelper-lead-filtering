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
  resolveOpenRouterMaxPrice,
  resolveOpenRouterProviderSort,
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

test('caps provider price at the default when the environment is silent', () => {
  assert.deepEqual(resolveOpenRouterMaxPrice({}), {
    prompt: '0.15',
    completion: '0.50',
  });
});

test('takes a configured ceiling, so routing can be narrowed to cheaper backends', () => {
  assert.deepEqual(
    resolveOpenRouterMaxPrice({
      OPENROUTER_MAX_PROMPT_PRICE: '0.10',
      OPENROUTER_MAX_COMPLETION_PRICE: '0.35',
    }),
    { prompt: '0.10', completion: '0.35' },
  );
});

test('keeps the cap when a configured price is blank or not a number', () => {
  // A typo must not silently reopen routing to any price, which is what
  // dropping the ceiling entirely would do.
  assert.deepEqual(
    resolveOpenRouterMaxPrice({
      OPENROUTER_MAX_PROMPT_PRICE: '   ',
      OPENROUTER_MAX_COMPLETION_PRICE: 'cheap',
    }),
    { prompt: '0.15', completion: '0.50' },
  );
  assert.deepEqual(
    resolveOpenRouterMaxPrice({ OPENROUTER_MAX_PROMPT_PRICE: '-1' }),
    { prompt: '0.15', completion: '0.50' },
  );
});

test('defaults backend selection to the cheapest available', () => {
  assert.equal(resolveOpenRouterProviderSort({}), 'price');
});

test('takes a configured sort, so speed can be bought back when needed', () => {
  assert.equal(
    resolveOpenRouterProviderSort({ OPENROUTER_PROVIDER_SORT: 'throughput' }),
    'throughput',
  );
  assert.equal(
    resolveOpenRouterProviderSort({ OPENROUTER_PROVIDER_SORT: '  LATENCY  ' }),
    'latency',
  );
});

test('falls back to the default sort rather than sending an unusable one', () => {
  // OpenRouter rejects an unknown sort outright, which would fail the whole
  // request instead of quietly routing differently.
  assert.equal(resolveOpenRouterProviderSort({ OPENROUTER_PROVIDER_SORT: 'cheapest' }), 'price');
  assert.equal(resolveOpenRouterProviderSort({ OPENROUTER_PROVIDER_SORT: '' }), 'price');
});
