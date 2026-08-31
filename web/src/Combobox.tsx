import { useMemo, useRef, useState } from 'react';

/** Props for a chip field backed by a fixed suggestion list. */
interface ComboboxProps {
  /** Chips already chosen. */
  values: string[];

  /** The closed set of suggestions to filter as the user types. */
  suggestions: string[];

  /** Adds one value; ignored by the parent when already present. */
  onAdd: (value: string) => void;

  /** Removes the chip at one index. */
  onRemove: (index: number) => void;

  placeholder?: string;
}

/** How many matching suggestions to show at once. */
const MAX_SUGGESTIONS = 8;

/**
 * A chip field with autocomplete over a known list.
 *
 * Suited to a closed set such as locations: typing filters the suggestions
 * shown below, and Enter or a click adds a chip. A value not in the list can
 * still be added by typing it and pressing Enter, because profile locations
 * vary beyond any curated list.
 */
export function Combobox({
  values,
  suggestions,
  onAdd,
  onRemove,
  placeholder,
}: ComboboxProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<number | undefined>(undefined);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    const chosen = new Set(values.map((value) => value.toLowerCase()));
    return suggestions
      .filter(
        (suggestion) =>
          suggestion.toLowerCase().includes(needle) &&
          !chosen.has(suggestion.toLowerCase()),
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [query, suggestions, values]);

  /** Adds a value and resets the input. */
  function add(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setQuery('');
    setOpen(false);
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {values.map((value, index) => (
        <span
          key={`${value}-${index}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            fontWeight: 500,
            color: '#334155',
            background: '#f1f5f9',
            border: '1px solid #e2e8f0',
            padding: '4px 6px 4px 10px',
            borderRadius: 8,
          }}
        >
          {value}
          <button
            type="button"
            onClick={() => onRemove(index)}
            style={{ all: 'unset', cursor: 'pointer', color: '#94a3b8', padding: '0 3px' }}
          >
            ✕
          </button>
        </span>
      ))}

      {/* The input carries its own relative context so the dropdown anchors to
          it and follows it as chips push it around the wrapping row. */}
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <input
          value={query}
          placeholder={placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay so a click on a suggestion registers before it closes.
            blurTimer.current = window.setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add(matches[0] ?? query);
            }
            if (event.key === 'Escape') setOpen(false);
          }}
          style={{
            width: 200,
            fontSize: 12.5,
            padding: '6px 10px',
            border: '1px dashed #cfd8e3',
            borderRadius: 8,
            background: '#fff',
            color: '#0f172a',
          }}
        />

        {open && matches.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 4,
              minWidth: 220,
              zIndex: 10,
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              boxShadow: '0 8px 24px rgba(15,23,42,.12)',
              overflow: 'hidden',
            }}
          >
            {matches.map((match) => (
            <button
              key={match}
              type="button"
              // onMouseDown so the click lands before the input's blur closes this.
              onMouseDown={(event) => {
                event.preventDefault();
                window.clearTimeout(blurTimer.current);
                add(match);
              }}
              style={{
                all: 'unset',
                cursor: 'pointer',
                display: 'block',
                width: '100%',
                boxSizing: 'border-box',
                padding: '8px 12px',
                fontSize: 12.5,
                color: '#334155',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = '#f1f5f9';
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = 'transparent';
              }}
            >
              {match}
            </button>
          ))}
          </div>
        )}
      </span>
    </div>
  );
}
