import type { ReviewFlow } from './scripts/useReviewFlow';

/** Human labels for the model decision on each row (temporary, minimal list). */
const DECISION_LABEL: Record<string, string> = {
  approved: 'Aprovado',
  rejected: 'Reprovado',
  manual_review: 'Revisão manual',
};

/**
 * The evaluated-profiles screen.
 *
 * For now it shows a loading state while the run works and a bare list once
 * results arrive — enough to prove the start → poll → results flow. The full
 * designed table (tabs, search, sort, per-row actions) comes next.
 */
export function ListScreen({ flow }: { flow: ReviewFlow }) {
  if (flow.loading) {
    return (
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
        }}
      >
        <div
          style={{
            width: 300,
            height: 5,
            borderRadius: 99,
            background: '#e6e9ef',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: '40%',
              background: '#2563eb',
              borderRadius: 99,
              animation: 'lead-progress 1.1s ease-in-out infinite',
            }}
          />
        </div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Avaliando perfis com IA…</div>
        <div style={{ fontSize: 12.5, color: '#94a3b8' }}>
          Coletando, analisando e pontuando. Isso leva alguns minutos.
        </div>
        <style>
          {`@keyframes lead-progress {
              0% { margin-left: -40%; }
              100% { margin-left: 100%; }
            }`}
        </style>
      </main>
    );
  }

  return (
    <main
      className="sc"
      style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '20px 22px 60px' }}
    >
      <h1 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>
        Perfis avaliados
      </h1>
      <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 16 }}>
        {flow.results.length} perfis
      </div>

      {flow.results.map((profile) => (
        <div
          key={profile.publicId}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 4px',
            borderBottom: '1px solid #eceff3',
          }}
        >
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>
            {profile.name || profile.publicId}
          </span>
          <span style={{ width: 48, textAlign: 'right', fontWeight: 700 }}>
            {profile.matchPercent ?? '—'}
          </span>
          <span style={{ width: 120, textAlign: 'right', fontSize: 12.5, color: '#64748b' }}>
            {profile.modelDecision
              ? DECISION_LABEL[profile.modelDecision]
              : profile.broadDecision === 'Failed'
                ? 'Filtrado'
                : '—'}
          </span>
        </div>
      ))}
    </main>
  );
}
