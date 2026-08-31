import { useState } from 'react';

import { importCsv } from './api';

/**
 * The import screen in its initial state: a heading and a dropzone the user
 * drops or selects a Linked Helper CSV into.
 *
 * Picking a file uploads it and, for now, logs what the backend reports. The
 * file card, counts, and evaluate action come in later steps.
 */
export function UploadScreen() {
  const [busy, setBusy] = useState(false);

  /** Uploads the chosen file and logs the parsed result. */
  async function handleFile(file: File | undefined) {
    if (!file) return;

    setBusy(true);
    try {
      const result = await importCsv(file);
      console.log('import result', result);
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
      </div>
    </main>
  );
}
