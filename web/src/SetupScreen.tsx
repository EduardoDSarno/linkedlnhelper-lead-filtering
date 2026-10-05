import { useState } from 'react';

import { saveCredentials } from './code/client';
import type { CredentialsCheck, CredentialsStatus } from './code/api';

/** Where the operator goes to create each key, shown beside its field. */
const KEY_SOURCES = {
  openRouter: 'https://openrouter.ai/keys',
} as const;

/** One labelled key field with its own help line. */
function KeyField({ label, help, link, placeholder, value, tail, onChange }: {
  label: string;
  help: string;
  link: string;
  placeholder: string;
  value: string;
  tail?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ display: 'block', marginBottom: 18 }}>
      <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 5 }}>
        {label}
      </span>

      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        placeholder={tail ? `Salva nesta máquina (termina em ${tail})` : placeholder}
        onChange={(event) => onChange(event.target.value)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '9px 11px',
          fontSize: 13,
          fontFamily: 'ui-monospace, monospace',
          border: '1px solid #d7dce5',
          borderRadius: 8,
          outline: 'none',
        }}
      />

      <span style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginTop: 5 }}>
        {help}{' '}
        <a href={link} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>
          Pegar a chave
        </a>
      </span>
    </label>
  );
}

/** One service's verdict after the backend asked the service itself. */
function CheckLine({ service, check }: { service: string; check?: { valid: boolean; error?: string; remainingCredit?: number; label?: string } }) {
  if (!check) return null;

  const credit =
    check.valid && typeof check.remainingCredit === 'number'
      ? ` — resta US$ ${check.remainingCredit.toFixed(2)}`
      : '';

  return (
    <div
      style={{
        fontSize: 12.5,
        marginTop: 4,
        color: check.valid ? '#15803d' : '#b91c1c',
      }}
    >
      {check.valid ? '✓' : '✕'} {service}
      {check.valid ? `: conectado${check.label ? ` (${check.label})` : ''}${credit}` : `: ${check.error ?? 'chave recusada'}`}
    </div>
  );
}

/**
 * The gate shown until the OpenRouter key is in place.
 *
 * The keys live in the running server by default and are gone when it stops,
 * which is why this screen exists at all rather than a file someone has to
 * edit. Remembering it is offered because pasting a long string at every
 * launch is its own kind of friction, and the alternative is the operator
 * keeping them somewhere less safe than this machine.
 */
export function SetupScreen({ status, notice, onReady }: {
  status: CredentialsStatus;
  /** Why the operator was sent back here, when a held key stopped working. */
  notice?: string;
  onReady: (status: CredentialsStatus) => void;
}) {
  const [openRouter, setOpenRouter] = useState('');
  const [remember, setRemember] = useState(status.openRouter.remembered);
  const [check, setCheck] = useState<CredentialsCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = openRouter.trim() !== '';

  /** Sends the typed key, then reports the service's answer. */
  const submit = async () => {
    setBusy(true);
    setError(null);

    try {
      const result = await saveCredentials({ openRouter: openRouter.trim(), remember });

      setCheck(result.check);
      if (result.check.openRouter.valid) {
        onReady(result);
      }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar as chaves.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f6f8fb',
        padding: 20,
      }}
    >
      <div
        style={{
          width: 430,
          background: '#fff',
          border: '1px solid #e6e9ef',
          borderRadius: 14,
          padding: 26,
          boxShadow: '0 1px 3px rgba(15,23,42,.06)',
        }}
      >
        <h1 style={{ fontSize: 17, margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          Conectar sua conta
        </h1>
        <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 22px', lineHeight: 1.5 }}>
          O Leadscan usa a sua conta da OpenRouter para avaliar os perfis com IA.
          Cole a chave abaixo para começar.
        </p>

        {notice && (
          <div
            style={{
              fontSize: 12.5,
              lineHeight: 1.45,
              color: '#92400e',
              background: '#fef3c7',
              border: '1px solid #fde68a',
              borderRadius: 9,
              padding: '9px 11px',
              marginBottom: 18,
            }}
          >
            {notice}
          </div>
        )}

        <KeyField
          label="Chave da OpenRouter"
          help="Avalia cada perfil com a IA."
          link={KEY_SOURCES.openRouter}
          placeholder="sk-or-v1-..."
          value={openRouter}
          {...(status.openRouter.tail ? { tail: status.openRouter.tail } : {})}
          onChange={setOpenRouter}
        />

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            color: '#475569',
            marginBottom: 18,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          Lembrar neste computador
        </label>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit || busy}
          style={{
            all: 'unset',
            display: 'block',
            width: '100%',
            textAlign: 'center',
            boxSizing: 'border-box',
            padding: '10px 0',
            borderRadius: 9,
            fontSize: 13.5,
            fontWeight: 600,
            color: '#fff',
            background: !canSubmit || busy ? '#9db6ea' : '#2563eb',
            cursor: !canSubmit || busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Verificando…' : 'Conectar'}
        </button>

        {error && (
          <div style={{ fontSize: 12.5, color: '#b91c1c', marginTop: 10 }}>{error}</div>
        )}

        {check && (
          <div style={{ marginTop: 12 }}>
            <CheckLine service="OpenRouter" check={check.openRouter} />
          </div>
        )}
      </div>
    </div>
  );
}
