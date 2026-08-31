import { UploadScreen } from './UploadScreen';

/** The application shell: a fixed top bar plus the active screen. */
export default function App() {
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: 7,
              background: 'linear-gradient(150deg,#3b82f6,#1d4ed8)',
              display: 'inline-block',
            }}
          />
          <span
            style={{ fontWeight: 700, fontSize: 15.5, letterSpacing: '-0.02em' }}
          >
            Leadscan
          </span>
        </div>
        <span style={{ fontSize: 12.5, color: '#94a3b8' }}>
          Avaliação de perfis do LinkedIn com IA
        </span>
        <span
          style={{
            marginLeft: 'auto',
            width: 28,
            height: 28,
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
      </header>

      <UploadScreen />
    </div>
  );
}
