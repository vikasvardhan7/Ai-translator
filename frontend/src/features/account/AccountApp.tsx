import { useState, type FormEvent } from 'react';

import { ApiError, changePassword, deleteAccount, renameAccount, type AccountUser } from '../../services/api';
import { passwordProblem } from './passwords';

interface AccountAppProps {
  user: AccountUser;
  onUser: (user: AccountUser) => void;
  onSignOut: () => void;
  onDeleted: () => void;
}

function problemText(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail;
  }
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

export default function AccountApp({ user, onUser, onSignOut, onDeleted }: AccountAppProps) {
  const [name, setName] = useState(user.name);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [goodbye, setGoodbye] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState('');

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) {
      return;
    }
    setBusy(true);
    setProblem('');
    setMessage('');
    try {
      await action();
    } catch (error) {
      setProblem(problemText(error));
    } finally {
      setBusy(false);
    }
  }

  function saveName(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void run(async () => {
      onUser(await renameAccount(name));
      setMessage('Name saved.');
    });
  }

  function savePassword(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const issue = passwordProblem(password, confirm, user.email);
    if (issue) {
      setProblem(issue);
      return;
    }
    void run(async () => {
      onUser(await changePassword(current, password));
      setCurrent('');
      setPassword('');
      setConfirm('');
      setMessage('Password changed. Other devices were signed out.');
    });
  }

  function remove(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void run(async () => {
      await deleteAccount(goodbye);
      onDeleted();
    });
  }

  return (
    <div className="account-app">
      <header className="account-head">
        <span className="account-avatar" aria-hidden="true">{(user.name.trim()[0] ?? '?').toUpperCase()}</span>
        <div>
          <h2>{user.name}</h2>
          <p>{user.email}{user.owner ? ' · runs this app' : ''}</p>
        </div>
        <button className="button button-secondary" type="button" onClick={onSignOut}>Sign out</button>
      </header>

      {message && <p className="notice account-message" role="status">{message}</p>}
      {problem && <p className="notice notice-danger" role="alert">{problem}</p>}

      <form className="account-section" onSubmit={saveName}>
        <h3>Name</h3>
        <label className="field-label">
          Shown to people you meet and on your trainer
          <input className="text-input" value={name} maxLength={40} autoComplete="name" onChange={(event) => setName(event.currentTarget.value)} />
        </label>
        <button className="button button-primary button-small" type="submit" disabled={busy || !name.trim() || name.trim() === user.name}>
          Save name
        </button>
      </form>

      <form className="account-section" onSubmit={savePassword}>
        <h3>Password</h3>
        <label className="field-label">
          Current password
          <input className="text-input" type="password" value={current} autoComplete="current-password" onChange={(event) => setCurrent(event.currentTarget.value)} />
        </label>
        <label className="field-label">
          New password
          <input className="text-input" type="password" value={password} autoComplete="new-password" onChange={(event) => setPassword(event.currentTarget.value)} />
        </label>
        <label className="field-label">
          New password again
          <input className="text-input" type="password" value={confirm} autoComplete="new-password" onChange={(event) => setConfirm(event.currentTarget.value)} />
        </label>
        <button className="button button-primary button-small" type="submit" disabled={busy || !current || !password}>
          Change password
        </button>
      </form>

      <section className="account-section account-danger">
        <h3>Delete account</h3>
        <p className="form-help">Deletes your account, your trainer plans and every day you tracked, and your scheduled meetings. This cannot be undone.</p>
        {deleting ? (
          <form onSubmit={remove}>
            <label className="field-label">
              Type your password to delete everything
              <input className="text-input" type="password" value={goodbye} autoComplete="current-password" onChange={(event) => setGoodbye(event.currentTarget.value)} />
            </label>
            <div className="meeting-actions">
              <button className="button button-small meeting-cancel" type="submit" disabled={busy || !goodbye}>Delete my account</button>
              <button className="button button-link" type="button" onClick={() => setDeleting(false)}>Keep it</button>
            </div>
          </form>
        ) : (
          <button className="button button-link" type="button" onClick={() => setDeleting(true)}>Delete my account…</button>
        )}
      </section>
    </div>
  );
}
