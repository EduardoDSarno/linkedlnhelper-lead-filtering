import { useState } from 'react';

import { importCsv, type ImportResult } from './api';

/** Formats a byte count as a short Brazilian-style size label. */
function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1).replace('.', ',')} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/** One statistic card under the imported file. */
function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        border: '1px solid #e2e8f0',
        background: '#fff',
        borderRadius: 12,
        padding: '13px 15px',
      }}
    >
      <div style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 500 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 23,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * The import screen: a dropzone, and once a Linked Helper CSV is uploaded, a
 * summary card plus the valid / duplicated / invalid counts the backend
 * reported. The criteria step and evaluate action come next.
 */
export function UploadScreen() {
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [imported, setImported] = useState<ImportResult | undefined>(undefined);

  /** Uploads the chosen file and keeps the parsed result for display. */
  async function handleFile(chosen: File | undefined) {
    if (!chosen) return;

    setBusy(true);
    try {
      const result = await importCsv(chosen);
      setFile(chosen);
      setImported(result);
    } catch (error) {
      console.error('import failed', error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      className="sc"
      style={{
        flex: 1,
        overflow: 'auto',
        display: 'flex',
        justifyContent: 'center',
        padding: '64px 24px 80px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 660 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 31,
            fontWeight: 700,
            letterSpacing: '-0.03em',
            lineHeight: 1.15,
          }}
        >
          Importe sua exportação do Linked Helper
        </h1>
        <p
          style={{
            margin: '10px 0 0',
            fontSize: 14.5,
            lineHeight: 1.6,
            color: '#64748b',
          }}
        >
          Cada perfil é enriquecido, tem a foto analisada e recebe uma nota de
          aderência à campanha. Você revisa a lista já ordenada.
        </p>

        <label style={{ display: 'block', marginTop: 28, cursor: 'pointer' }}>
          <input
            type="file"
            accept=".csv"
            onChange={(event) => handleFile(event.target.files?.[0])}
            style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
          />
          <div
            style={{
              border: '1.5px dashed #cfd8e3',
              background: '#fff',
              borderRadius: 14,
              padding: '44px 28px',
              textAlign: 'center',
              transition: 'background .15s, border-color .15s',
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                margin: '0 auto',
                borderRadius: 12,
                background: '#e8f0fe',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <svg
                width="21"
                height="21"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#2563eb"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div style={{ marginTop: 14, fontSize: 15, fontWeight: 600 }}>
              {busy
                ? 'Enviando…'
                : 'Arraste o CSV aqui ou clique para selecionar'}
            </div>
            <div style={{ marginTop: 5, fontSize: 12.5, color: '#94a3b8' }}>
              Formato Linked Helper · colunas obrigatórias: public_id e profile_url
            </div>
          </div>
        </label>

        {file && imported && (
          <>
            <div
              style={{
                marginTop: 16,
                border: '1px solid #e2e8f0',
                background: '#fff',
                borderRadius: 12,
                padding: '14px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 13,
              }}
            >
              <span
                style={{
                  width: 34,
                  height: 34,
                  flex: 'none',
                  borderRadius: 9,
                  background: '#eef2f7',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 9.5,
                  fontWeight: 700,
                  color: '#64748b',
                  letterSpacing: '.04em',
                }}
              >
                CSV
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: 13.5,
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {file.name}
                </span>
                <span
                  style={{
                    display: 'block',
                    fontSize: 12,
                    color: '#94a3b8',
                    marginTop: 1,
                  }}
                >
                  {formatSize(file.size)} · {imported.totalRows} linhas
                </span>
              </span>
              <span
                style={{
                  flex: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#047857',
                  background: '#ecfdf5',
                  border: '1px solid #a7f3d0',
                  padding: '4px 9px',
                  borderRadius: 7,
                }}
              >
                ✓ Válido
              </span>
            </div>

            <div
              style={{
                marginTop: 12,
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 10,
              }}
            >
              <StatCard label="Perfis válidos" value={imported.validProfiles} />
              <StatCard label="Duplicados" value={imported.duplicatedProfiles} />
              <StatCard label="Inválidos" value={imported.invalidProfiles} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
