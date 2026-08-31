import { CriteriaModal } from './CriteriaModal';
import { ListScreen } from './ListScreen';
import { UploadScreen } from './UploadScreen';
import { isCriteriaComplete } from './code/criteria';
import { useReviewFlow } from './code/useReviewFlow';

/** The application shell: top bar, error banner, the active screen, and the modal. */
export default function App() {
  const flow = useReviewFlow();

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '0 22px',
          height: 56,
          background: '#fff',
          borderBottom: '1px solid #e6e9ef',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: 7,
              background: 'linear-gradient(150deg,#3b82f6,#1d4ed8)',
              display: 'inline-block',
            }}
          />
          <span style={{ fontWeight: 700, fontSize: 15.5, letterSpacing: '-0.02em' }}>
            Leadscan
          </span>
        </div>
        <span style={{ fontSize: 12.5, color: '#94a3b8' }}>
          Avaliação de perfis do LinkedIn com IA
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {flow.screen === 'list' && (
            <button
              type="button"
              onClick={flow.restart}
              style={{
                all: 'unset',
                cursor: 'pointer',
                fontSize: 13,
                color: '#475569',
                padding: '6px 11px',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                background: '#fff',
              }}
            >
              Nova importação
            </button>
          )}
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: '#e8edf5',
              color: '#475569',
              fontSize: 11.5,
              fontWeight: 600,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            RM
          </span>
        </div>
      </header>

      {flow.error && (
        <div
          style={{
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 22px',
            background: '#fff1f2',
            borderBottom: '1px solid #fecdd3',
            color: '#9f1239',
            fontSize: 13,
          }}
        >
          <span style={{ fontWeight: 600 }}>Erro:</span>
          <span style={{ flex: 1 }}>{flow.error}</span>
          <button
            type="button"
            onClick={flow.dismissError}
            style={{ all: 'unset', cursor: 'pointer', color: '#be123c', fontWeight: 600, padding: '2px 6px' }}
          >
            ✕
          </button>
        </div>
      )}

      {flow.screen === 'upload' ? (
        <UploadScreen flow={flow} />
      ) : (
        <ListScreen flow={flow} />
      )}

      {flow.criteriaOpen && (
        <CriteriaModal
          form={flow.criteria}
          update={flow.updateCriteria}
          onClose={flow.closeCriteria}
          onConfirm={() => {
            if (isCriteriaComplete(flow.criteria)) flow.confirmCriteria();
          }}
        />
      )}
    </div>
  );
}
