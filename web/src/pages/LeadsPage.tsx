import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { api } from "../api";
import type { Campaign, Lead } from "../api";
import { StageBadge, STAGE_ORDER, stageLabel } from "../components/StageBadge";

/**
 * Every lead of the organization, filterable by campaign, stage and name.
 * Filters live in the address, so a filtered view can be bookmarked or shared.
 */
export function LeadsPage() {
  const [params, setParams] = useSearchParams();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [result, setResult] = useState<{ leads: Lead[]; total: number; pageSize: number } | null>(null);
  const [search, setSearch] = useState(params.get("q") ?? "");

  const page = Number(params.get("page")) || 1;

  useEffect(() => {
    api<{ campaigns: Campaign[] }>("/api/campaigns").then((answer) => setCampaigns(answer.campaigns));
  }, []);

  useEffect(() => {
    setResult(null);
    api<{ leads: Lead[]; total: number; pageSize: number }>(`/api/leads?${params}`).then(setResult);
  }, [params]);

  /** Change one filter and go back to the first page. */
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setParams(next);
  }

  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div className="max-w-6xl">
      <h1 className="text-xl font-semibold">Leads</h1>

      <div className="mt-4 flex flex-wrap gap-2">
        <select value={params.get("campaignId") ?? ""} onChange={(event) => filter("campaignId", event.target.value)} className={CONTROL}>
          <option value="">All campaigns</option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
          ))}
        </select>
        <select value={params.get("stage") ?? ""} onChange={(event) => filter("stage", event.target.value)} className={CONTROL}>
          <option value="">All stages</option>
          {STAGE_ORDER.map((stage) => (
            <option key={stage} value={stage}>{stageLabel(stage)}</option>
          ))}
        </select>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            filter("q", search.trim());
          }}
        >
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or headline" className={`${CONTROL} w-64`} />
        </form>
        {result && <span className="self-center text-sm text-slate-500">{result.total} leads</span>}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        {result === null ? (
          <p className="p-6 text-sm text-slate-500">Loading…</p>
        ) : result.leads.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No leads match.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Headline</th>
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="px-4 py-3 text-right font-medium">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">
                    <Link to={`/leads/${lead.id}`} className="text-indigo-700 hover:underline">{lead.name}</Link>
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-slate-600">{lead.headline}</td>
                  <td className="px-4 py-3 text-slate-600">{lead.campaignName}</td>
                  <td className="px-4 py-3"><StageBadge stage={lead.stage} /></td>
                  <td className="px-4 py-3 text-right tabular-nums">{lead.evaluation?.matchPercent ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center gap-3 text-sm">
          <button disabled={page <= 1} onClick={() => filterPage(page - 1)} className={PAGER}>← Previous</button>
          <span className="text-slate-500">Page {page} of {pages}</span>
          <button disabled={page >= pages} onClick={() => filterPage(page + 1)} className={PAGER}>Next →</button>
        </div>
      )}
    </div>
  );

  /** Go to another page, keeping the filters. */
  function filterPage(target: number) {
    const next = new URLSearchParams(params);
    next.set("page", String(target));
    setParams(next);
  }
}

/** Shared styling of the filter controls. */
const CONTROL = "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none";
const PAGER = "rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40";
