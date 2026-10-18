import { getBackendUrl } from './config';

export default function App() {
  return (
    <main className="app">
      <h1>AI Voice Translator</h1>
      <p>Telugu ↔ English, two-way voice translation.</p>
      <p className="muted">
        Project setup is complete. Live translation features arrive in the next steps.
      </p>
      <p className="muted">
        Backend address: <code>{getBackendUrl()}</code>
      </p>
    </main>
  );
}
