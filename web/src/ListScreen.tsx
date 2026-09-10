import { useEffect, useMemo, useRef, useState } from 'react';

import { ProfileDetails } from './ProfileDetails';
import { ProfileRow } from './ProfileRow';
import { criteriaSummary } from './code/criteria';
import {
  LIST_SORT,
  LIST_TAB,
  LIST_TABS,
  presentRow,
  runSummary,
  tabCounts,
  visibleProfiles,
  type ListSort,
  type ListTab,
} from './code/listView';
import type { ReviewFlow } from './code/useReviewFlow';
import type { RunProgress } from './code/api';

/** Keys that must not trigger row actions while a field is focused. */
const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** The campaign name with inline rename, shown above the list title. */
function CampaignName({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const commit = () => {
    onRename(draft.trim() || name);
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
          fontSize: 12.5,
          fontWeight: 600,
          padding: '2px 6px',
          border: '1px solid #cfd8e3',
          borderRadius: 6,
          color: '#334155',
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
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12.5,
        fontWeight: 600,
        color: '#64748b',
      }}
      title="Editar nome da campanha"
    >
      Campanha · {name}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </button>
  );
}

/**
 * The evaluated-profiles screen: search, sort, status tabs, and the designed
 * row layout. Decisions are stored on the flow; everything else (tab, query,
 * sort, which row is selected) stays local because it does not need to persist.
 */
export function ListScreen({ flow }: { flow: ReviewFlow }) {
  const { decide, decideMany, results, overrides, criteria, status, loading } = flow;
  const [tab, setTab] = useState<ListTab>(LIST_TAB.all);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ListSort>(LIST_SORT.score);
  const [selected, setSelected] = useState(0);
  const [expandedPublicId, setExpandedPublicId] = useState<string | undefined>(undefined);
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  // Anchor for shift-click, which selects every row between it and the click.
  const [anchor, setAnchor] = useState<string | undefined>(undefined);

  const bands = { approveMin: criteria.approveMin, manualMin: criteria.manualMin };
  const counts = useMemo(() => tabCounts(results, overrides), [results, overrides]);
  const visible = useMemo(
    () => visibleProfiles(results, overrides, tab, query, sort),
    [results, overrides, tab, query, sort],
  );

  const selectedIndex = visible.length === 0 ? 0 : Math.min(selected, visible.length - 1);
  const selectedId = visible[selectedIndex]?.publicId;

  // Only rows the current tab and search actually show can be acted on, so a
  // selection left behind by a tab change never applies a decision off-screen.
  const checkedVisible = useMemo(
    () => visible.filter((profile) => checked.has(profile.publicId)).map((p) => p.publicId),
    [visible, checked],
  );

  const clearChecked = () => setChecked(new Set());

  const applyBulk = (action: 'approved' | 'rejected' | 'manual') => {
    decideMany(checkedVisible, action);
    clearChecked();
  };

  /** Toggles one row, or extends the selection from the anchor on shift-click. */
  const toggleChecked = (publicId: string, shiftKey: boolean) => {
    setChecked((current) => {
      const next = new Set(current);

      if (shiftKey && anchor) {
        const ids = visible.map((profile) => profile.publicId);
        const from = ids.indexOf(anchor);
        const to = ids.indexOf(publicId);
        if (from !== -1 && to !== -1) {
          for (const id of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) {
            next.add(id);
          }
          return next;
        }
      }

      if (next.has(publicId)) next.delete(publicId);
      else next.add(publicId);
      return next;
    });
    setAnchor(publicId);
  };

  useEffect(() => {
    if (!selectedId) return;
    document.querySelector(`[data-row="${CSS.escape(selectedId)}"]`)?.scrollIntoView({
      block: 'nearest',
    });
  }, [selectedId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (TYPING_TAGS.has((event.target as HTMLElement).tagName)) return;
      if (visible.length === 0) return;

      const key = event.key.toLowerCase();
      const current = visible[selectedIndex];
      if (!current) return;

      if (key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        setSelected(Math.min(visible.length - 1, selectedIndex + 1));
        return;
      }
      if (key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        setSelected(Math.max(0, selectedIndex - 1));
        return;
      }
      if (key === 'a') decide(current.publicId, 'approved');
      if (key === 'r') decide(current.publicId, 'rejected');
      if (key === 'm') decide(current.publicId, 'manual');
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decide, selectedIndex, visible]);

  if (loading) return <LoadingState progress={status?.progress} />;

  const summary = runSummary(
    results.length,
    criteriaSummary(criteria),
    status?.completedAt,
  );

  return (
    <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 'none', background: '#fff', borderBottom: '1px solid #e6e9ef', padding: '16px 22px 0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18, flexWrap: 'wrap' }}>
          <div>
            <CampaignName
              name={flow.campaignName}
              onRename={flow.renameCampaign}
            />
            <h1 style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>
              Perfis avaliados
            </h1>
            <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 3 }}>{summary}</div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <svg
                style={{ position: 'absolute', left: 9, pointerEvents: 'none' }}
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#94a3b8"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.7" y2="16.7" />
              </svg>
              <input
                placeholder="Buscar nome, cargo, empresa"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelected(0);
                }}
                style={{
                  width: 250,
                  fontSize: 13,
                  padding: '8px 11px 8px 28px',
                  border: '1px solid #e2e8f0',
                  borderRadius: 9,
                  background: '#fff',
                  color: '#0f172a',
                }}
              />
            </span>
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as ListSort);
                setSelected(0);
              }}
              style={{
                fontSize: 13,
                padding: '8px 10px',
                border: '1px solid #e2e8f0',
                borderRadius: 9,
                background: '#fff',
                color: '#334155',
                cursor: 'pointer',
              }}
            >
              <option value={LIST_SORT.score}>Maior nota</option>
              <option value={LIST_SORT.scoreAsc}>Menor nota</option>
              <option value={LIST_SORT.name}>Nome A–Z</option>
              <option value={LIST_SORT.compensation}>Maior remuneração estimada</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 14 }}>
          {LIST_TABS.map((label) => {
            const on = tab === label;
            return (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setTab(label);
                  setSelected(0);
                }}
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  fontSize: 13,
                  fontWeight: on ? 600 : 500,
                  color: on ? '#0f172a' : '#64748b',
                  padding: '9px 13px',
                  borderBottom: `2px solid ${on ? '#2563eb' : 'transparent'}`,
                }}
              >
                {label}
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: on ? '#1d4ed8' : '#64748b',
                    background: on ? '#e0edff' : '#f1f5f9',
                    padding: '1px 7px',
                    borderRadius: 99,
                  }}
                >
                  {counts[label]}
                </span>
              </button>
            );
          })}
          <span
            style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11.5,
              color: '#94a3b8',
              paddingBottom: 8,
            }}
          >
            <Kbd>J</Kbd>
            <Kbd>K</Kbd>
            navegar ·
            <Kbd>A</Kbd>
            aprovar ·
            <Kbd>M</Kbd>
            manual ·
            <Kbd>R</Kbd>
            reprovar
          </span>
        </div>
      </div>

      <div
        className="sc"
        style={{ flex: 1, minHeight: 0, overflow: 'auto', background: '#eef1f6', padding: '0 24px 70px' }}
      >
        <SelectionBar
          checkedCount={checkedVisible.length}
          visibleCount={visible.length}
          counts={counts}
          onToggleAll={() => {
            if (checkedVisible.length === visible.length) clearChecked();
            else setChecked(new Set(visible.map((profile) => profile.publicId)));
          }}
          onApprove={() => applyBulk('approved')}
          onReject={() => applyBulk('rejected')}
          onManual={() => applyBulk('manual')}
          onClear={clearChecked}
        />

        <div className="lead-list">
        {visible.length === 0 ? (
          <div style={{ padding: '70px 24px', textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#334155' }}>
              Nenhum perfil nesta visão
            </div>
            <div style={{ fontSize: 13, marginTop: 5 }}>
              Ajuste a busca ou volte para a aba “Todos”.
            </div>
          </div>
        ) : (
          visible.map((profile, index) => {
            const expanded = profile.publicId === expandedPublicId;
            const presented = presentRow(profile, overrides[profile.publicId], bands);

            return (
              <div key={profile.publicId}>
                <ProfileRow
                  row={presented}
                  selected={index === selectedIndex}
                  expanded={expanded}
                  checked={checked.has(profile.publicId)}
                  onSelect={() => {
                    setSelected(index);
                    setExpandedPublicId((current) =>
                      current === profile.publicId ? undefined : profile.publicId,
                    );
                  }}
                  onCheck={(event) => {
                    setSelected(index);
                    toggleChecked(profile.publicId, event.shiftKey);
                  }}
                  onApprove={() => decide(profile.publicId, 'approved')}
                  onReject={() => decide(profile.publicId, 'rejected')}
                />
                {expanded && (
                  <ProfileDetails
                    profile={profile}
                    row={presented}
                    onClose={() => setExpandedPublicId(undefined)}
                  />
                )}
              </div>
            );
          })
        )}
        </div>
      </div>
    </main>
  );
}

/** Props for the bulk-action bar above the rows. */
interface SelectionBarProps {
  checkedCount: number;
  visibleCount: number;
  counts: Record<ListTab, number>;
  onToggleAll: () => void;
  onApprove: () => void;
  onReject: () => void;
  onManual: () => void;
  onClear: () => void;
}

/**
 * The bar that turns a selection into one decision for many profiles.
 *
 * With nothing selected it explains how selection works rather than showing
 * disabled buttons, and it always carries the live decision tally so the
 * reviewer can see the shape of the run without counting rows.
 */
function SelectionBar({
  checkedCount,
  visibleCount,
  counts,
  onToggleAll,
  onApprove,
  onReject,
  onManual,
  onClear,
}: SelectionBarProps) {
  const master = useRef<HTMLInputElement>(null);
  const some = checkedCount > 0;
  const all = visibleCount > 0 && checkedCount === visibleCount;

  // `indeterminate` is a DOM property with no HTML attribute, so a partial
  // selection can only be painted through the node itself.
  useEffect(() => {
    if (master.current) master.current.indeterminate = some && !all;
  }, [some, all]);

  return (
    <div className={`bulk-bar${some ? ' is-active' : ''}`}>
      <label className="bulk-select-all">
        <input
          ref={master}
          type="checkbox"
          className="cbx"
          checked={all}
          disabled={visibleCount === 0}
          onChange={onToggleAll}
        />
        <span style={{ color: some ? '#1d4ed8' : '#334155' }}>
          {some ? `${String(checkedCount)} de ${String(visibleCount)} selecionados` : 'Selecionar todos'}
        </span>
      </label>

      {some ? (
        <span className="bulk-actions">
          <span className="bulk-divider" />
          <button type="button" className="bulk-btn is-approve" onClick={onApprove}>
            Aprovar {checkedCount} selecionados
          </button>
          <button type="button" className="bulk-btn is-reject" onClick={onReject}>
            Reprovar {checkedCount}
          </button>
          <button type="button" className="bulk-btn is-manual" onClick={onManual}>
            Marcar como manual
          </button>
          <button type="button" className="bulk-btn is-plain" onClick={onClear}>
            Limpar seleção
          </button>
        </span>
      ) : (
        <span className="bulk-hint">
          Selecione perfis para aprovar, reprovar ou marcar em lote.{' '}
          <b>Shift + clique</b> seleciona um intervalo.
        </span>
      )}

      <span className="bulk-tally">
        {counts[LIST_TAB.approved]} aprovados · {counts[LIST_TAB.manual]} manuais ·{' '}
        {counts[LIST_TAB.rejected]} reprovados
      </span>
    </div>
  );
}

/** Small keycap used in the shortcut hint. */
function Kbd({ children }: { children: string }) {
  return (
    <b
      style={{
        fontWeight: 600,
        color: '#475569',
        background: '#f1f5f9',
        border: '1px solid #e2e8f0',
        borderRadius: 5,
        padding: '1px 5px',
      }}
    >
      {children}
    </b>
  );
}
/** Portuguese label for each reported stage, in running order. */
const PROGRESS_STAGES = [
  { key: 'collecting', label: 'Coletando perfis' },
  { key: 'loading_photos', label: 'Baixando fotos' },
  { key: 'evaluating', label: 'Avaliando com a IA' },
] as const;

/** The stage label, or a neutral one before the first stage reports. */
function stageLabel(progress: RunProgress | undefined): string {
  if (!progress) return 'Preparando…';
  return (
    PROGRESS_STAGES.find((stage) => stage.key === progress.stage)?.label ??
    'Processando'
  );
}

/**
 * One bar for the whole run, shown from the moment it starts.
 *
 * The bar is always present: before the first stage reports it simply sits at
 * zero with a neutral label, rather than swapping between two different
 * widgets. `overall` already spans every stage, so the fill only ever moves
 * forward as the run advances from collection through to scoring.
 */
function LoadingState({ progress }: { progress?: RunProgress }) {
  const percent = Math.round((progress?.overall ?? 0) * 100);
  const showCounts = Boolean(progress && progress.total > 0);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
      }}
    >
      <div style={{ width: 340 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            fontSize: 13,
            fontWeight: 600,
            color: '#1d4ed8',
            marginBottom: 7,
          }}
        >
          <span>{stageLabel(progress)}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: '#475569' }}>
            {percent}%
          </span>
        </div>

        <div
          style={{
            height: 7,
            borderRadius: 99,
            background: '#e6e9ef',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${String(percent)}%`,
              background: '#2563eb',
              borderRadius: 99,
              transition: 'width .5s ease',
            }}
          />
        </div>

        {showCounts && progress && (
          <div
            style={{
              marginTop: 6,
              fontSize: 12,
              color: '#94a3b8',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {progress.completed} de {progress.total} nesta etapa
          </div>
        )}
      </div>

      <div style={{ fontSize: 12.5, color: '#94a3b8' }}>
        Isso leva alguns minutos. Pode deixar a aba aberta.
      </div>
    </div>
  );
}
