import { useState } from 'react';

/** Props: the default name, and the cancel/confirm actions. */
interface RunNameDialogProps {
  defaultName: string;
  profileCount: number;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}

/**
 * Asked for right before a run starts: names the campaign.
 *
 * Prefilled with the CSV file name so the user can just confirm, or rename.
 * The name is optional in spirit — an empty box falls back to the file name.
 */
export function RunNameDialog({ defaultName, profileCount, onCancel, onConfirm }: RunNameDialogProps) {
  const [name, setName] = useState(defaultName);

  const confirm = () => onConfirm(name.trim() || defaultName);

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
          Nome da campanha
        </h2>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>
          Identifica esta avaliação de {profileCount} perfis. Você pode editar
          depois.
        </p>

        <input
          value={name}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') confirm();
            if (event.key === 'Escape') onCancel();
          }}
          placeholder="Ex.: Gestores comerciais SaaS — set/2026"
          style={{
            width: '100%',
            marginTop: 16,
            fontSize: 14,
            padding: '10px 12px',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            background: '#fff',
            color: '#0f172a',
          }}
        />

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
            onClick={confirm}
            style={{
              all: 'unset',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              background: '#2563eb',
              padding: '10px 18px',
              borderRadius: 9,
              boxShadow: '0 1px 2px rgba(37,99,235,.35)',
            }}
          >
            Iniciar avaliação
          </button>
        </div>
      </div>
    </div>
  );
}
