import type { FastifyInstance } from "fastify";

import { runAgent } from "../agent/agent.js";
import { recentAgentMessages } from "../db/agentDb.js";
import { findLinkedinAccount } from "../db/linkedinAccountsDb.js";
import type { PipelineContext } from "../pipeline/steps.js";
import { asRecord, asString } from "../shared/helpers/index.js";
import { currentUser } from "./auth.js";
import { HTTP_BAD_REQUEST, HTTP_NOT_FOUND } from "./consts.js";

/** Conversation lines the chat page loads. */
const CHAT_HISTORY_MESSAGES = 200;

/** Longest chat message accepted, so one message cannot blow up the model's context. */
const MAX_CHAT_MESSAGE_LENGTH = 4_000;

/** Status for "the account's agent is busy with another run". */
const HTTP_CONFLICT = 409;

/**
 * Chat with an account's agent: read the conversation (including every tool
 * call it made on schedule) and send a message, which runs the agent at once
 * and returns its reply. Must be registered behind `requireUser`.
 */
export function registerAgentChatRoutes(app: FastifyInstance, context: PipelineContext): void {
  const { db } = context;

  app.get<{ Params: { id: string } }>("/api/linkedin-accounts/:id/agent/messages", async (request, reply) => {
    const account = await findLinkedinAccount(db, currentUser(request).organizationId, request.params.id);
    if (!account) return reply.code(HTTP_NOT_FOUND).send({ error: "Account not found." });
    return { messages: await recentAgentMessages(db, account.id, CHAT_HISTORY_MESSAGES) };
  });

  app.post<{ Params: { id: string } }>("/api/linkedin-accounts/:id/agent/messages", async (request, reply) => {
    const user = currentUser(request);
    const account = await findLinkedinAccount(db, user.organizationId, request.params.id);
    if (!account) return reply.code(HTTP_NOT_FOUND).send({ error: "Account not found." });

    const text = asString(asRecord(request.body)?.["text"])?.trim();
    if (!text) return reply.code(HTTP_BAD_REQUEST).send({ error: "Write a message." });
    if (text.length > MAX_CHAT_MESSAGE_LENGTH) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: `Keep messages under ${MAX_CHAT_MESSAGE_LENGTH} characters.` });
    }

    const outcome = await runAgent(
      context,
      { id: account.id, label: account.label },
      { trigger: "chat", userMessage: text, userId: user.id },
    );
    if (outcome.status === "busy") {
      return reply.code(HTTP_CONFLICT).send({ error: "The agent is working on this account right now. Try again in a minute." });
    }
    return { reply: outcome.reply };
  });
}
