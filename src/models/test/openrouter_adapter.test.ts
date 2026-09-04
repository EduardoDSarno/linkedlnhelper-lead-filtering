import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChatRequest } from '@openrouter/sdk/models';
import type { ChatResult } from '@openrouter/sdk/models';

import { createOpenRouterModelClient } from '../index.js';
import type { ModelRequest } from '../index.js';

/** Shared JSON schema used only to assert it is forwarded unchanged. */
const SAMPLE_SCHEMA = { type: 'object' } as const;

/** Builds the small request every adapter mapping test starts from. */
function sampleRequest(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    model: 'z-ai/glm-5.3-flash',
    system: 'Evaluate the profile.',
    parts: [{ text: 'one profile' }],
    jsonSchema: SAMPLE_SCHEMA,
    thinking: 'medium',
    timeoutMs: 30_000,
    ...overrides,
  };
}

/** Builds the small SDK result shape needed by adapter mapping tests. */
function chatResult(overrides: {
  text?: string;
  finishReason?: ChatResult['choices'][number]['finishReason'];
  refusal?: string;
  usage?: ChatResult['usage'];
} = {}): ChatResult {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: 'z-ai/glm-5.3-flash',
    systemFingerprint: null,
    choices: [
      {
        index: 0,
        finishReason: overrides.finishReason ?? 'stop',
        message: {
          role: 'assistant',
          content: overrides.text ?? '{"ok":true}',
          ...(overrides.refusal ? { refusal: overrides.refusal } : {}),
        },
      },
    ],
    ...(overrides.usage ? { usage: overrides.usage } : {}),
  };
}

test('forwards text, system, schema, thinking, and timeout to OpenRouter', async () => {
  let chatRequest: ChatRequest | undefined;
  let timeoutMs: number | undefined;
  const client = createOpenRouterModelClient(async (received, options) => {
    chatRequest = received;
    timeoutMs = options.timeoutMs;
    return chatResult({ text: '  {"ok":true}  ' });
  });

  const response = await client(sampleRequest());

  assert.equal(response.text, '{"ok":true}');
  assert.equal(timeoutMs, 30_000);
  assert.equal(chatRequest?.model, 'z-ai/glm-5.3-flash');
  assert.deepEqual(chatRequest?.messages, [
    { role: 'system', content: 'Evaluate the profile.' },
    {
      role: 'user',
      content: [{ type: 'text', text: 'one profile' }],
    },
  ]);
  assert.deepEqual(chatRequest?.reasoning, { effort: 'medium' });
  assert.deepEqual(chatRequest?.responseFormat, {
    type: 'json_schema',
    jsonSchema: {
      name: 'result',
      schema: SAMPLE_SCHEMA,
      strict: false,
    },
  });
  // Routes to whichever backend currently has the best throughput, since
  // measured provider speed for this model spans roughly 10x.
  assert.deepEqual(chatRequest?.provider, { sort: 'throughput' });
});

test('defaults omitted thinking to OpenRouter high effort', async () => {
  let chatRequest: ChatRequest | undefined;
  const client = createOpenRouterModelClient(async (received) => {
    chatRequest = received;
    return chatResult();
  });

  await client({
    model: 'z-ai/glm-5.3-flash',
    parts: [{ text: 'one profile' }],
    jsonSchema: SAMPLE_SCHEMA,
    timeoutMs: 30_000,
  });

  assert.deepEqual(chatRequest?.reasoning, { effort: 'high' });
});

test('forwards max thinking effort to OpenRouter', async () => {
  let chatRequest: ChatRequest | undefined;
  const client = createOpenRouterModelClient(async (received) => {
    chatRequest = received;
    return chatResult();
  });

  await client(sampleRequest({ thinking: 'max' }));

  assert.deepEqual(chatRequest?.reasoning, { effort: 'max' });
});

test('maps an image part onto an OpenRouter data URI', async () => {
  let chatRequest: ChatRequest | undefined;
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  const client = createOpenRouterModelClient(async (received) => {
    chatRequest = received;
    return chatResult();
  });

  await client({
    model: 'z-ai/glm-5.3-flash',
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

  assert.deepEqual(chatRequest?.messages, [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'assess this photo' },
        {
          type: 'image_url',
          imageUrl: {
            url: `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`,
            detail: 'high',
          },
        },
      ],
    },
  ]);
});

test('maps omitted image resolution onto the shared default detail', async () => {
  let chatRequest: ChatRequest | undefined;
  const bytes = Uint8Array.from([9]);
  const client = createOpenRouterModelClient(async (received) => {
    chatRequest = received;
    return chatResult();
  });

  await client({
    model: 'z-ai/glm-5.3-flash',
    parts: [{ image: { data: bytes, mimeType: 'image/png' } }],
    jsonSchema: SAMPLE_SCHEMA,
    timeoutMs: 30_000,
  });

  const content = chatRequest?.messages[0] && 'content' in chatRequest.messages[0]
    ? chatRequest.messages[0].content
    : undefined;
  assert.ok(Array.isArray(content));
  assert.deepEqual(content[0], {
    type: 'image_url',
    imageUrl: {
      url: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
      detail: 'auto',
    },
  });
});

test('maps OpenRouter usage and a truncated finish reason', async () => {
  const client = createOpenRouterModelClient(async () =>
    chatResult({
      text: '{}',
      finishReason: 'length',
      usage: {
        promptTokens: 4,
        completionTokens: 5,
        totalTokens: 10,
        completionTokensDetails: { reasoningTokens: 1 },
      },
    }),
  );

  const response = await client(sampleRequest());

  assert.equal(response.blockReason, 'length');
  assert.deepEqual(response.usage, {
    promptTokens: 4,
    outputTokens: 5,
    totalTokens: 10,
    thinkingTokens: 1,
  });
});

test('omits usage and block reason when OpenRouter reports neither', async () => {
  const client = createOpenRouterModelClient(async () =>
    chatResult({ text: '' }),
  );

  const response = await client(sampleRequest());

  assert.equal(response.text, '');
  assert.equal(response.usage, undefined);
  assert.equal(response.blockReason, undefined);
});

test('requires OPENROUTER_API_KEY when no sender is supplied', async () => {
  const previousKey = process.env['OPENROUTER_API_KEY'];
  delete process.env['OPENROUTER_API_KEY'];

  try {
    await assert.rejects(
      () => createOpenRouterModelClient()(sampleRequest()),
      /OPENROUTER_API_KEY is not configured/,
    );
  } finally {
    if (previousKey !== undefined) {
      process.env['OPENROUTER_API_KEY'] = previousKey;
    }
  }
});
