import type { LeadStage } from "../api";

/** Label and colors per stage, so a lead's state reads at a glance. */
const STAGES: Record<LeadStage, { label: string; style: string }> = {
  found: { label: "Found", style: "bg-slate-100 text-slate-600" },
  profiled: { label: "Profiled", style: "bg-sky-50 text-sky-700" },
  approved: { label: "Approved", style: "bg-emerald-50 text-emerald-700" },
  manual_review: { label: "Manual review", style: "bg-amber-50 text-amber-700" },
  rejected: { label: "Rejected", style: "bg-red-50 text-red-700" },
  queued: { label: "Queued", style: "bg-indigo-50 text-indigo-600" },
  invited: { label: "Invited", style: "bg-indigo-100 text-indigo-800" },
  accepted: { label: "Accepted", style: "bg-violet-50 text-violet-700" },
  failed: { label: "Failed", style: "bg-slate-200 text-slate-600" },
};

/** Every stage in funnel order, for filters and the campaign funnel. */
export const STAGE_ORDER = Object.keys(STAGES) as LeadStage[];

/** The human label of a stage. */
export function stageLabel(stage: LeadStage): string {
  return STAGES[stage].label;
}

/** A small colored pill showing a lead's stage. */
export function StageBadge({ stage }: { stage: LeadStage }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STAGES[stage].style}`}>{STAGES[stage].label}</span>;
}
