import { resolveOpenRouterMaxPrice, resolveProviderModelId } from "../llm/index.js";
import type { AgentToolCall } from "../db/schema.js";

/** OpenRouter's OpenAI-compatible chat endpoint, which carries tool calls. */
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Environment variable that gives the agent its own model, else OPENROUTER_MODEL is used. */
const AGENT_MODEL_KEY = "AGENT_MODEL";

/** How long one model call may take before the run fails instead of hanging. */
const AGENT_REQUEST_TIMEOUT_MS = 120_000;

/** Same backend choice as the evaluation: fastest within the price ceiling. */
const PROVIDER_SORT = "throughput";

/** One message of the conversation in OpenAI's chat format. */
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: AgentToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

/** A tool the model may call, described by its JSON Schema. */
export interface ChatTool {
  type: "function";
  function: { name: string; description?: string; parameters: unknown };
}

/** The model's answer: text, tool calls, or both, and what it cost in tokens. */
export interface ChatAnswer {
  content: string | null;
  toolCalls: AgentToolCall[];
  promptTokens: number;
  completionTokens: number;
}

/** Sends the conversation to the model; injectable so tests never reach OpenRouter. */
export type ChatFunction = (messages: ChatMessage[], tools: ChatTool[]) => Promise<ChatAnswer>;

/**
 * Ask the agent's model for its next step through OpenRouter.
 *
 * Uses the same key, price ceiling and backend sort as the evaluation, and
 * the evaluation's model unless AGENT_MODEL names another.
 *
 * @throws When OpenRouter answers with an error or the request times out.
 */
export const openRouterChat: ChatFunction = async (messages, tools) => {
  const apiKey = process.env["OPENROUTER_API_KEY"]?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured.");

  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: resolveProviderModelId(process.env[AGENT_MODEL_KEY]),
      messages,
      tools,
      tool_choice: "auto",
      provider: { sort: PROVIDER_SORT, max_price: resolveOpenRouterMaxPrice() },
    }),
    signal: AbortSignal.timeout(AGENT_REQUEST_TIMEOUT_MS),
  });

  const body = (await response.json()) as {
    error?: { message?: string };
    choices?: { message?: { content?: string | null; tool_calls?: AgentToolCall[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  if (!response.ok || body.error) {
    throw new Error(`Agent model call failed (${response.status}): ${body.error?.message ?? "no details"}`);
  }

  const message = body.choices?.[0]?.message;
  return {
    content: message?.content ?? null,
    toolCalls: message?.tool_calls ?? [],
    promptTokens: body.usage?.prompt_tokens ?? 0,
    completionTokens: body.usage?.completion_tokens ?? 0,
  };
};
