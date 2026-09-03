import { useState } from 'react';

import { CampaignsScreen } from './CampaignsScreen';
import { ConcludeDialog } from './ConcludeDialog';
import { CriteriaModal } from './CriteriaModal';
import { LeaveDialog } from './LeaveDialog';
import { ListScreen } from './ListScreen';
import { RunNameDialog } from './RunNameDialog';
import { UploadScreen } from './UploadScreen';
import { isCriteriaComplete } from './code/criteria';
import { LIST_TAB, tabCounts } from './code/listView';
import { useReviewFlow, type Screen } from './code/useReviewFlow';

/** One centered page link in the top-bar navigation. */
function NavItem({ label, active, disabled, title, onClick }: {
  label: string;
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-current={active ? 'page' : undefined}
      style={{
        all: 'unset',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 13,
        fontWeight: 600,
        color: disabled ? '#cbd5e1' : active ? '#1d4ed8' : '#64748b',
        background: active ? '#eef4ff' : 'transparent',
        padding: '6px 13px',
        borderRadius: 8,
      }}
    >
      {label}
    </button>
  );
}

/** The application shell: top bar, error banner, the active screen, and the modal. */
export default function App() {
  const flow = useReviewFlow();
  const [concludeOpen, setConcludeOpen] = useState(false);

  const counts = tabCounts(flow.results, flow.overrides);

  // The navigation held back by the unsaved-changes guard, run once resolved.
  const [pendingLeave, setPendingLeave] = useState<{ run: () => void } | null>(null);

  /**
   * Navigates to another page. Leaving the review list with unsaved decisions
   * opens the guard dialog instead; clicking the current page is a no-op.
   */
  const navTo = (target: Screen, go: () => void) => {
    if (flow.screen === target) return;
    if (flow.screen === 'list' && flow.dirty) {
      setPendingLeave({ run: go });
      return;
    }
    go();
  };

  /** Leaves without saving, discarding the unsaved decisions. */
  const discardAndLeave = () => {
    const run = pendingLeave?.run;
    setPendingLeave(null);
    run?.();
  };

  /** Saves the decisions first, then leaves only if the save succeeded. */
  const saveAndLeave = async () => {
    const run = pendingLeave?.run;
    const saved = await flow.save();
    setPendingLeave(null);
    if (saved) run?.();
  };

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
        {/* Left: brand. Kept in a flex:1 box so the nav stays truly centered. */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
          <span
            style={{
              width: 24,
              height: 24,
              flex: 'none',
              borderRadius: 7,
              background: 'linear-gradient(150deg,#3b82f6,#1d4ed8)',
              display: 'inline-block',
            }}
          />
          <span style={{ fontWeight: 700, fontSize: 15.5, letterSpacing: '-0.02em' }}>
            Leadscan
          </span>
        </div>

        {/* Center: the page navigation. The review list is a focused flow, not
            a navbar destination, but stays reachable via a campaign's "Revisar". */}
        <nav style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
          <NavItem
            label="Importar"
            active={flow.screen === 'upload'}
            onClick={() => navTo('upload', flow.restart)}
          />
          <NavItem
            label="Campanhas"
            active={flow.screen === 'campaigns'}
            onClick={() => navTo('campaigns', flow.goToCampaigns)}
          />
        </nav>

        {/* Right: the current screen's primary action, then the account chip. */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
          {flow.screen === 'list' && !flow.loading && (
            flow.decisionsSaved ? (
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
            )
          )}
          <span
            style={{
              width: 28,
              height: 28,
              flex: 'none',
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
      {flow.screen === 'campaigns' && <CampaignsScreen flow={flow} />}

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

      {pendingLeave && (
        <LeaveDialog
          saving={flow.saving}
          onClose={() => setPendingLeave(null)}
          onDiscard={discardAndLeave}
          onSaveAndLeave={() => void saveAndLeave()}
        />
      )}
    </div>
  );
}
