import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api";
import type { Campaign, Lead } from "../api";

/**
 * Approved leads waiting for a person to clear their invite.
 *
 * Queued leads are sent by the worker over working hours, within the
 * account's limits, so queuing many at once never means sending them at once.
 */
export function InvitesPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api<{ campaigns: Campaign[] }>("/api/campaigns").then((answer) => setCampaigns(answer.campaigns));
  }, []);

  const load = useCallback(() => {
    setLeads(null);
    setSelected(new Set());
    const params = new URLSearchParams({ stage: "approved", ...(campaignId ? { campaignId } : {}) });
    api<{ leads: Lead[] }>(`/api/leads?${params}`).then((answer) => setLeads(answer.leads));
  }, [campaignId]);

  useEffect(load, [load]);

  const automatic = new Set(campaigns.filter((campaign) => !campaign.requireInviteApproval).map((campaign) => campaign.id));

  /** Add or remove one lead from the selection. */
  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Clear the selected leads for invites. */
  async function queue() {
    const answer = await api<{ queued: number }>("/api/leads/queue", { body: { leadIds: [...selected] } });
    setMessage(`${answer.queued} queued. They'll be sent over working hours, within the account's limits.`);
    load();
  }

  return (
    <div className="max-w-5xl">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Invites</h1>
        <select value={campaignId} onChange={(event) => setCampaignId(event.target.value)} className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="">All campaigns</option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
          ))}
        </select>
      </div>
      <p className="mt-1 text-sm text-slate-500">Approved leads waiting for your OK before a connection request is sent.</p>

      {message && <p className="mt-4 rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{message}</p>}

      <div className="mt-4 flex items-center gap-3">
        <button
          disabled={selected.size === 0}
          onClick={() => void queue()}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          Queue {selected.size || ""} for invite
        </button>
        {leads && leads.length > 0 && (
          <button onClick={() => setSelected(new Set(leads.filter((lead) => !automatic.has(lead.campaignId)).map((lead) => lead.id)))} className="text-sm text-indigo-600 hover:underline">
            Select all
          </button>
        )}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        {leads === null ? (
          <p className="p-6 text-sm text-slate-500">Loading…</p>
        ) : leads.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No approved leads waiting.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="w-10 px-4 py-3" />
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Headline</th>
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 text-right font-medium">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    {automatic.has(lead.campaignId) ? (
                      <span title="This campaign invites automatically" className="text-xs text-slate-400">auto</span>
                    ) : (
                      <input type="checkbox" checked={selected.has(lead.id)} onChange={() => toggle(lead.id)} />
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium">
                    <Link to={`/leads/${lead.id}`} className="text-indigo-700 hover:underline">{lead.name}</Link>
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-slate-600">{lead.headline}</td>
                  <td className="px-4 py-3 text-slate-600">{lead.campaignName}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{lead.evaluation?.matchPercent ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
