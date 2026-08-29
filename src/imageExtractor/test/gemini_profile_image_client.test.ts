import assert from 'node:assert/strict';
import test from 'node:test';

import { BlockedReason } from '@google/genai';
import type {
  GenerateContentParameters,
  GenerateContentResponse,
} from '@google/genai';

import {
  GeminiImageError,
  recognizeProfileImageWithGemini,
} from '../gemini_profile_image_client.js';
import type { GeminiProfileImageRequest } from '../gemini_profile_image_client.js';
import { validImageAssessmentJson } from '../../test_support/image_assessment_fixtures.js';

const IMAGE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/**
 * Builds a response shaped like the SDK's, with only the fields this module
 * reads. The SDK type is wider than anything we touch, so the cast keeps the
 * fixture readable instead of stubbing dozens of unused members.
 */
function geminiResponse(
  fields: Partial<GenerateContentResponse>,
): GenerateContentResponse {
  return fields as GenerateContentResponse;
}

/** Builds a request whose model call returns one prepared response. */
function requestReturning(
  response: GenerateContentResponse,
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

test('returns the response text and mapped token usage', async () => {
  const assessmentJson = validImageAssessmentJson();
  const result = await recognizeProfileImageWithGemini(
    requestReturning(
      geminiResponse({
        text: assessmentJson,
        usageMetadata: {
          promptTokenCount: 11,
          candidatesTokenCount: 22,
          thoughtsTokenCount: 33,
          totalTokenCount: 66,
        },
      }),
    ),
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
    requestReturning(geminiResponse({ text: '  {"ok":true}  ' })),
  );

  assert.equal(result.text, '{"ok":true}');
});

test('omits usage entirely when the response reports none', async () => {
  const result = await recognizeProfileImageWithGemini(
    requestReturning(geminiResponse({ text: '{"ok":true}' })),
  );

  assert.equal('usage' in result, false);
});

test('maps only the token counts the response actually reports', async () => {
  const result = await recognizeProfileImageWithGemini(
    requestReturning(
      geminiResponse({
        text: '{"ok":true}',
        usageMetadata: { promptTokenCount: 5, totalTokenCount: 5 },
      }),
    ),
  );

  assert.deepEqual(result.usage, { promptTokens: 5, totalTokens: 5 });
});

test('reports a blocked prompt with its block reason', async () => {
  await assert.rejects(
    () =>
      recognizeProfileImageWithGemini(
        requestReturning(
          geminiResponse({
            promptFeedback: { blockReason: BlockedReason.SAFETY },
            text: '{"ok":true}',
          }) as GenerateContentResponse,
        ),
      ),
    /Gemini blocked the image request: SAFETY/,
  );
});

test('reports an empty response with its finish reason', async () => {
  await assert.rejects(
    () =>
      recognizeProfileImageWithGemini(
        requestReturning(
          geminiResponse({
            text: '',
            candidates: [{ finishReason: 'MAX_TOKENS' }],
          } as Partial<GenerateContentResponse>),
        ),
      ),
    /Gemini returned no assessment \(MAX_TOKENS\)/,
  );
});

test('reports an empty response without a finish reason', async () => {
  await assert.rejects(
    () =>
      recognizeProfileImageWithGemini(
        requestReturning(geminiResponse({ text: undefined })),
      ),
    /Gemini returned no image assessment\./,
  );
});

test('treats a whitespace-only response as empty', async () => {
  await assert.rejects(
    () =>
      recognizeProfileImageWithGemini(
        requestReturning(geminiResponse({ text: '   \n  ' })),
      ),
    /Gemini returned no image assessment\./,
  );
});

test('propagates an SDK rejection unchanged', async () => {
  const sdkError = new Error('The model is overloaded.');

  await assert.rejects(
    () =>
      recognizeProfileImageWithGemini(
        requestReturning(geminiResponse({}), {
          generateContent: async () => {
            throw sdkError;
          },
        }),
      ),
    // Identity: the batch layer classifies terminal failures, so this module
    // must not wrap or reword what the SDK reported.
    (error: unknown) => error === sdkError,
  );
});

test('passes the configured model, schema, timeout, and retries to the SDK', async () => {
  const calls: GenerateContentParameters[] = [];

  await recognizeProfileImageWithGemini(
    requestReturning(geminiResponse({ text: '{"ok":true}' }), {
      model: 'configured-model',
      timeoutMs: 12_345,
      maxRetries: 4,
      generateContent: async (parameters) => {
        calls.push(parameters);
        return geminiResponse({ text: '{"ok":true}' });
      },
    }),
  );

  assert.equal(calls.length, 1);

  const parameters = calls[0];
  assert.equal(parameters?.model, 'configured-model');
  assert.equal(parameters?.config?.responseMimeType, 'application/json');
  assert.ok(parameters?.config?.responseJsonSchema);
  assert.equal(parameters?.config?.httpOptions?.timeout, 12_345);

  // The SDK counts total attempts, so a budget of maxRetries retries means
  // maxRetries + 1 attempts. Off-by-one here would silently change cost.
  assert.equal(parameters?.config?.httpOptions?.retryOptions?.attempts, 5);
  assert.deepEqual(
    parameters?.config?.httpOptions?.retryOptions?.httpStatusCodes,
    [408, 429, 500, 502, 503, 504],
  );
});

test('sends the prompt and the image as base64 with the requested resolution', async () => {
  const calls: GenerateContentParameters[] = [];

  await recognizeProfileImageWithGemini(
    requestReturning(geminiResponse({ text: '{"ok":true}' }), {
      resolution: 'high',
      generateContent: async (parameters) => {
        calls.push(parameters);
        return geminiResponse({ text: '{"ok":true}' });
      },
    }),
  );

  const contents = calls[0]?.contents as Array<Record<string, unknown>>;
  assert.equal(contents.length, 2);

  const prompt = contents[0]?.['text'];
  assert.equal(typeof prompt, 'string');
  assert.ok(
    (prompt as string).includes('apparentAge'),
    'the prompt must still instruct the model about the apparent age bracket',
  );

  const inlineData = contents[1]?.['inlineData'] as Record<string, unknown>;
  assert.equal(inlineData['mimeType'], 'image/png');
  assert.equal(
    inlineData['data'],
    Buffer.from(IMAGE_BYTES).toString('base64'),
  );
});

test('does not require GEMINI_API_KEY when the model call is supplied', async () => {
  const previousKey = process.env['GEMINI_API_KEY'];
  delete process.env['GEMINI_API_KEY'];

  try {
    const result = await recognizeProfileImageWithGemini(
      requestReturning(geminiResponse({ text: '{"ok":true}' })),
    );

    assert.equal(result.text, '{"ok":true}');
  } finally {
    if (previousKey !== undefined) {
      process.env['GEMINI_API_KEY'] = previousKey;
    }
  }
});

test('reports token usage on a blocked response', async () => {
  // A blocked response is still billed, so the cost must travel with the
  // failure. Without this the spend is invisible to every summary.
  await assert.rejects(
    () =>
      recognizeProfileImageWithGemini(
        requestReturning(
          geminiResponse({
            promptFeedback: { blockReason: BlockedReason.SAFETY },
            usageMetadata: { promptTokenCount: 900, totalTokenCount: 900 },
          }),
        ),
      ),
    (error: unknown) => {
      assert.ok(error instanceof GeminiImageError);
      assert.match(error.message, /blocked/);
      assert.deepEqual(error.usage, { promptTokens: 900, totalTokens: 900 });
      return true;
    },
  );
});

test('reports token usage on a truncated response', async () => {
  await assert.rejects(
    () =>
      recognizeProfileImageWithGemini(
        requestReturning(
          geminiResponse({
            text: '',
            candidates: [{ finishReason: 'MAX_TOKENS' }],
            usageMetadata: { promptTokenCount: 40, totalTokenCount: 90 },
          } as Partial<GenerateContentResponse>),
        ),
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
        requestReturning(
          geminiResponse({
            promptFeedback: { blockReason: BlockedReason.SAFETY },
          }),
        ),
      ),
    (error: unknown) => {
      assert.ok(error instanceof GeminiImageError);
      assert.equal(error.usage, undefined);
      return true;
    },
  );
});

test('carries no usage when the model call itself failed', async () => {
  // No response arrived, so there is no token count to report. Inventing one
  // would be worse than reporting nothing.
  await assert.rejects(
    () =>
      recognizeProfileImageWithGemini(
        requestReturning(geminiResponse({}), {
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
  // The batch layer reads `error.message` from a plain Error. Subclassing
  // keeps that path working untouched while adding the usage for new callers.
  await assert.rejects(
    () =>
      recognizeProfileImageWithGemini(
        requestReturning(
          geminiResponse({
            promptFeedback: { blockReason: BlockedReason.SAFETY },
          }),
        ),
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
    // Reaching the shared client is the only path that needs a credential.
    // The error must name the variable so a misconfigured run is obvious.
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
