import assert from 'node:assert/strict';
import test from 'node:test';

import type { GenerateContentResponse } from '@google/genai';

import { getGeminiClient, mapGeminiTokenUsage } from '../index.js';

/** Builds the small SDK response shape needed by usage-mapping tests. */
function geminiResponse(
  fields: Partial<GenerateContentResponse>,
): GenerateContentResponse {
  return fields as GenerateContentResponse;
}

test('reuses the shared client while the API key is unchanged', () => {
  const previousKey = process.env['GEMINI_API_KEY'];
  process.env['GEMINI_API_KEY'] = 'shared-client-test-key';

  try {
    assert.equal(getGeminiClient(), getGeminiClient());
  } finally {
    if (previousKey === undefined) {
      delete process.env['GEMINI_API_KEY'];
    } else {
      process.env['GEMINI_API_KEY'] = previousKey;
    }
  }
});

test('rebuilds the shared client after API-key rotation', () => {
  const previousKey = process.env['GEMINI_API_KEY'];

  try {
    process.env['GEMINI_API_KEY'] = 'first-client-test-key';
    const firstClient = getGeminiClient();

    process.env['GEMINI_API_KEY'] = 'second-client-test-key';
    const secondClient = getGeminiClient();

    assert.notEqual(firstClient, secondClient);
  } finally {
    if (previousKey === undefined) {
      delete process.env['GEMINI_API_KEY'];
    } else {
      process.env['GEMINI_API_KEY'] = previousKey;
    }
  }
});

test('requires the shared API key before creating a client', () => {
  const previousKey = process.env['GEMINI_API_KEY'];
  delete process.env['GEMINI_API_KEY'];

  try {
    assert.throws(() => getGeminiClient(), /GEMINI_API_KEY is not configured/);
  } finally {
    if (previousKey !== undefined) {
      process.env['GEMINI_API_KEY'] = previousKey;
    }
  }
});

test('maps every reported Gemini token count', () => {
  const usage = mapGeminiTokenUsage(
    geminiResponse({
      usageMetadata: {
        promptTokenCount: 11,
        candidatesTokenCount: 22,
        thoughtsTokenCount: 33,
        totalTokenCount: 66,
      },
    }),
  );

  assert.deepEqual(usage, {
    promptTokens: 11,
    outputTokens: 22,
    thinkingTokens: 33,
    totalTokens: 66,
  });
});

test('omits usage when Gemini reports none', () => {
  assert.equal(mapGeminiTokenUsage(geminiResponse({})), undefined);
});
