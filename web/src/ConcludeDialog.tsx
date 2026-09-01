/** Counts shown in the conclude confirmation. */
interface ConcludeDialogProps {
  campaignName: string;
  approved: number;
  rejected: number;
  manual: number;
  onCancel: () => void;
  onConfirm: () => void;
}

/** One count chip in the summary row. */
function Count({ icon, label, value, color }: { icon: string; label: string; value: number; color: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#334155' }}>
      <span style={{ color, fontWeight: 700 }}>{icon}</span>
      <b style={{ fontWeight: 700 }}>{value}</b> {label}
    </span>
  );
}

/**
 * Confirmation shown when concluding a review.
 *
 * It states how the decisions break down and — when profiles are still in
 * manual review — warns that they will not enter the approved CSV, so the user
 * concludes knowing what is left out.
 */
export function ConcludeDialog({ campaignName, approved, rejected, manual, onCancel, onConfirm }: ConcludeDialogProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(15,23,42,.42)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          background: '#fff',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(15,23,42,.28)',
          padding: '22px',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>
          Concluir “{campaignName}”?
        </h2>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 14 }}>
          <Count icon="✓" label="aprovados" value={approved} color="#047857" />
          <Count icon="✕" label="reprovados" value={rejected} color="#be123c" />
          <Count icon="◐" label="em revisão" value={manual} color="#b45309" />
        </div>

        {manual > 0 && (
          <div
            style={{
              marginTop: 16,
              fontSize: 12.5,
              lineHeight: 1.55,
              color: '#92400e',
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: 10,
              padding: '10px 12px',
            }}
          >
            {manual} {manual === 1 ? 'perfil ainda está' : 'perfis ainda estão'} em
            revisão manual e <b>não {manual === 1 ? 'entrará' : 'entrarão'}</b> no CSV
            aprovado. Decida {manual === 1 ? 'esse perfil' : 'esses perfis'} antes de
            concluir se quiser incluí-{manual === 1 ? 'lo' : 'los'}.
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              all: 'unset',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              color: '#475569',
              padding: '9px 14px',
              border: '1px solid #e2e8f0',
              borderRadius: 9,
              background: '#fff',
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              all: 'unset',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              background: '#059669',
              padding: '10px 18px',
              borderRadius: 9,
              boxShadow: '0 1px 2px rgba(5,150,105,.35)',
            }}
          >
            {manual > 0 ? 'Concluir mesmo assim' : 'Concluir'}
          </button>
        </div>
      </div>
    </div>
  );
}
