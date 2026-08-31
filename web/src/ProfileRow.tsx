import type { PresentedRow } from './code/listView';

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
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onApprove: () => void;
  onReject: () => void;
}

/**
 * One profile in the review list: identity, compensation, age, score, status,
 * and the approve/reject actions that appear more clearly on hover.
 */
export function ProfileRow({
  row,
  selected,
  expanded,
  onSelect,
  onApprove,
  onReject,
}: ProfileRowProps) {
  const approved = row.override === 'approved';
  const rejected = row.override === 'rejected';

  return (
    <div
      className={`lead-row${selected ? ' is-selected' : ''}${row.override ? ' has-override' : ''}`}
      data-row={row.publicId}
      onClick={onSelect}
    >
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: '50%',
          background: row.avBg,
          color: row.avFg,
          display: 'grid',
          placeItems: 'center',
          fontSize: 12.5,
          fontWeight: 600,
        }}
      >
        {row.initials}
      </span>

      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {row.name}
          </span>
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer"
            className="lead-in"
            onClick={(event) => event.stopPropagation()}
            aria-label={`LinkedIn de ${row.name}`}
          >
            <LinkedInIcon />
          </a>
          {row.seniority && (
            <span
              style={{
                flex: 'none',
                fontSize: 11,
                fontWeight: 600,
                color: '#475569',
                background: '#f1f5f9',
                padding: '2px 7px',
                borderRadius: 6,
              }}
            >
              {row.seniority}
            </span>
          )}
          <button
            type="button"
            className="lead-expand-toggle"
            aria-label={`${expanded ? 'Recolher' : 'Expandir'} perfil de ${row.name}`}
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              onSelect();
            }}
          >
            {expanded ? '⌃' : '⌄'}
          </button>
        </span>
        <span
          style={{
            display: 'block',
            fontSize: 12.5,
            color: '#64748b',
            marginTop: 3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {row.line2}
        </span>
        {row.warnings.length > 0 && (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {row.warnings.map((warning) => (
              <span
                key={warning.key}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 11,
                  fontWeight: 500,
                  color: warning.fg,
                  background: warning.bg,
                  border: `1px solid ${warning.bd}`,
                  padding: '2px 8px',
                  borderRadius: 6,
                }}
              >
                {warning.icon} {warning.text}
              </span>
            ))}
          </span>
        )}
      </span>

      <span style={{ fontSize: 12, lineHeight: 1.35 }}>
        <span style={{ display: 'block', fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>
          {row.compensation}
        </span>
        <span style={{ display: 'block', color: '#94a3b8', marginTop: 1 }}>{row.compensationMeta}</span>
      </span>

      <span style={{ fontSize: 12, lineHeight: 1.35 }}>
        <span style={{ display: 'block', fontWeight: 600, color: '#334155' }}>{row.age}</span>
        <span style={{ display: 'block', color: '#94a3b8', marginTop: 1 }}>estimativa</span>
      </span>

      <span style={{ textAlign: 'right' }}>
        <span
          style={{
            display: 'block',
            fontSize: 19,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: row.scoreFg,
          }}
        >
          {row.score}
        </span>
        <span style={{ display: 'block', fontSize: 10.5, color: '#94a3b8', marginTop: -1 }}>
          {row.scoreSub}
        </span>
      </span>

      <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 11.5,
            fontWeight: 600,
            color: row.statusFg,
            background: row.statusBg,
            border: `1px solid ${row.statusBd}`,
            padding: '3px 9px',
            borderRadius: 7,
            whiteSpace: 'nowrap',
          }}
        >
          {row.statusIcon} {row.statusText}
          {row.statusBy && (
            <span style={{ fontWeight: 500, opacity: 0.72 }}>{row.statusBy}</span>
          )}
        </span>
      </span>

      <span className="lead-acts">
        <button
          type="button"
          title="Aprovar (A)"
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
          title="Reprovar (R)"
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
    </div>
  );
}
