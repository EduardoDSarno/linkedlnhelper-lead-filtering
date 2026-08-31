import { UploadScreen } from './UploadScreen';

/** The application shell. For now it shows only the import screen. */
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
      <UploadScreen />
    </div>
  );
}
