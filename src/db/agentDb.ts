import { sql } from "kysely";
import type { Kysely } from "kysely";

import type { AgentToolCall, AgentTrigger, Database } from "./schema.js";

/**
 * First key of the Postgres advisory lock taken per account, so these locks
 * cannot collide with any other lock the app might take later.
 */
const ACCOUNT_LOCK_NAMESPACE = 7301;

/** One saved line of an agent conversation, as the chat and the agent read it back. */
export interface AgentMessage {
  id: string;
  runId: string | null;
  role: "user" | "assistant" | "tool";
  content: string | null;
  toolCalls: AgentToolCall[] | null;
  toolCallId: string | null;
  toolName: string | null;
  createdAt: Date;
}

/**
 * Run `work` only if no other agent run holds this account, in this process
 * or another (the web server's chat and the worker's schedule).
 *
 * It is a Postgres advisory lock on a dedicated connection, released when
 * `work` finishes or throws. This keeps the rule that one account never does
 * two things on LinkedIn at once.
 *
 * @returns `work`'s result, or `undefined` when the account was busy
 */
export async function withAccountLock<T>(
  db: Kysely<Database>,
  linkedinAccountId: string,
  work: () => Promise<T>,
): Promise<T | undefined> {
  return db.connection().execute(async (connection) => {
    const locked = await sql<{ locked: boolean }>`
      SELECT pg_try_advisory_lock(${ACCOUNT_LOCK_NAMESPACE}, ${Number(linkedinAccountId)}) AS locked`.execute(connection);
    if (!locked.rows[0]?.locked) return undefined;
    try {
      return await work();
    } finally {
      await sql`SELECT pg_advisory_unlock(${ACCOUNT_LOCK_NAMESPACE}, ${Number(linkedinAccountId)})`.execute(connection);
    }
  });
}

/** Open a run record. @returns its id */
export async function startAgentRun(
  db: Kysely<Database>,
  linkedinAccountId: string,
  trigger: AgentTrigger,
): Promise<string> {
  const row = await db
    .insertInto("agent_runs")
    .values({ linkedin_account_id: linkedinAccountId, trigger })
    .returning("id")
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Close a run with its outcome and the tokens it used. */
export async function finishAgentRun(
  db: Kysely<Database>,
  runId: string,
  outcome: { error?: string; promptTokens: number; completionTokens: number },
): Promise<void> {
  await db
    .updateTable("agent_runs")
    .set({
      status: outcome.error ? "failed" : "done",
      error: outcome.error ?? null,
      prompt_tokens: outcome.promptTokens,
      completion_tokens: outcome.completionTokens,
      finished_at: sql<Date>`now()`,
    })
    .where("id", "=", runId)
    .execute();
}

/** Save one line of the conversation. */
export async function appendAgentMessage(
  db: Kysely<Database>,
  message: {
    linkedinAccountId: string;
    runId?: string;
    role: AgentMessage["role"];
    content?: string | null;
    userId?: string;
    toolCalls?: AgentToolCall[];
    toolCallId?: string;
    toolName?: string;
  },
): Promise<void> {
  await db
    .insertInto("agent_messages")
    .values({
      linkedin_account_id: message.linkedinAccountId,
      run_id: message.runId ?? null,
      role: message.role,
      content: message.content ?? null,
      user_id: message.userId ?? null,
      tool_calls: message.toolCalls ? JSON.stringify(message.toolCalls) : null,
      tool_call_id: message.toolCallId ?? null,
      tool_name: message.toolName ?? null,
    })
    .execute();
}

/** The latest messages of an account's conversation, oldest first. */
export async function recentAgentMessages(
  db: Kysely<Database>,
  linkedinAccountId: string,
  limit: number,
): Promise<AgentMessage[]> {
  const rows = await db
    .selectFrom("agent_messages")
    .select([
      "id",
      "run_id as runId",
      "role",
      "content",
      "tool_calls as toolCalls",
      "tool_call_id as toolCallId",
      "tool_name as toolName",
      "created_at as createdAt",
    ])
    .where("linkedin_account_id", "=", linkedinAccountId)
    .orderBy("id", "desc")
    .limit(limit)
    .execute();
  return rows.reverse();
}

/** Remember something about the account for future runs. */
export async function saveAgentNote(db: Kysely<Database>, linkedinAccountId: string, content: string): Promise<void> {
  await db.insertInto("agent_notes").values({ linkedin_account_id: linkedinAccountId, content }).execute();
}

/** The account's notes, newest first. */
export async function listAgentNotes(
  db: Kysely<Database>,
  linkedinAccountId: string,
  limit: number,
): Promise<{ content: string; createdAt: Date }[]> {
  return db
    .selectFrom("agent_notes")
    .select(["content", "created_at as createdAt"])
    .where("linkedin_account_id", "=", linkedinAccountId)
    .orderBy("id", "desc")
    .limit(limit)
    .execute();
}

/** When the account's agent last started a scheduled run, or nothing if never. */
export async function lastScheduledRunAt(
  db: Kysely<Database>,
  linkedinAccountId: string,
): Promise<Date | undefined> {
  const row = await db
    .selectFrom("agent_runs")
    .select((eb) => eb.fn.max("started_at").as("last"))
    .where("linkedin_account_id", "=", linkedinAccountId)
    .where("trigger", "=", "schedule")
    .executeTakeFirst();
  return row?.last ?? undefined;
}
