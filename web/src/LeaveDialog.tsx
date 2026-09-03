/** Actions for the unsaved-changes guard shown when leaving the review list. */
interface LeaveDialogProps {
  saving: boolean;
  onClose: () => void;
  onDiscard: () => void;
  onSaveAndLeave: () => void;
}

/**
 * Guards navigation away from the review list when decisions are unsaved. The
 * reviewer can discard the changes, save them and leave, or close the dialog to
 * stay and keep editing.
 */
export function LeaveDialog({ saving, onClose, onDiscard, onSaveAndLeave }: LeaveDialogProps) {
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
          position: 'relative',
          width: '100%',
          maxWidth: 440,
          background: '#fff',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(15,23,42,.28)',
          padding: '22px',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          title="Fechar"
          style={{
            all: 'unset',
            position: 'absolute',
            top: 14,
            right: 14,
            cursor: 'pointer',
            color: '#94a3b8',
            lineHeight: 0,
            padding: 4,
            borderRadius: 7,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <h2 style={{ margin: '0 26px 0 0', fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>
          Você tem alterações não salvas
        </h2>
        <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.55, color: '#475569' }}>
          As decisões que você alterou nesta lista ainda não foram salvas. Se sair
          agora sem salvar, elas serão perdidas.
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            style={{
              all: 'unset',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: 13,
              fontWeight: 600,
              color: '#be123c',
              padding: '9px 14px',
              border: '1px solid #fecdd3',
              borderRadius: 9,
              background: '#fff',
              opacity: saving ? 0.6 : 1,
            }}
          >
            Não salvar
          </button>
          <button
            type="button"
            onClick={onSaveAndLeave}
            disabled={saving}
            style={{
              all: 'unset',
              cursor: saving ? 'not-allowed' : 'pointer',
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              background: '#2563eb',
              padding: '10px 18px',
              borderRadius: 9,
              boxShadow: '0 1px 2px rgba(37,99,235,.35)',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Salvando…' : 'Salvar e sair'}
          </button>
        </div>
      </div>
    </div>
  );
}
