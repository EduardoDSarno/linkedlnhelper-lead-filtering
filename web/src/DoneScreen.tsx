import type { ReviewFlow } from './code/useReviewFlow';

/** One download button for an output artifact. */
function DownloadButton({
  label,
  hint,
  primary,
  onClick,
}: {
  label: string;
  hint: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 16px',
        borderRadius: 12,
        border: `1px solid ${primary ? '#2563eb' : '#e2e8f0'}`,
        background: primary ? '#2563eb' : '#fff',
        color: primary ? '#fff' : '#0f172a',
      }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke={primary ? '#fff' : '#2563eb'}
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      <span>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{label}</span>
        <span
          style={{
            display: 'block',
            fontSize: 12,
            marginTop: 1,
            color: primary ? 'rgba(255,255,255,.8)' : '#94a3b8',
          }}
        >
          {hint}
        </span>
      </span>
    </button>
  );
}

/**
 * The final page after a review is concluded: a short summary, the two CSV
 * downloads, and a way back to the list to keep editing.
 */
export function DoneScreen({ flow }: { flow: ReviewFlow }) {
  return (
    <main
      className="sc"
      style={{
        flex: 1,
        overflow: 'auto',
        display: 'flex',
        justifyContent: 'center',
        padding: '72px 24px 80px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 13,
            background: '#ecfdf5',
            border: '1px solid #a7f3d0',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#047857"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <h1 style={{ margin: '18px 0 0', fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' }}>
          Revisão concluída
        </h1>
        <p style={{ margin: '8px 0 0', fontSize: 14.5, lineHeight: 1.6, color: '#64748b' }}>
          {flow.savedApprovedCount ?? 0} perfis aprovados. Baixe o CSV aprovado e
          importe de volta no Linked Helper.
        </p>

        <div style={{ marginTop: 24, display: 'grid', gap: 10 }}>
          <DownloadButton
            label="Baixar CSV aprovado"
            hint="Formato Linked Helper, pronto para reimportar"
            primary
            onClick={() => flow.download('approved')}
          />
          <DownloadButton
            label="Baixar relatório de avaliação"
            hint="Todas as decisões, notas e justificativas"
            onClick={() => flow.download('report')}
          />
        </div>

        <button
          type="button"
          onClick={flow.backToList}
          style={{
            all: 'unset',
            cursor: 'pointer',
            marginTop: 22,
            fontSize: 13,
            fontWeight: 600,
            color: '#2563eb',
          }}
        >
          ← Voltar e editar decisões
        </button>
      </div>
    </main>
  );
}
