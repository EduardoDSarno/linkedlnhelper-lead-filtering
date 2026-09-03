import { useCallback, useEffect, useState } from 'react';

import { deleteRun, listRuns, renameRun, startDownload } from './code/client';
import type { CampaignSummary, DecisionCounts } from './code/api';
import type { ReviewFlow } from './code/useReviewFlow';

/** Human labels + colors for a run status. */
const STATUS_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  queued: { text: 'Na fila', color: '#475569', bg: '#f1f5f9' },
  running: { text: 'Processando', color: '#1d4ed8', bg: '#e0edff' },
  completed: { text: 'Concluída', color: '#047857', bg: '#ecfdf5' },
  failed: { text: 'Falhou', color: '#9f1239', bg: '#fff1f2' },
  expired: { text: 'Expirada', color: '#92400e', bg: '#fffbeb' },
};

/** Shortens a system prompt for the table cell. */
function shorten(text: string | undefined, max = 130): string {
  if (!text) return '—';
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** A labeled download button; the approved variant is emphasized. */
function DownloadCell({ label, primary, disabled, onClick }: {
  label: string;
  primary?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={disabled ? 'Disponível quando a campanha concluir' : undefined}
      style={{
        all: 'unset',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 12,
        fontWeight: 600,
        padding: '5px 10px',
        borderRadius: 7,
        border: `1px solid ${primary ? '#059669' : '#cbd5e1'}`,
        background: disabled ? '#f1f5f9' : primary ? '#059669' : '#fff',
        color: disabled ? '#94a3b8' : primary ? '#fff' : '#334155',
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {label}
    </button>
  );
}

/** One editable campaign name cell. */
function NameCell({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== name) onRename(next);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setEditing(false);
        }}
        style={{
          width: '100%',
          fontSize: 13.5,
          fontWeight: 600,
          padding: '4px 7px',
          border: '1px solid #cfd8e3',
          borderRadius: 6,
          color: '#0f172a',
          background: '#fff',
        }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(name);
        setEditing(true);
      }}
      title="Clique para editar o nome"
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'block',
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: 13.5,
        fontWeight: 600,
        color: '#0f172a',
      }}
    >
      {name || 'Sem nome'}
    </button>
  );
}

/** One colored count chip in the results cell. */
function Tally({ icon, value, color, bg, title, emphasize }: {
  icon: string;
  value: number;
  color: string;
  bg: string;
  title: string;
  emphasize?: boolean;
}) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 11.5,
        fontWeight: 700,
        color,
        background: bg,
        padding: '2px 7px',
        borderRadius: 999,
        border: `1px solid ${emphasize ? color : 'transparent'}`,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true" style={{ fontWeight: 400 }}>{icon}</span>
      {value}
    </span>
  );
}

/**
 * Compact tally of a campaign's final decisions. When any profiles are still in
 * manual review, that chip turns into an outlined warning so unfinished
 * campaigns stand out.
 */
function CountsCell({ counts }: { counts?: DecisionCounts }) {
  if (!counts) {
    return <span style={{ fontSize: 12.5, color: '#94a3b8' }}>—</span>;
  }

  const pending = counts.manual > 0;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
      <Tally icon="✓" value={counts.approved} color="#047857" bg="#ecfdf5" title={`${counts.approved} aprovados`} />
      <Tally
        icon={pending ? '⚠' : '◐'}
        value={counts.manual}
        color="#92400e"
        bg="#fffbeb"
        emphasize={pending}
        title={
          pending
            ? `${counts.manual} perfis ainda em revisão manual`
            : 'Nenhum perfil em revisão manual'
        }
      />
      <Tally icon="✕" value={counts.rejected} color="#9f1239" bg="#fff1f2" title={`${counts.rejected} reprovados`} />
    </span>
  );
}

/**
 * The campaigns table: every past run with its shortened prompt, status,
 * inline rename, delete, and the two labeled downloads. This is the app's
 * home once a review is concluded.
 */
export function CampaignsScreen({ flow }: { flow: ReviewFlow }) {
  const [runs, setRuns] = useState<CampaignSummary[]>([]);
  const [pendingDelete, setPendingDelete] = useState<CampaignSummary | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRuns(await listRuns());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rename = async (processingId: string, name: string) => {
    setRuns((current) =>
      current.map((run) => (run.processingId === processingId ? { ...run, name } : run)),
    );
    try {
      await renameRun(processingId, name);
    } catch {
      void load();
    }
  };

  const remove = async (processingId: string) => {
    setRuns((current) => current.filter((run) => run.processingId !== processingId));
    try {
      await deleteRun(processingId);
    } catch {
      void load();
    }
  };

  return (
    <main
      className="sc"
      style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', padding: '40px 24px 80px' }}
    >
      <div style={{ width: '100%', maxWidth: 1120 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
          Campanhas
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: '#94a3b8' }}>
          Baixe o CSV aprovado para reimportar no Linked Helper, ou o relatório
          completo de avaliação.
        </p>

        {error && (
          <div style={{ marginTop: 16, fontSize: 13, color: '#9f1239' }}>{error}</div>
        )}

        {loading ? (
          <div style={{ marginTop: 40, fontSize: 13, color: '#94a3b8' }}>Carregando…</div>
        ) : runs.length === 0 ? (
          <div style={{ marginTop: 40, fontSize: 13.5, color: '#64748b' }}>
            Nenhuma campanha ainda. Importe um CSV para começar.
          </div>
        ) : (
          <div
            style={{
              marginTop: 20,
              border: '1px solid #e6e9ef',
              borderRadius: 14,
              background: '#fff',
              overflow: 'hidden',
            }}
          >
            {/* header row */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) 104px 168px 92px 300px',
                gap: 14,
                padding: '11px 18px',
                fontSize: 11.5,
                fontWeight: 600,
                color: '#94a3b8',
                background: '#f8fafc',
                borderBottom: '1px solid #eceff3',
              }}
            >
              <span>Campanha</span>
              <span>Perfil ideal (prompt)</span>
              <span>Status</span>
              <span>Resultados</span>
              <span>Atualizada em</span>
              <span style={{ textAlign: 'right' }}>Ações</span>
            </div>

            {runs.map((run) => {
              const status = STATUS_LABEL[run.status] ?? STATUS_LABEL.queued!;
              const done = run.status === 'completed';
              return (
                <div
                  key={run.processingId}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) 104px 168px 92px 300px',
                    gap: 14,
                    padding: '13px 18px',
                    alignItems: 'center',
                    borderBottom: '1px solid #f1f5f9',
                  }}
                >
                  <NameCell name={run.name} onRename={(name) => void rename(run.processingId, name)} />

                  <span style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.5 }}>
                    {shorten(run.systemPrompt)}
                  </span>

                  <span>
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: status.color,
                        background: status.bg,
                        padding: '3px 9px',
                        borderRadius: 7,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {status.text}
                    </span>
                  </span>

                  <CountsCell counts={run.counts} />

                  <span style={{ fontSize: 12.5, color: '#64748b', whiteSpace: 'nowrap' }}>
                    {new Date(run.updatedAt ?? run.createdAt).toLocaleDateString('pt-BR')}
                  </span>

                  <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                    <button
                      type="button"
                      disabled={!done}
                      onClick={() => void flow.reopen(run)}
                      title={done ? 'Reabrir para revisar as decisões' : 'Disponível quando a campanha concluir'}
                      style={{
                        all: 'unset',
                        cursor: done ? 'pointer' : 'not-allowed',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        fontSize: 12,
                        fontWeight: 600,
                        padding: '5px 10px',
                        borderRadius: 7,
                        border: '1px solid #cbd5e1',
                        background: done ? '#fff' : '#f1f5f9',
                        color: done ? '#2563eb' : '#94a3b8',
                        opacity: done ? 1 : 0.7,
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                      Revisar
                    </button>
                    <DownloadCell
                      label="Aprovados"
                      primary
                      disabled={!done}
                      onClick={() => startDownload(run.processingId, 'approved')}
                    />
                    <DownloadCell
                      label="Relatório"
                      disabled={!done}
                      onClick={() => startDownload(run.processingId, 'report')}
                    />
                    <button
                      type="button"
                      onClick={() => setPendingDelete(run)}
                      title="Excluir campanha"
                      onMouseEnter={(event) => {
                        event.currentTarget.style.color = '#e11d48';
                        event.currentTarget.style.background = '#fff1f2';
                      }}
                      onMouseLeave={(event) => {
                        event.currentTarget.style.color = '#94a3b8';
                        event.currentTarget.style.background = 'transparent';
                      }}
                      style={{
                        all: 'unset',
                        cursor: 'pointer',
                        color: '#94a3b8',
                        padding: '4px 6px',
                        borderRadius: 6,
                        transition: 'color .12s, background .12s',
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {pendingDelete && (
        <DeleteDialog
          name={pendingDelete.name || pendingDelete.processingId}
          onCancel={() => setPendingDelete(undefined)}
          onConfirm={() => {
            void remove(pendingDelete.processingId);
            setPendingDelete(undefined);
          }}
        />
      )}
    </main>
  );
}

/** Confirmation for the irreversible deletion of one campaign. */
function DeleteDialog({ name, onCancel, onConfirm }: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
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
          maxWidth: 420,
          background: '#fff',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(15,23,42,.28)',
          padding: '22px',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>
          Excluir campanha?
        </h2>
        <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.55, color: '#475569' }}>
          “{name}” e seus arquivos (CSV aprovado e relatório) serão removidos
          permanentemente. Esta ação não pode ser desfeita.
        </p>

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
              background: '#e11d48',
              padding: '10px 18px',
              borderRadius: 9,
              boxShadow: '0 1px 2px rgba(225,29,72,.35)',
            }}
          >
            Excluir
          </button>
        </div>
      </div>
    </div>
  );
}
