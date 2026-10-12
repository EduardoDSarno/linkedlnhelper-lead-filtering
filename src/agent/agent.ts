import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  appendAgentMessage,
  finishAgentRun,
  recentAgentMessages,
  startAgentRun,
  withAccountLock,
} from "../db/agentDb.js";
import type { AgentMessage } from "../db/agentDb.js";
import type { AgentTrigger } from "../db/schema.js";
import type { PipelineContext } from "../pipeline/steps.js";
import { CONFIG_NUMBER_MINIMUMS, resolveConfigNumber } from "../shared/helpers/index.js";
import { createAccountMcpServer } from "./mcp_server.js";
import type { AgentAccount } from "./mcp_server.js";
import { openRouterChat } from "./model.js";
import type { ChatFunction, ChatMessage, ChatTool } from "./model.js";

/** Most model calls in one run, so a confused agent cannot loop and spend forever. */
const MAX_STEPS_KEY = "AGENT_MAX_STEPS";
const DEFAULT_MAX_STEPS = 15;

/** Earlier conversation lines replayed to the model, so it remembers recent context. */
const HISTORY_MESSAGES = 40;

/** Longest tool result replayed from history; the full text stays in the database. */
const HISTORY_TOOL_RESULT_CHARACTERS = 2_000;

/** What a person or the schedule asks of the agent. */
export interface AgentRequest {
  trigger: AgentTrigger;
  /** The person's chat message; absent for a scheduled run. */
  userMessage?: string;
  userId?: string;
}

/** How a run ended: the agent's final words, or busy when another run holds the account. */
export type AgentOutcome = { status: "done"; runId: string; reply: string } | { status: "busy" };

/**
 * Give one account's agent a turn: it reads the situation through its MCP
 * tools, acts, and ends with a short message.
 *
 * Every line is saved as it happens (the person's message, each tool call
 * with its arguments and result, the agent's words), so the chat and any
 * later audit see exactly what was done and why. Only one run per account
 * can happen at a time, across the web server and the worker.
 */
export async function runAgent(
  context: PipelineContext,
  account: AgentAccount,
  request: AgentRequest,
  chat: ChatFunction = openRouterChat,
): Promise<AgentOutcome> {
  const outcome = await withAccountLock(context.db, account.id, () => runLocked(context, account, request, chat));
  return outcome ?? { status: "busy" };
}

/** The run itself, once the account lock is held. */
async function runLocked(
  context: PipelineContext,
  account: AgentAccount,
  request: AgentRequest,
  chat: ChatFunction,
): Promise<AgentOutcome> {
  const { db } = context;
  const runId = await startAgentRun(db, account.id, request.trigger);
  const tokens = { promptTokens: 0, completionTokens: 0 };

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createAccountMcpServer(context, account);
  const client = new Client({ name: "account-agent", version: "1.0.0" });

  try {
    const history = await recentAgentMessages(db, account.id, HISTORY_MESSAGES);
    const opening = request.userMessage ?? scheduledCheckIn(context.now());
    await appendAgentMessage(db, {
      linkedinAccountId: account.id,
      runId,
      role: "user",
      content: opening,
      ...(request.userId ? { userId: request.userId } : {}),
    });

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools: ChatTool[] = (await client.listTools()).tools.map((tool) => ({
      type: "function",
      function: { name: tool.name, ...(tool.description ? { description: tool.description } : {}), parameters: tool.inputSchema },
    }));

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt(account, request.trigger) },
      ...replayable(history),
      { role: "user", content: opening },
    ];

    let reply = "";
    for (let step = 0; step < maxSteps(); step++) {
      const answer = await chat(messages, tools);
      tokens.promptTokens += answer.promptTokens;
      tokens.completionTokens += answer.completionTokens;

      await appendAgentMessage(db, {
        linkedinAccountId: account.id,
        runId,
        role: "assistant",
        content: answer.content,
        ...(answer.toolCalls.length ? { toolCalls: answer.toolCalls } : {}),
      });
      messages.push({
        role: "assistant",
        content: answer.content,
        ...(answer.toolCalls.length ? { tool_calls: answer.toolCalls } : {}),
      });

      if (answer.toolCalls.length === 0) {
        reply = answer.content ?? "";
        break;
      }

      for (const call of answer.toolCalls) {
        const result = await callTool(client, call.function.name, call.function.arguments);
        await appendAgentMessage(db, {
          linkedinAccountId: account.id,
          runId,
          role: "tool",
          content: result,
          toolCallId: call.id,
          toolName: call.function.name,
        });
        messages.push({ role: "tool", content: result, tool_call_id: call.id });
      }
    }

    if (!reply) reply = "I stopped after the maximum number of steps for one run; I'll continue next time.";
    await finishAgentRun(db, runId, tokens);
    return { status: "done", runId, reply };
  } catch (error) {
    await finishAgentRun(db, runId, { ...tokens, error: String(error) });
    throw error;
  } finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

/**
 * Call one MCP tool and return its text, turning bad arguments and refusals
 * into text the model can read and react to, instead of failing the run.
 */
async function callTool(client: Client, name: string, rawArguments: string): Promise<string> {
  let args: Record<string, unknown>;
  try {
    args = rawArguments.trim() ? (JSON.parse(rawArguments) as Record<string, unknown>) : {};
  } catch {
    return `Error: the arguments for ${name} were not valid JSON.`;
  }
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text?: string }[])
      .map((part) => (part.type === "text" ? part.text ?? "" : ""))
      .join("\n");
    return result.isError ? `Refused: ${text}` : text;
  } catch (error) {
    return `Error: ${String(error)}`;
  }
}

/**
 * Earlier lines as chat messages, dropping tool answers whose call was cut
 * off by the history limit (the model rejects an answer without its call)
 * and shortening long tool results.
 */
function replayable(history: AgentMessage[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const openCalls = new Set<string>();
  for (const line of history) {
    if (line.role === "assistant") {
      line.toolCalls?.forEach((call) => openCalls.add(call.id));
      messages.push({ role: "assistant", content: line.content, ...(line.toolCalls ? { tool_calls: line.toolCalls } : {}) });
    } else if (line.role === "tool") {
      if (!line.toolCallId || !openCalls.has(line.toolCallId)) continue;
      messages.push({ role: "tool", content: (line.content ?? "").slice(0, HISTORY_TOOL_RESULT_CHARACTERS), tool_call_id: line.toolCallId });
    } else {
      messages.push({ role: "user", content: line.content ?? "" });
    }
  }
  // A cut-off history can end on an assistant line that called tools whose
  // answers were not saved (a crashed run); the model refuses that shape.
  while (messages.length && lastCallsUnanswered(messages)) messages.pop();
  return messages;
}

/** Whether the conversation ends with tool calls that have no answers after them. */
function lastCallsUnanswered(messages: ChatMessage[]): boolean {
  const last = messages[messages.length - 1];
  return last?.role === "assistant" && Boolean(last.tool_calls?.length);
}

/** The opening line of a scheduled run, saved like a message so the chat shows it. */
function scheduledCheckIn(now: Date): string {
  return `[Scheduled check-in ${now.toISOString()}] Do this account's work for now, then summarize what you did in one to three lines.`;
}

/** The most model calls a run may make, from `.env` or the default. */
function maxSteps(): number {
  return resolveConfigNumber(process.env[MAX_STEPS_KEY], {
    fallback: DEFAULT_MAX_STEPS,
    minimum: CONFIG_NUMBER_MINIMUMS.positive,
    integer: true,
  });
}

/**
 * The agent's standing instructions: its job, how to work through a run,
 * and the boundaries it keeps even when a tool would allow more.
 */
function systemPrompt(account: AgentAccount, trigger: AgentTrigger): string {
  return `You are the lead-collection agent for the LinkedIn account "${account.label}". You work like a careful human assistant who runs this person's LinkedIn prospecting: you find people who fit each campaign, get them evaluated, and send connection requests the user has cleared.

You act only through your tools. They enforce every safety limit (weekly and daily caps, gaps between invites, working hours, the user's approval of invites) in code. When a tool refuses, accept it: do not retry the same action in this run, and never look for a way around a limit.

How to run (scheduled check-ins):
1. Call read_notes, then get_account_status.
2. For each ACTIVE campaign: if fewer leads are waiting (found + profiled) than a batch and the search is not exhausted, call search_more_leads. If there are found leads and profile room, call fetch_profiles. Then call evaluate_profiles.
3. For each campaign with queued leads, or approved leads where requireInviteApproval is false, call send_invite once. One invite per campaign per run is normal; a "nothing sent" answer means wait.
4. Learn from the user's decisions. Now and then call get_campaign_insights. When the user overrides the AI often or mostly in one direction (aiTooLoose or aiTooStrict), read get_review_feedback to see why, draft a better prompt or thresholds, and measure the draft with test_prompt_change. Only if it agrees with the user clearly more often than the current criteria, suggest it to the user with the numbers. save_note what you learned. Do NOT change prompts, thresholds, targets or budgets on your own during scheduled runs.
5. Finish with a short summary of what you did and anything the user should know.

In chat with the user:
- Answer questions about campaigns, leads and limits from tool results; never invent numbers.
- When the user asks to change something (prompt, thresholds, target, budgets, pause/resume, invite approval), do it with update_campaign or set_campaign_status and confirm exactly what changed.
- Who qualifies is decided ONLY by the campaign prompt the evaluation reads. When the user states a preference about who fits (e.g. "never people from X", "prefer Y"), add it to the prompt with update_campaign (send the whole new prompt) and say which campaign changed. Notes are only your own memory; they never change an evaluation, so never claim a note will filter anyone.
- Save other standing instructions (how often to report, what to watch) with save_note.
- When a tool refuses, read why. Fix the input once if the reason is yours; otherwise tell the user instead of retrying.
- You cannot create campaigns or connect LinkedIn accounts; for those, point the user to the Campaigns or Accounts page. Never offer what your tools cannot do.
- Be brief and plain.

${trigger === "chat" ? "This run was started by the user's chat message." : "This is a scheduled check-in."}`;
}
