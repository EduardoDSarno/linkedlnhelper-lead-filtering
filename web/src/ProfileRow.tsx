import { useState, type MouseEvent } from 'react';

import type { PresentedEntry, PresentedRow, PresentedWarning } from './code/listView';

/** How many entries in a block are readable without hovering it. */
const ALWAYS_VISIBLE_ENTRIES = 2;

/** LinkedIn mark used as the outbound profile link. */
function LinkedInIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM2.5 9.5h5V21h-5zM9.5 9.5h4.8v1.6a5 5 0 0 1 4.3-2c3.1 0 4.4 2 4.4 5.3V21h-5v-5.4c0-1.4-.5-2.3-1.7-2.3-1.3 0-2 .9-2 2.3V21h-4.8z" />
    </svg>
  );
}

/** Props for one evaluated-profile row. */
interface ProfileRowProps {
  row: PresentedRow;
  expanded: boolean;
  checked: boolean;
  onSelect: () => void;
  onCheck: (event: MouseEvent) => void;
  onApprove: () => void;
  onReject: () => void;
}

/**
 * One profile in the review list.
 *
 * The row carries every field a decision normally needs — identity, the start
 * of the career and of the education, the estimates, the score and the status
 * — so the expanded panel is only for the model's reasoning. Both career
 * blocks read oldest first and reveal the rest of their history on hover
 * rather than on a click, which keeps a scan of twenty rows to zero
 * navigation.
 */
export function ProfileRow({
  row,
  expanded,
  checked,
  onSelect,
  onCheck,
  onApprove,
  onReject,
}: ProfileRowProps) {
  const approved = row.override === 'approved';
  const rejected = row.override === 'rejected';
  const [photoFailed, setPhotoFailed] = useState(false);
  const showPhoto = row.photo && !photoFailed;

  const stop = (event: MouseEvent) => event.stopPropagation();

  return (
    <div
      className={`lead-row${checked ? ' is-checked' : ''}${expanded ? ' is-open' : ''}`}
      data-row={row.publicId}
      onClick={onSelect}
    >
      <span className="lead-check" onClick={stop}>
        <input
          type="checkbox"
          className="cbx"
          checked={checked}
          aria-label={`Selecionar ${row.name}`}
          onChange={() => undefined}
          onClick={onCheck}
        />
      </span>

      {showPhoto ? (
        <span className="row-avatar">
          <img
            src={row.photo}
            alt={`Foto de ${row.name}`}
            referrerPolicy="no-referrer"
            loading="lazy"
            onError={() => setPhotoFailed(true)}
          />
          <span className="profile-photo-preview" aria-hidden="true">
            <img src={row.photo} alt="" />
            <span>{row.name}</span>
          </span>
        </span>
      ) : (
        <span className="lead-initials" style={{ background: row.avBg, color: row.avFg }}>
          {row.initials}
        </span>
      )}

      <span className="lead-main">
        <span className="lead-identity">
          <span className="lead-name">{row.name}</span>
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            className="lead-in"
            onClick={stop}
            aria-label={`LinkedIn de ${row.name}`}
          >
            <LinkedInIcon />
          </a>
          {row.seniority && <span className="lead-tag">{row.seniority}</span>}
          {row.jobless && <span className="lead-tag is-jobless">Desempregado</span>}
          {row.location && <span className="lead-location">{row.location}</span>}

          <span className="lead-metrics">
            <span>
              R$ <b>{row.compensationAmount}</b>/mês{' '}
              <span className="lead-qualifier">conf. {row.compensationConfidence}</span>
            </span>
            <span>
              <b>{row.ageRange}</b> anos <span className="lead-qualifier">est.</span>
            </span>
          </span>
        </span>

        <span className="lead-blocks">
          <CareerBlock
            label="Experiência"
            tag={row.experienceTag}
            tagWarn={row.experienceTagWarn}
            entries={row.jobs}
            emptyText="Histórico profissional não informado"
            onClick={stop}
          />
          <CareerBlock
            label="Formação"
            tag={row.educationTag}
            entries={row.education}
            emptyText="Formação não informada"
            onClick={stop}
          />
        </span>

        <span className="lead-footer">
          {row.warnings.map((warning) => (
            <RowChip key={warning.key} warning={warning} />
          ))}
          <button
            type="button"
            className="lead-analysis-toggle"
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              onSelect();
            }}
          >
            {expanded ? 'Recolher ↑' : 'Ver análise da IA ↓'}
          </button>
        </span>
      </span>

      <span className="lead-score">
        <span style={{ color: row.scoreFg }}>{row.score}</span>
        <span className="lead-score-sub">{row.scoreSub}</span>
      </span>

      <span className="lead-decision">
        <span
          className="lead-status"
          style={{ color: row.statusFg, background: row.statusBg, borderColor: row.statusBd }}
        >
          {row.statusIcon} {row.statusText}
          {row.statusBy && <span className="lead-status-by">{row.statusBy}</span>}
        </span>
        <span className="lead-acts">
          <button
            type="button"
            title="Aprovar"
            className="lead-act"
            onClick={(event) => {
              event.stopPropagation();
              onApprove();
            }}
            style={{
              color: approved ? '#fff' : '#047857',
              background: approved ? '#059669' : '#fff',
              border: `1px solid ${approved ? '#059669' : '#a7f3d0'}`,
            }}
          >
            Aprovar
          </button>
          <button
            type="button"
            title="Reprovar"
            className="lead-act"
            onClick={(event) => {
              event.stopPropagation();
              onReject();
            }}
            style={{
              color: rejected ? '#fff' : '#be123c',
              background: rejected ? '#e11d48' : '#fff',
              border: `1px solid ${rejected ? '#e11d48' : '#fecdd3'}`,
            }}
          >
            Reprovar
          </button>
        </span>
      </span>
    </div>
  );
}

/**
 * One career block: a labelled count, the two entries that matter, and the
 * rest revealed on hover or keyboard focus.
 *
 * `tabindex` is what makes the hover reveal reachable without a mouse — the
 * same `:focus-within` rule that opens it on focus opens it on hover.
 */
function CareerBlock({
  label,
  tag,
  tagWarn,
  entries,
  emptyText,
  onClick,
}: {
  label: string;
  tag: string;
  tagWarn?: boolean;
  entries: PresentedEntry[];
  emptyText: string;
  onClick: (event: MouseEvent) => void;
}) {
  const head = entries.slice(0, ALWAYS_VISIBLE_ENTRIES);
  const rest = entries.slice(ALWAYS_VISIBLE_ENTRIES);

  return (
    <span className="lead-block" tabIndex={0} onClick={onClick}>
      <span className="lead-block-head">
        <span className="lead-block-label">{label}</span>
        <span className={`lead-block-tag${tagWarn ? ' is-warn' : ''}`}>{tag}</span>
        {rest.length > 0 && <span className="lead-block-cue">passe o mouse ↓</span>}
      </span>
      {head.length === 0 ? (
        <span className="lead-entry is-empty">{emptyText}</span>
      ) : (
        head.map((entry, index) => (
          <BlockEntry key={entry.key} entry={entry} lead={index === 0} />
        ))
      )}
      {rest.length > 0 && (
        <span className="lead-block-more">
          {rest.map((entry) => (
            <BlockEntry key={entry.key} entry={entry} lead={false} />
          ))}
        </span>
      )}
    </span>
  );
}

/** One line of a career block. The first entry reads darker than the rest. */
function BlockEntry({ entry, lead }: { entry: PresentedEntry; lead: boolean }) {
  const className = entry.alert
    ? 'lead-entry is-alert'
    : `lead-entry${lead ? ' is-lead' : ''}`;

  return (
    <span className={className}>
      {entry.text}
      {entry.when && <span className="lead-entry-when"> · {entry.when}</span>}
    </span>
  );
}

/** Compact highlight chip that reveals the full sentence on hover. */
function RowChip({ warning }: { warning: PresentedWarning }) {
  const chipStyle = {
    color: warning.fg,
    background: warning.bg,
    borderColor: warning.bd,
  };

  return (
    <span className="lead-chip" style={chipStyle}>
      <RowChipLabel warning={warning} />
      <span className="lead-chip-expand" aria-hidden="true">
        <RowChipLabel warning={warning} />
      </span>
    </span>
  );
}

/** Icon plus sentence shared by the compact chip and its hover expansion. */
function RowChipLabel({ warning }: { warning: PresentedWarning }) {
  return (
    <>
      {warning.icon && (
        <span aria-hidden="true" className="lead-chip-icon">
          {warning.icon}
        </span>
      )}
      <span className="lead-chip-text">{warning.text}</span>
    </>
  );
}
