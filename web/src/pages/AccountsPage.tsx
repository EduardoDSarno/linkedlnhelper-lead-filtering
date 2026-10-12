import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { api } from "../api";
import type { LinkedinAccount } from "../api";

/**
 * The organization's LinkedIn accounts, and a form to connect another.
 *
 * With Unipile the server answers with a login link, opened in a new tab; the
 * account appears here once Unipile reports the login. In fake mode it
 * appears immediately.
 */
export function AccountsPage() {
  const [accounts, setAccounts] = useState<LinkedinAccount[] | null>(null);
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ accounts: LinkedinAccount[] }>("/api/linkedin-accounts")
      .then((answer) => setAccounts(answer.accounts))
      .catch((failure: Error) => setMessage(failure.message));
  }, []);

  useEffect(load, [load]);

  /** Ask the server to connect an account under the typed label. */
  async function connect(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      const answer = await api<{ url?: string; connected?: boolean }>("/api/linkedin-accounts/connect", {
        body: { label },
      });
      if (answer.url) {
        window.open(answer.url, "_blank", "noopener");
        setMessage("Finish the LinkedIn login in the new tab, then refresh this page.");
      } else {
        setMessage("Account connected (fake mode).");
      }
      setLabel("");
      load();
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : "Could not connect.");
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold">LinkedIn accounts</h1>
      <p className="mt-1 text-sm text-slate-500">Each account runs its own campaigns, within its own safety limits.</p>

      <form onSubmit={connect} className="mt-6 flex gap-2">
        <input
          required
          placeholder="Label, e.g. Ana – Ascendia"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />
        <button className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          Connect account
        </button>
      </form>
      {message && <p className="mt-3 text-sm text-slate-600">{message}</p>}

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {accounts === null ? (
          <p className="p-6 text-sm text-slate-500">Loading…</p>
        ) : accounts.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No accounts yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Label</th>
                <th className="px-4 py-3 font-medium">Connected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td className="px-4 py-3 font-medium">{account.label}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(account.connected_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
