import { useState, type FormEvent } from 'react';

import { isHost } from '../../services/api';
import { saveHostKey } from '../../services/hostKey';

interface HostKeyPromptProps {
  onReady: () => void;
}

export default function HostKeyPrompt({ onReady }: HostKeyPromptProps) {
  const [key, setKey] = useState('');
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setChecking(true);
    setProblem('');
    try {
      if (await isHost(key.trim())) {
        saveHostKey(key);
        onReady();
        return;
      }
      setProblem('That key is not right. Copy it again from the backend window: it changes every time the backend starts.');
    } catch {
      setProblem('The backend cannot be reached. Check that it is running, then try again.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="host-key" aria-labelledby="host-key-title">
      <h2 id="host-key-title">Enter the host key</h2>
      <p>
        This app is open through a public link, so only its owner can start a conversation. Type the host key shown in
        the backend window when it started, for example ABCD-EF23-GH45. People you invite do not need it.
      </p>
      <form className="host-key-form" onSubmit={(event) => void submit(event)}>
        <label className="field-label" htmlFor="host-key">Host key</label>
        <input
          id="host-key"
          className="text-input"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={key}
          onChange={(event) => setKey(event.currentTarget.value)}
        />
        {problem && <p className="settings-error" role="alert">{problem}</p>}
        <button className="button button-primary" type="submit" disabled={!key.trim() || checking} aria-busy={checking}>
          {checking ? 'Checking' : 'Continue'}
        </button>
      </form>
    </section>
  );
}
