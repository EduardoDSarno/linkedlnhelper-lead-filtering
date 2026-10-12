/** Colors per campaign status, so state reads at a glance in lists. */
const STYLES: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  paused: "bg-amber-50 text-amber-700",
  completed: "bg-slate-100 text-slate-600",
};

/** A small colored pill showing a campaign's status. */
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STYLES[status] ?? STYLES["completed"]}`}>
      {status}
    </span>
  );
}
