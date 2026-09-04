import { OpenRouter } from '@openrouter/sdk';
import type { ChatContentItems } from '@openrouter/sdk/models';
import type { ChatRequest } from '@openrouter/sdk/models';
import type { ChatResult } from '@openrouter/sdk/models';

import {
  DEFAULT_IMAGE_RESOLUTION,
  DEFAULT_THINKING_EFFORT,
  MODEL_RETRY_HTTP_STATUS_CODES,
} from './model_client.js';
import type {
  ImageResolution,
  ModelClient,
  ModelPart,
  ModelRequest,
  ModelResponse,
  ModelTokenUsage,
} from './model_client.js';

/** JSON Schema replies stay advisory so the eval compensation union is accepted. */
const OPENROUTER_JSON_SCHEMA_STRICT = false;

/** Stable schema name required by OpenRouter's json_schema response format. */
const OPENROUTER_JSON_SCHEMA_NAME = 'result';

/** Maps our image scale onto OpenRouter's vision `detail` values. */
const OPENROUTER_IMAGE_DETAIL: Readonly<
  Record<ImageResolution, 'low' | 'high' | 'auto'>
> = {
  low: 'low',
  medium: 'auto',
  high: 'high',
};

/** Status codes the OpenRouter SDK retries as strings. */
const OPENROUTER_RETRY_CODES = MODEL_RETRY_HTTP_STATUS_CODES.map(String);

/** A cached SDK client and the credential it was created with. */
interface CachedOpenRouterClient {
  client: OpenRouter;
  apiKey: string;
}

/** The narrow chat call injected into adapter tests instead of the SDK. */
export type OpenRouterChatSender = (
  chatRequest: ChatRequest,
  options: { timeoutMs: number },
) => Promise<ChatResult>;

let cachedClient: CachedOpenRouterClient | undefined;

/**
 * Production OpenRouter client. Eval and image will use this once provider
 * selection is wired; until then it is unused by those stages.
 */
export const openRouterModelClient: ModelClient = createOpenRouterModelClient();

/**
 * Builds an OpenRouter `ModelClient`, optionally replacing the SDK call so
 * tests never construct a real client or need an API key.
 */
export function createOpenRouterModelClient(
  send: OpenRouterChatSender = sendWithSharedClient,
): ModelClient {
  return async function openRouterModelClient(
    request: ModelRequest,
  ): Promise<ModelResponse> {
    const result = await send(toChatRequest(request), {
      timeoutMs: request.timeoutMs,
    });
    return fromChatResult(result);
  };
}

/** Sends one chat completion through the shared production SDK client. */
async function sendWithSharedClient(
  chatRequest: ChatRequest,
  options: { timeoutMs: number },
): Promise<ChatResult> {
  const result = await getOpenRouterClient().chat.send(
    { chatRequest: { ...chatRequest, stream: false } },
    {
      timeoutMs: options.timeoutMs,
      retries: { strategy: 'backoff', retryConnectionErrors: true },
      retryCodes: OPENROUTER_RETRY_CODES,
    },
  );

  return asChatResult(result);
}

/**
 * Returns the shared OpenRouter client, rebuilding it when the API key changes.
 *
 * The environment is read on every access so credential rotation takes effect
 * without requiring a process restart.
 */
function getOpenRouterClient(): OpenRouter {
  const apiKey = getOpenRouterApiKey();

  if (cachedClient?.apiKey === apiKey) return cachedClient.client;

  cachedClient = {
    apiKey,
    client: new OpenRouter({ apiKey }),
  };

  return cachedClient.client;
}

/** Returns the shared OpenRouter API key used by every OpenRouter request. */
function getOpenRouterApiKey(): string {
  const apiKey = process.env['OPENROUTER_API_KEY']?.trim();

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured.');
  }

  return apiKey;
}

/**
 * Translates a provider-neutral request into the OpenRouter chat payload.
 *
 * Lives here so eval and image never assemble OpenRouter messages or
 * responseFormat themselves.
 */
function toChatRequest(request: ModelRequest): ChatRequest {
  const messages: ChatRequest['messages'] = [];

  if (request.system) {
    messages.push({ role: 'system', content: request.system });
  }

  messages.push({
    role: 'user',
    content: request.parts.map(toChatContentPart),
  });

  return {
    model: request.model,
    messages,
    reasoning: {
      effort: request.thinking ?? DEFAULT_THINKING_EFFORT,
    },
    responseFormat: {
      type: 'json_schema',
      jsonSchema: {
        name: OPENROUTER_JSON_SCHEMA_NAME,
        schema: request.jsonSchema as { [key: string]: unknown },
        strict: OPENROUTER_JSON_SCHEMA_STRICT,
      },
    },
  };
}

/** Converts one provider-neutral part into an OpenRouter user-content part. */
function toChatContentPart(part: ModelPart): ChatContentItems {
  if ('text' in part) {
    return { type: 'text', text: part.text };
  }

  const resolution = part.image.resolution ?? DEFAULT_IMAGE_RESOLUTION;
  const encoded = Buffer.from(part.image.data).toString('base64');

  return {
    type: 'image_url',
    imageUrl: {
      url: `data:${part.image.mimeType};base64,${encoded}`,
      detail: OPENROUTER_IMAGE_DETAIL[resolution],
    },
  };
}

/** Flattens an OpenRouter chat result into the provider-neutral response. */
function fromChatResult(result: ChatResult): ModelResponse {
  const choice = result.choices[0];
  const usage = mapOpenRouterTokenUsage(result.usage);
  const blockReason = blockReasonOf(choice);

  return {
    text: assistantText(choice?.message.content),
    ...(usage ? { usage } : {}),
    ...(blockReason ? { blockReason } : {}),
  };
}

/** Maps OpenRouter usage field names onto the application's stable shape. */
function mapOpenRouterTokenUsage(
  usage: ChatResult['usage'],
): ModelTokenUsage | undefined {
  if (!usage) return undefined;

  const thinkingTokens = usage.completionTokensDetails?.reasoningTokens;

  return {
    promptTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    ...(thinkingTokens != null ? { thinkingTokens } : {}),
  };
}

/** Treats truncation, safety filters, and explicit refusals as blocked replies. */
function blockReasonOf(
  choice: ChatResult['choices'][number] | undefined,
): string | undefined {
  const finishReason = choice?.finishReason;
  if (
    finishReason === 'length' ||
    finishReason === 'content_filter' ||
    finishReason === 'error'
  ) {
    return finishReason;
  }

  const refusal = choice?.message.refusal?.trim();
  return refusal || undefined;
}

/** Reads assistant text whether OpenRouter returned a string or content parts. */
function assistantText(
  content: ChatResult['choices'][number]['message']['content'],
): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';

  return content
    .flatMap((part) => ('text' in part && part.text ? [part.text] : []))
    .join('')
    .trim();
}

/** Narrows the SDK union so a streaming handle is never treated as a result. */
function asChatResult(result: unknown): ChatResult {
  if (result && typeof result === 'object' && 'choices' in result) {
    return result as ChatResult;
  }

  throw new Error('OpenRouter returned a streaming response instead of a chat result.');
}
