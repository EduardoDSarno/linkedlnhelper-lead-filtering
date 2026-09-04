import assert from 'node:assert/strict';
import test from 'node:test';

import type { ModelRequest, ModelResponse } from '../../models/index.js';
import {
  GeminiImageError,
  recognizeProfileImageWithGemini,
} from '../gemini_profile_image_client.js';
import type { GeminiProfileImageRequest } from '../gemini_profile_image_client.js';
import { validImageAssessmentJson } from '../../test_support/image_assessment_fixtures.js';

const IMAGE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/** Builds a request whose model call returns one prepared response. */
function requestReturning(
  response: ModelResponse,
  overrides: Partial<GeminiProfileImageRequest> = {},
): GeminiProfileImageRequest {
  return {
    image: { data: IMAGE_BYTES, mimeType: 'image/png' },
    model: 'test-model',
    resolution: 'medium',
    timeoutMs: 5_000,
    maxRetries: 2,
    generateContent: async () => response,
    ...overrides,
  };
}

/** Returns the text part sent as the image-assessment prompt. */
function promptText(request: ModelRequest): string {
  const part = request.parts[0];
  assert.ok(part && 'text' in part);
  return part.text;
}

/** Returns the image part sent with the assessment prompt. */
function imagePart(request: ModelRequest): {
  data: Uint8Array;
  mimeType: string;
  resolution?: 'low' | 'medium' | 'high';
} {
  const part = request.parts[1];
  assert.ok(part && 'image' in part);
  return part.image;
}

test('returns the response text and mapped token usage', async () => {
  const assessmentJson = validImageAssessmentJson();
  const result = await recognizeProfileImageWithGemini(
    requestReturning({
      text: assessmentJson,
      usage: {
        promptTokens: 11,
        outputTokens: 22,
        thinkingTokens: 33,
        totalTokens: 66,
      },
    }),
  );

  assert.equal(result.text, assessmentJson);
  assert.deepEqual(result.usage, {
    promptTokens: 11,
    outputTokens: 22,
    thinkingTokens: 33,
    totalTokens: 66,
  });
});

test('trims surrounding whitespace from the response text', async () => {
  const result = await recognizeProfileImageWithGemini(
    requestReturning({ text: '  {"ok":true}  ' }),
  );

  assert.equal(result.text, '{"ok":true}');
});

test('omits usage entirely when the response reports none', async () => {
  const result = await recognizeProfileImageWithGemini(
    requestReturning({ text: '{"ok":true}' }),
  );

  assert.equal('usage' in result, false);
});

test('maps only the token counts the response actually reports', async () => {
  const result = await recognizeProfileImageWithGemini(
    requestReturning({
      text: '{"ok":true}',
      usage: { promptTokens: 5, totalTokens: 5 },
    }),
  );

  assert.deepEqual(result.usage, { promptTokens: 5, totalTokens: 5 });
});

test('reports a blocked prompt with its block reason', async () => {
  await assert.rejects(
    () =>
      recognizeProfileImageWithGemini(
        requestReturning({
          text: '{"ok":true}',
          blockReason: 'SAFETY',
        }),
      ),
    /The model blocked the image request: SAFETY/,
  );
});

test('reports an empty response', async () => {
  await assert.rejects(
    () =>
      recognizeProfileImageWithGemini(requestReturning({ text: '' })),
    /The model returned no image assessment\./,
  );
});

test('treats a whitespace-only response as empty', async () => {
  await assert.rejects(
    () =>
      recognizeProfileImageWithGemini(requestReturning({ text: '   \n  ' })),
    /The model returned no image assessment\./,
  );
});

test('propagates a model-call rejection unchanged', async () => {
  const sdkError = new Error('The model is overloaded.');

  await assert.rejects(
    () =>
      recognizeProfileImageWithGemini(
        requestReturning({ text: '' }, {
          generateContent: async () => {
            throw sdkError;
          },
        }),
      ),
    // Identity: the batch layer classifies terminal failures, so this module
    // must not wrap or reword what the client reported.
    (error: unknown) => error === sdkError,
  );
});

test('passes the configured model, schema, timeout, and thinking', async () => {
  const calls: ModelRequest[] = [];

  await recognizeProfileImageWithGemini(
    requestReturning({ text: '{"ok":true}' }, {
      model: 'configured-model',
      timeoutMs: 12_345,
      maxRetries: 4,
      generateContent: async (request) => {
        calls.push(request);
        return { text: '{"ok":true}' };
      },
    }),
  );

  assert.equal(calls.length, 1);

  const request = calls[0];
  assert.equal(request?.model, 'configured-model');
  assert.equal(request?.timeoutMs, 12_345);
  assert.equal(request?.thinking, 'medium');
  assert.ok(request?.jsonSchema);
  assert.equal('retries' in (request ?? {}), false);
});

test('sends the prompt and the image bytes with the requested resolution', async () => {
  const calls: ModelRequest[] = [];

  await recognizeProfileImageWithGemini(
    requestReturning({ text: '{"ok":true}' }, {
      resolution: 'high',
      generateContent: async (request) => {
        calls.push(request);
        return { text: '{"ok":true}' };
      },
    }),
  );

  assert.ok(calls[0]);
  assert.ok(
    promptText(calls[0]).includes('apparentAge'),
    'the prompt must still instruct the model about the apparent age bracket',
  );
  assert.deepEqual(imagePart(calls[0]), {
    data: IMAGE_BYTES,
    mimeType: 'image/png',
    resolution: 'high',
  });
});

test('does not require GEMINI_API_KEY when the model call is supplied', async () => {
  const previousKey = process.env['GEMINI_API_KEY'];
  delete process.env['GEMINI_API_KEY'];

  try {
    const result = await recognizeProfileImageWithGemini(
      requestReturning({ text: '{"ok":true}' }),
    );

    assert.equal(result.text, '{"ok":true}');
  } finally {
    if (previousKey !== undefined) {
      process.env['GEMINI_API_KEY'] = previousKey;
    }
  }
});

test('reports token usage on a blocked response', async () => {
  await assert.rejects(
    () =>
      recognizeProfileImageWithGemini(
        requestReturning({
          text: '',
          blockReason: 'SAFETY',
          usage: { promptTokens: 900, totalTokens: 900 },
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof GeminiImageError);
      assert.match(error.message, /blocked/);
      assert.deepEqual(error.usage, { promptTokens: 900, totalTokens: 900 });
      return true;
    },
  );
});

test('reports token usage on an empty response', async () => {
  await assert.rejects(
    () =>
      recognizeProfileImageWithGemini(
        requestReturning({
          text: '',
          usage: { promptTokens: 40, totalTokens: 90 },
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof GeminiImageError);
      assert.deepEqual(error.usage, { promptTokens: 40, totalTokens: 90 });
      return true;
    },
  );
});

test('omits usage when the response reported none', async () => {
  await assert.rejects(
    () =>
      recognizeProfileImageWithGemini(
        requestReturning({ text: '', blockReason: 'SAFETY' }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof GeminiImageError);
      assert.equal(error.usage, undefined);
      return true;
    },
  );
});

test('carries no usage when the model call itself failed', async () => {
  await assert.rejects(
    () =>
      recognizeProfileImageWithGemini(
        requestReturning({ text: '' }, {
          generateContent: async () => {
            throw new Error('Network unreachable.');
          },
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error instanceof GeminiImageError, false);
      return true;
    },
  );
});

test('a Gemini image error is still an ordinary Error for existing callers', async () => {
  await assert.rejects(
    () =>
      recognizeProfileImageWithGemini(
        requestReturning({ text: '', blockReason: 'SAFETY' }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(typeof (error as Error).message, 'string');
      return true;
    },
  );
});

test('requires GEMINI_API_KEY when no model call is supplied', async () => {
  const previousKey = process.env['GEMINI_API_KEY'];
  delete process.env['GEMINI_API_KEY'];

  try {
    await assert.rejects(
      () =>
        recognizeProfileImageWithGemini({
          image: { data: IMAGE_BYTES, mimeType: 'image/png' },
          model: 'test-model',
          resolution: 'medium',
          timeoutMs: 5_000,
          maxRetries: 0,
        }),
      /GEMINI_API_KEY is not configured/,
    );
  } finally {
    if (previousKey !== undefined) {
      process.env['GEMINI_API_KEY'] = previousKey;
    }
  }
});
