import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { api } from "../api";
import type { AgentMessage, LinkedinAccount } from "../api";

/** How often the conversation reloads, so scheduled check-ins appear without a refresh. */
const REFRESH_INTERVAL_MS = 15_000;

/** Prefix the agent's scheduled runs open with, shown as a divider rather than a bubble. */
const SCHEDULED_PREFIX = "[Scheduled check-in";

/**
 * Talk to an account's agent: ask about campaigns, change goals, or see what
 * it did on its own. Every tool call it made is shown inline and can be opened.
 */
export function AgentPage() {
  const [accounts, setAccounts] = useState<LinkedinAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [text, setText] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ accounts: LinkedinAccount[] }>("/api/linkedin-accounts").then((answer) => {
      setAccounts(answer.accounts);
      setAccountId((current) => current || answer.accounts[0]?.id || "");
    });
  }, []);

  const load = useCallback(async () => {
    if (!accountId) return;
    const answer = await api<{ messages: AgentMessage[] }>(`/api/linkedin-accounts/${accountId}/agent/messages`);
    setMessages(answer.messages);
  }, [accountId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [messages.length, working]);

  /** Send the message; the agent runs at once and its work appears when done. */
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setWorking(true);
    setError(null);
    const sent = text;
    setText("");
    try {
      await api(`/api/linkedin-accounts/${accountId}/agent/messages`, { body: { text: sent } });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The agent could not answer.");
      setText(sent);
    } finally {
      setWorking(false);
      void load();
    }
  }

  const results = new Map(messages.filter((line) => line.role === "tool").map((line) => [line.toolCallId, line]));

  return (
    <div className="flex h-[calc(100vh-4rem)] max-w-4xl flex-col">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Agent</h1>
        <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>{account.label}</option>
          ))}
        </select>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Ask about your campaigns, change goals or criteria, or see what the agent did on its own. Every action goes through its tools and is logged here.
      </p>

      <div className="mt-4 flex-1 space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4">
        {messages.length === 0 && <p className="text-sm text-slate-500">No conversation yet. Say hello, or wait for the first check-in.</p>}
        {messages.map((line) => {
          if (line.role === "tool") return null;
          if (line.role === "user" && line.content?.startsWith(SCHEDULED_PREFIX)) {
            return (
              <div key={line.id} className="py-1 text-center text-xs text-slate-400">
                Scheduled check-in · {new Date(line.createdAt).toLocaleString()}
              </div>
            );
          }
          if (line.role === "user") {
            return (
              <div key={line.id} className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2 text-sm text-white">
                {line.content}
              </div>
            );
          }
          return (
            <div key={line.id} className="max-w-[85%] space-y-1">
              {line.toolCalls?.map((call) => (
                <ToolCallRow key={call.id} name={call.function.name} args={call.function.arguments} result={results.get(call.id)?.content ?? null} />
              ))}
              {line.content && (
                <div className="whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2 text-sm">{line.content}</div>
              )}
            </div>
          );
        })}
        {working && <p className="text-sm text-slate-500">The agent is working…</p>}
        <div ref={bottom} />
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <form onSubmit={send} className="mt-3 flex gap-2">
        <input
          value={text}
          disabled={!accountId || working}
          onChange={(event) => setText(event.target.value)}
          placeholder="e.g. How is the advisors campaign doing? / Raise its target to 300."
          className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />
        <button disabled={!accountId || working} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          Send
        </button>
      </form>
    </div>
  );
}

/** One tool call, collapsed to its name; opens to show arguments and result. */
function ToolCallRow(props: { name: string; args: string; result: string | null }) {
  const refused = props.result?.startsWith("Refused") || props.result?.startsWith("Error");
  return (
    <details className="rounded-md border border-slate-200 text-xs">
      <summary className={`cursor-pointer px-3 py-1.5 font-mono ${refused ? "text-amber-700" : "text-slate-600"}`}>
        {props.name}({compactArgs(props.args)}){refused ? " — refused" : ""}
      </summary>
      <pre className="overflow-x-auto whitespace-pre-wrap border-t border-slate-100 bg-slate-50 px-3 py-2 text-slate-600">
        {props.result ?? "(no result saved)"}
      </pre>
    </details>
  );
}

/** Arguments as `key: value` pairs, for the collapsed row. */
function compactArgs(raw: string): string {
  try {
    return Object.entries(JSON.parse(raw || "{}") as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join(", ");
  } catch {
    return raw;
  }
}
