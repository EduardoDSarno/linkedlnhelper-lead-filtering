import { useState } from 'react';

import { ConcludeDialog } from './ConcludeDialog';
import { CriteriaModal } from './CriteriaModal';
import { DoneScreen } from './DoneScreen';
import { ListScreen } from './ListScreen';
import { RunNameDialog } from './RunNameDialog';
import { UploadScreen } from './UploadScreen';
import { isCriteriaComplete } from './code/criteria';
import { LIST_TAB, tabCounts } from './code/listView';
import { useReviewFlow } from './code/useReviewFlow';

/** The application shell: top bar, error banner, the active screen, and the modal. */
export default function App() {
  const flow = useReviewFlow();
  const [concludeOpen, setConcludeOpen] = useState(false);

  const counts = tabCounts(flow.results, flow.overrides);

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
          {flow.screen === 'list' && !flow.loading && (
            <>
              {flow.decisionsSaved ? (
                <button
                  type="button"
                  onClick={() => setConcludeOpen(true)}
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#fff',
                    background: '#059669',
                    padding: '6px 13px',
                    borderRadius: 8,
                    boxShadow: '0 1px 2px rgba(5,150,105,.35)',
                  }}
                >
                  Concluir revisão →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={flow.save}
                  disabled={flow.saving}
                  style={{
                    all: 'unset',
                    cursor: flow.saving ? 'not-allowed' : 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#fff',
                    background: '#2563eb',
                    padding: '6px 13px',
                    borderRadius: 8,
                    boxShadow: '0 1px 2px rgba(37,99,235,.35)',
                    opacity: flow.saving ? 0.7 : 1,
                  }}
                >
                  {flow.saving ? 'Salvando…' : 'Salvar decisões'}
                </button>
              )}

              {/* Gap keeps the destructive "new import" away from the primary action. */}
              <span style={{ width: 12 }} />

              <button
                type="button"
                onClick={() => {
                  const confirmed = window.confirm(
                    'Iniciar uma nova importação? As decisões não salvas desta lista serão perdidas.',
                  );
                  if (confirmed) flow.restart();
                }}
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
            </>
          )}

          {flow.screen === 'done' && (
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

      {flow.screen === 'upload' && <UploadScreen flow={flow} />}
      {flow.screen === 'list' && <ListScreen flow={flow} />}
      {flow.screen === 'done' && <DoneScreen flow={flow} />}

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

      {concludeOpen && (
        <ConcludeDialog
          campaignName={flow.campaignName}
          approved={counts[LIST_TAB.approved]}
          rejected={counts[LIST_TAB.rejected]}
          manual={counts[LIST_TAB.manual]}
          onCancel={() => setConcludeOpen(false)}
          onConfirm={() => {
            setConcludeOpen(false);
            flow.conclude();
          }}
        />
      )}

      {flow.runNameOpen && flow.imported && (
        <RunNameDialog
          defaultName={flow.campaignName}
          profileCount={flow.imported.validProfiles}
          onCancel={flow.closeRunName}
          onConfirm={(name) => flow.submit(name)}
        />
      )}
    </div>
  );
}
