import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api";
import type { Campaign, CampaignInsights, LeadStage, PeopleSearch } from "../api";
import { STAGE_ORDER, stageLabel } from "../components/StageBadge";
import { StatusBadge } from "../components/StatusBadge";

/** One campaign: what it searches for, who qualifies, and pause / resume. */
export function CampaignPage() {
  const { id } = useParams();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [counts, setCounts] = useState<Partial<Record<LeadStage, number>>>({});
  const [insights, setInsights] = useState<CampaignInsights | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ campaign: Campaign }>(`/api/campaigns/${id}`)
      .then((answer) => setCampaign(answer.campaign))
      .catch((failure: Error) => setError(failure.message));
    api<{ counts: Partial<Record<LeadStage, number>> }>(`/api/campaigns/${id}/funnel`).then((answer) => setCounts(answer.counts));
    api<CampaignInsights>(`/api/campaigns/${id}/insights`).then(setInsights);
  }, [id]);

  useEffect(load, [load]);

  /** Turn "I approve invites before they're sent" on or off. */
  async function toggleApproval() {
    if (!campaign) return;
    try {
      await api(`/api/campaigns/${campaign.id}/invite-approval`, { body: { required: !campaign.requireInviteApproval } });
      load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not change the setting.");
    }
  }

  /** Switch between active and paused. */
  async function toggle() {
    if (!campaign) return;
    const status = campaign.status === "active" ? "paused" : "active";
    try {
      await api(`/api/campaigns/${campaign.id}/status`, { body: { status } });
      load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not change the status.");
    }
  }

  if (error && !campaign) return <p className="text-sm text-red-600">{error}</p>;
  if (!campaign) return <p className="text-sm text-slate-500">Loading…</p>;

  const policy = campaign.criteria.decisionPolicy;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link to="/campaigns" className="text-sm text-indigo-600 hover:underline">← Campaigns</Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-xl font-semibold">{campaign.name}</h1>
          <StatusBadge status={campaign.status} />
          {campaign.status !== "completed" && (
            <button
              onClick={() => void toggle()}
              className="ml-auto rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              {campaign.status === "active" ? "Pause" : "Resume"}
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {campaign.accountLabel} · created {new Date(campaign.createdAt).toLocaleDateString()}
        </p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      <Card title="Funnel">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STAGE_ORDER.map((stage) => (
            <Link
              key={stage}
              to={`/leads?campaignId=${campaign.id}&stage=${stage}`}
              className="rounded-lg border border-slate-200 px-3 py-2 hover:border-indigo-300"
            >
              <div className="text-lg font-semibold tabular-nums">{counts[stage] ?? 0}</div>
              <div className="text-xs text-slate-500">{stageLabel(stage)}</div>
            </Link>
          ))}
        </div>
        {campaign.approvedTarget && (
          <p className="mt-3 text-xs text-slate-500">
            {counts.approved ?? 0} of {campaign.approvedTarget} approved leads collected.
          </p>
        )}
      </Card>

      {insights && (
        <Card title="What the AI has learned">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Stat label="Agrees with you" value={percent(insights.reviews.agreementRate)} hint={`${insights.reviews.agreed} of ${insights.reviews.total} reviewed`} />
            <Stat label="Approval rate" value={percent(insights.approvalRate)} hint="of evaluated leads" />
            <Stat label="Invites accepted" value={percent(insights.acceptanceRate)} hint="of invites sent" />
          </div>
          {insights.reviews.total > 0 && (
            <p className="mt-3 text-xs text-slate-500">
              You overrode the AI {insights.reviews.aiTooLoose} time(s) where it approved someone you rejected, and {insights.reviews.aiTooStrict} time(s) where it rejected someone you approved.
              The agent uses this to suggest prompt changes, tested against your past decisions first.
            </p>
          )}
        </Card>
      )}

      <Card title="Invites">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={campaign.requireInviteApproval} onChange={() => void toggleApproval()} />
          <span>
            <span className="font-medium">I approve invites before they're sent</span>
            <span className="block text-slate-500">
              {campaign.requireInviteApproval
                ? "Approved leads wait on the Invites page until you queue them."
                : "Approved leads are invited automatically, within the account's limits and working hours."}
            </span>
          </span>
        </label>
      </Card>

      <Card title="Search">
        <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
          {searchRows(campaign.search).map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-500">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Who you're looking for">
        <p className="whitespace-pre-wrap text-sm">{campaign.criteria.systemPrompt}</p>
      </Card>

      <Card title="Decisions and goal">
        <ul className="space-y-1 text-sm">
          <li>Approved at score {policy?.minimumApprovalPercent ?? "–"} or more; manual review from {policy?.minimumManualReviewPercent ?? "–"}.</li>
          <li>{campaign.approvedTarget ? `Stops after ${campaign.approvedTarget} approved leads.` : "Runs until the search runs out."}</li>
          <li>
            Budgets: {campaign.weeklyInviteLimit ?? "account cap"} invites/week, {campaign.dailyProfileLimit ?? "account cap"} profiles/day.
          </li>
        </ul>
      </Card>
    </div>
  );
}

/** The search's set fields as label / value rows, showing names instead of ids. */
function searchRows(search: PeopleSearch): [string, string][] {
  const named = (ids?: string[]) => (ids ?? []).map((id) => search.titles?.[id] ?? id).join(", ");
  const rows: [string, string | undefined][] = [
    ["Keywords", search.keywords],
    ["Title", search.title],
    ["Company", search.company],
    ["School", search.school],
    ["Locations", named(search.locationIds)],
    ["Industries", named(search.industryIds)],
    ["Current companies", named(search.companyIds)],
    ["Past companies", named(search.pastCompanyIds)],
    ["Schools", named(search.schoolIds)],
    ["Connection degree", search.networkDistance?.map((degree) => (degree === 3 ? "3rd+" : degree === 2 ? "2nd" : "1st")).join(", ")],
    ["Profile language", search.profileLanguages?.join(", ")],
  ];
  return rows.filter((row): row is [string, string] => Boolean(row[1]));
}

/** A big number with a label and a small explanation. */
function Stat(props: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <div className="text-lg font-semibold tabular-nums">{props.value}</div>
      <div className="text-xs font-medium">{props.label}</div>
      <div className="text-xs text-slate-500">{props.hint}</div>
    </div>
  );
}

/** A share as a whole percentage, or a dash when there is nothing to divide yet. */
function percent(share: number | null): string {
  return share === null ? "–" : `${Math.round(share * 100)}%`;
}

/** A titled white card. */
function Card(props: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold">{props.title}</h2>
      {props.children}
    </section>
  );
}
