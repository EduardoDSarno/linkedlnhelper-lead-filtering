import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BlockedReason,
  createPartFromBase64,
  PartMediaResolutionLevel,
  ThinkingLevel,
} from '@google/genai';
import type {
  GenerateContentParameters,
  GenerateContentResponse,
} from '@google/genai';

import { createGeminiModelClient } from '../index.js';
import type { ModelRequest } from '../index.js';

/** Shared JSON schema used only to assert it is forwarded unchanged. */
const SAMPLE_SCHEMA = { type: 'object' } as const;

/** Builds the small request every adapter mapping test starts from. */
function sampleRequest(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    model: 'gemini-3.8-flash',
    system: 'Evaluate the profile.',
    parts: [{ text: 'one profile' }],
    jsonSchema: SAMPLE_SCHEMA,
    thinking: 'medium',
    timeoutMs: 30_000,
    ...overrides,
  };
}

/** Builds the small SDK response shape needed by adapter mapping tests. */
function geminiResponse(
  fields: Partial<GenerateContentResponse>,
): GenerateContentResponse {
  return fields as GenerateContentResponse;
}

test('forwards text, system, schema, thinking, and timeout to Gemini', async () => {
  let parameters: GenerateContentParameters | undefined;
  const client = createGeminiModelClient(async (received) => {
    parameters = received;
    return geminiResponse({ text: '  {"ok":true}  ' });
  });

  const response = await client(sampleRequest());

  assert.equal(response.text, '{"ok":true}');
  assert.equal(parameters?.model, 'gemini-3.8-flash');
  assert.deepEqual(parameters?.contents, [{ text: 'one profile' }]);
  assert.equal(parameters?.config?.systemInstruction, 'Evaluate the profile.');
  assert.deepEqual(parameters?.config?.thinkingConfig, {
    thinkingLevel: ThinkingLevel.MEDIUM,
  });
  assert.equal(parameters?.config?.responseMimeType, 'application/json');
  assert.equal(parameters?.config?.responseJsonSchema, SAMPLE_SCHEMA);
  assert.equal(parameters?.config?.httpOptions?.timeout, 30_000);
  assert.equal(parameters?.config?.httpOptions?.retryOptions?.attempts, 1);
});

test('defaults omitted thinking to Gemini medium', async () => {
  let parameters: GenerateContentParameters | undefined;
  const client = createGeminiModelClient(async (received) => {
    parameters = received;
    return geminiResponse({ text: '{}' });
  });
  await client({
    model: 'gemini-3.8-flash',
    parts: [{ text: 'one profile' }],
    jsonSchema: SAMPLE_SCHEMA,
    timeoutMs: 30_000,
  });

  assert.deepEqual(parameters?.config?.thinkingConfig, {
    thinkingLevel: ThinkingLevel.MEDIUM,
  });
});

test('maps an image part onto Gemini base64 media', async () => {
  let parameters: GenerateContentParameters | undefined;
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  const client = createGeminiModelClient(async (received) => {
    parameters = received;
    return geminiResponse({ text: '{}' });
  });

  await client({
    model: 'gemini-3.8-flash',
    parts: [
      { text: 'assess this photo' },
      {
        image: {
          data: bytes,
          mimeType: 'image/jpeg',
          resolution: 'high',
        },
      },
    ],
    jsonSchema: SAMPLE_SCHEMA,
    timeoutMs: 30_000,
  });

  assert.deepEqual(parameters?.contents, [
    { text: 'assess this photo' },
    createPartFromBase64(
      Buffer.from(bytes).toString('base64'),
      'image/jpeg',
      PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH,
    ),
  ]);
  assert.equal(parameters?.config?.systemInstruction, undefined);
});

test('maps Gemini usage and block reason into the stable response', async () => {
  const client = createGeminiModelClient(async () =>
    geminiResponse({
      text: '{}',
      promptFeedback: { blockReason: BlockedReason.SAFETY },
      usageMetadata: {
        promptTokenCount: 4,
        candidatesTokenCount: 5,
        thoughtsTokenCount: 1,
        totalTokenCount: 10,
      },
    }),
  );

  const response = await client(sampleRequest());

  assert.equal(response.blockReason, 'SAFETY');
  assert.deepEqual(response.usage, {
    promptTokens: 4,
    outputTokens: 5,
    thinkingTokens: 1,
    totalTokens: 10,
  });
});

test('omits usage and block reason when Gemini reports neither', async () => {
  const client = createGeminiModelClient(async () => geminiResponse({}));

  const response = await client(sampleRequest());

  assert.equal(response.text, '');
  assert.equal(response.usage, undefined);
  assert.equal(response.blockReason, undefined);
});
