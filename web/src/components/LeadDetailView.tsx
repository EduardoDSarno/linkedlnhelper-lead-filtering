import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { api } from "../api";
import type { LeadDetail, ProfileDate } from "../api";
import { StageBadge } from "./StageBadge";

/** Stages where the person was already contacted, so a decision is no longer offered. */
const CONTACTED = new Set(["invited", "accepted"]);

/**
 * Everything needed to judge one lead: who the campaign looks for, the AI's
 * score and reasons, the profile itself, and Approve / Reject.
 *
 * Shared by the lead page and the review queue, so a decision looks and is
 * recorded the same way wherever it is made.
 */
export function LeadDetailView(props: { detail: LeadDetail; onDecided(): void; showCampaignPrompt?: boolean }) {
  const { lead, profile, reviews, campaignPrompt } = props.detail;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Save the decision with the optional note, then let the parent move on. */
  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/leads/${lead.id}/review`, { body: { decision, note } });
      setNote("");
      props.onDecided();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save the decision.");
    } finally {
      setBusy(false);
    }
  }

  const evaluation = lead.evaluation;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-6">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold">{lead.name}</h1>
            <StageBadge stage={lead.stage} />
          </div>
          <p className="mt-1 text-sm text-slate-600">{lead.headline}</p>
          <p className="mt-1 text-xs text-slate-500">
            {lead.location} · <Link to={`/campaigns/${lead.campaignId}`} className="hover:underline">{lead.campaignName}</Link>
            {profile && (
              <>
                {" · "}
                <a href={profile.linkedinUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                  LinkedIn profile ↗
                </a>
              </>
            )}
          </p>
        </div>

        {props.showCampaignPrompt && campaignPrompt && (
          <Card title="The campaign is looking for">
            <p className="whitespace-pre-wrap text-sm text-slate-700">{campaignPrompt}</p>
          </Card>
        )}

        <Card title="AI verdict">
          {evaluation ? (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-3">
                <span className="text-2xl font-semibold">{evaluation.matchPercent}</span>
                <span className="text-slate-500">/ 100</span>
              </div>
              <p>{evaluation.summary}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <ReasonList title="For" tone="text-emerald-700" items={evaluation.positives} />
                <ReasonList title="Against" tone="text-red-700" items={evaluation.negatives} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              {lead.stage === "manual_review" ? "The AI could not judge this profile; please decide." : "Not evaluated yet."}
            </p>
          )}
        </Card>

        {profile && (
          <Card title="Profile">
            {profile.about && <p className="mb-4 whitespace-pre-wrap text-sm text-slate-700">{profile.about}</p>}
            <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">Experience</h3>
            <ul className="mb-4 space-y-2 text-sm">
              {profile.experience.map((job, index) => (
                <li key={index}>
                  <span className="font-medium">{job.position}</span> · {job.companyName}
                  <span className="text-slate-500"> — {dateRange(job.startDate, job.endDate)}</span>
                </li>
              ))}
            </ul>
            <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">Education</h3>
            <ul className="space-y-2 text-sm">
              {profile.education.map((school, index) => (
                <li key={index}>
                  <span className="font-medium">{school.schoolName}</span>
                  {[school.degree, school.fieldOfStudy].filter(Boolean).length > 0 && ` · ${[school.degree, school.fieldOfStudy].filter(Boolean).join(", ")}`}
                  <span className="text-slate-500"> — {dateRange(school.startDate, school.endDate)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <div className="space-y-6">
        {!CONTACTED.has(lead.stage) && (
          <Card title="Your decision">
            <textarea
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional note: why? (helps tune the criteria)"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                disabled={busy}
                onClick={() => void decide("rejected")}
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
              >
                Reject
              </button>
              <button
                disabled={busy}
                onClick={() => void decide("approved")}
                className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                Approve
              </button>
            </div>
          </Card>
        )}

        {reviews.length > 0 && (
          <Card title="History">
            <ul className="space-y-3 text-sm">
              {reviews.map((review, index) => (
                <li key={index}>
                  <span className="font-medium capitalize">{review.decision}</span> by {review.reviewer}
                  <div className="text-xs text-slate-500">
                    {new Date(review.createdAt).toLocaleString()}
                    {review.modelDecision && ` · AI said ${review.modelDecision.replace("_", " ")} (${review.modelScore})`}
                  </div>
                  {review.note && <p className="mt-1 text-slate-600">“{review.note}”</p>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

/** A titled list of the AI's reasons. */
function ReasonList(props: { title: string; tone: string; items: string[] }) {
  return (
    <div>
      <h3 className={`mb-1 text-xs font-semibold uppercase ${props.tone}`}>{props.title}</h3>
      <ul className="list-disc space-y-1 pl-4 text-slate-700">
        {props.items.length ? props.items.map((item, index) => <li key={index}>{item}</li>) : <li className="list-none text-slate-400">—</li>}
      </ul>
    </div>
  );
}

/** "Mar 2019 – Present" style text from LinkedIn's partial dates. */
function dateRange(start?: ProfileDate, end?: ProfileDate): string {
  return [start, end].map((date) => (date ? formatDate(date) : "?")).join(" – ");
}

/** One partial date as text. */
function formatDate(date: ProfileDate): string {
  if (date.text) return date.text;
  if (!date.year) return "?";
  return date.month ? new Date(date.year, date.month - 1).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : String(date.year);
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
