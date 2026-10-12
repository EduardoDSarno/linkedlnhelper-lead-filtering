import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { api } from "../api";
import type { LeadDetail } from "../api";
import { LeadDetailView } from "../components/LeadDetailView";

/** One lead, where its AI verdict can be confirmed or overridden. */
export function LeadPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<LeadDetail>(`/api/leads/${id}`)
      .then(setDetail)
      .catch((failure: Error) => setError(failure.message));
  }, [id]);

  useEffect(load, [load]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!detail) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="max-w-6xl space-y-4">
      <Link to="/leads" className="text-sm text-indigo-600 hover:underline">← Leads</Link>
      <LeadDetailView detail={detail} onDecided={load} />
    </div>
  );
}
