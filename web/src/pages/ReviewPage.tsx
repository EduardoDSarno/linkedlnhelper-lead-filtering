import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import type { Campaign, LeadDetail } from "../api";
import { LeadDetailView } from "../components/LeadDetailView";

/**
 * The manual review queue: the leads the AI was unsure about, one at a time,
 * oldest first. Each decision loads the next lead.
 */
export function ReviewPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [detail, setDetail] = useState<LeadDetail | null>(null);

  useEffect(() => {
    api<{ campaigns: Campaign[] }>("/api/campaigns").then((answer) => setCampaigns(answer.campaigns));
  }, []);

  const next = useCallback(async () => {
    setDetail(null);
    const query = campaignId ? `?campaignId=${campaignId}` : "";
    const answer = await api<{ leadId?: string; remaining: number }>(`/api/review/next${query}`);
    setRemaining(answer.remaining);
    if (answer.leadId) setDetail(await api<LeadDetail>(`/api/leads/${answer.leadId}`));
  }, [campaignId]);

  useEffect(() => {
    void next();
  }, [next]);

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Review</h1>
        {remaining !== null && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{remaining} waiting</span>
        )}
        <select
          value={campaignId}
          onChange={(event) => setCampaignId(event.target.value)}
          className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="">All campaigns</option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
          ))}
        </select>
      </div>

      {remaining === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          Nothing to review. New leads appear here when the AI is unsure.
        </div>
      ) : detail ? (
        <LeadDetailView detail={detail} onDecided={() => void next()} showCampaignPrompt />
      ) : (
        <p className="text-sm text-slate-500">Loading…</p>
      )}
    </div>
  );
}
