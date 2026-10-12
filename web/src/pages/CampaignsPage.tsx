import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api";
import type { Campaign } from "../api";
import { StatusBadge } from "../components/StatusBadge";

/** Every campaign of the organization, with a button to set up a new one. */
export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ campaigns: Campaign[] }>("/api/campaigns")
      .then((answer) => setCampaigns(answer.campaigns))
      .catch((failure: Error) => setError(failure.message));
  }, []);

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Campaigns</h1>
          <p className="mt-1 text-sm text-slate-500">Each campaign searches with one account and evaluates who it finds.</p>
        </div>
        <Link to="/campaigns/new" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
          New campaign
        </Link>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {campaigns === null ? (
          <p className="p-6 text-sm text-slate-500">Loading…</p>
        ) : campaigns.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No campaigns yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Account</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Goal</th>
                <th className="px-4 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {campaigns.map((campaign) => (
                <tr key={campaign.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">
                    <Link to={`/campaigns/${campaign.id}`} className="text-indigo-700 hover:underline">{campaign.name}</Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{campaign.accountLabel}</td>
                  <td className="px-4 py-3"><StatusBadge status={campaign.status} /></td>
                  <td className="px-4 py-3 text-slate-600">
                    {campaign.approvedTarget ? `${campaign.approvedTarget} approved` : "Until search ends"}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{new Date(campaign.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
