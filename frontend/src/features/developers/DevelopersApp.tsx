import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { getBackendUrl } from '../../config';
import { ApiError, createKey, listKeys, revokeKey, type ApiKeyInfo, type PublicLink } from '../../services/api';
import { sessionSnippet, streamAddress, usedShare, widgetSnippet } from './snippets';

const LIMITS = [100, 500, 1000, 5000, 20000];
const REFRESH_MS = 15_000;

interface NewKey {
  key: ApiKeyInfo;
  secret: string;
}

function problemText(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail;
  }
  if (error instanceof TypeError) {
    return 'The backend cannot be reached. Check that it is running.';
  }
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

function dayText(value: string | null): string {
  if (!value) {
    return 'never';
  }
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function Snippet({ label, text, onCopy }: { label: string; text: string; onCopy: (text: string, what: string) => void }) {
  return (
    <div className="dev-snippet">
      <div className="dev-snippet-top">
        <span>{label}</span>
        <button className="button button-secondary button-small" type="button" onClick={() => onCopy(text, label)}>
          Copy
        </button>
      </div>
      <pre tabIndex={0}><code>{text}</code></pre>
    </div>
  );
}

function KeyCard({ item, onRevoke }: { item: ApiKeyInfo; onRevoke: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const share = usedShare(item.used_today, item.daily_limit);

  return (
    <li className="dev-key">
      <header className="dev-key-top">
        <div>
          <h4 dir="auto">{item.name}</h4>
          <p className="meeting-when"><code>{item.shown}…</code> · made {dayText(item.created_at)} · last used {dayText(item.last_used_at)}</p>
        </div>
        <span className="meeting-badge">{item.used_today} / {item.daily_limit} today</span>
      </header>
      <div
        className="dev-usage"
        role="meter"
        aria-label={`${item.name} use today`}
        aria-valuemin={0}
        aria-valuemax={item.daily_limit}
        aria-valuenow={Math.min(item.used_today, item.daily_limit)}
      >
        <span style={{ width: `${share}%` }} data-full={share >= 90} />
      </div>
      <div className="meeting-actions">
        {confirming ? (
          <>
            <button className="button button-small meeting-cancel" type="button" onClick={onRevoke}>
              Yes, revoke it
            </button>
            <button className="button button-link" type="button" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="button button-link" type="button" onClick={() => setConfirming(true)}>
            Revoke
          </button>
        )}
      </div>
    </li>
  );
}

export default function DevelopersApp() {
  const [name, setName] = useState('');
  const [limit, setLimit] = useState(1000);
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [link, setLink] = useState<PublicLink>({ public_url: null, public_url_problem: null });
  const [made, setMade] = useState<NewKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const busyRef = useRef(false);
  const base = link.public_url ?? getBackendUrl();

  const refresh = useCallback(async () => {
    try {
      const found = await listKeys();
      setKeys(found.keys);
      setLink({ public_url: found.public_url, public_url_problem: found.public_url_problem });
    } catch (problem) {
      setError(problemText(problem));
      setKeys((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const reload = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(reload);
  }, [refresh]);

  async function copy(text: string, what: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setDone(`${what} copied`);
    } catch {
      setDone('Copying is blocked here. Select the text and copy it.');
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busyRef.current || !name.trim()) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    setDone('');
    try {
      const created = await createKey(name.trim().slice(0, 60), limit);
      setMade(created);
      setName('');
      await refresh();
    } catch (problem) {
      setError(problemText(problem));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function revoke(item: ApiKeyInfo): Promise<void> {
    setError('');
    try {
      await revokeKey(item.id);
      if (made?.key.id === item.id) {
        setMade(null);
      }
      setDone(`${item.name} revoked`);
      await refresh();
    } catch (problem) {
      setError(problemText(problem));
    }
  }

  const secret = made?.secret;

  return (
    <div className="developers-app">
      <div className="dev-side">
        <form className="meeting-form" onSubmit={(event) => void submit(event)}>
          <h3>New API key</h3>
          <p className="meeting-note">A key lets another website or app use this translator. Give each app its own key so you can see its use and switch it off on its own.</p>
          <label className="field-label" htmlFor="key-name">Which app is it for?</label>
          <input
            id="key-name"
            className="text-input"
            value={name}
            maxLength={60}
            placeholder="For example: Shop website"
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <label className="field-label" htmlFor="key-limit">Most requests a day</label>
          <select id="key-limit" className="text-input" value={limit} onChange={(event) => setLimit(Number(event.currentTarget.value))}>
            {LIMITS.map((value) => (
              <option key={value} value={value}>{value.toLocaleString()}</option>
            ))}
          </select>
          <p className="meeting-note">Every call and every spoken sentence counts as one request. It also slows down past 60 a minute.</p>
          <button className="button button-primary" type="submit" disabled={busy || !name.trim()} aria-busy={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {busy ? 'Making key' : 'Make key'}
          </button>
        </form>

        {made && (
          <section className="dev-secret" aria-labelledby="dev-secret-title">
            <h3 id="dev-secret-title">Your new key for {made.key.name}</h3>
            <p className="meeting-note">Copy it now. It is shown only this once; if you lose it, revoke it and make another.</p>
            <input className="text-input invite-link" readOnly value={made.secret} aria-label="New API key" onFocus={(event) => event.currentTarget.select()} />
            <div className="meeting-actions">
              <button className="button button-primary button-small" type="button" onClick={() => void copy(made.secret, 'Key')}>
                Copy key
              </button>
              <button className="button button-link" type="button" onClick={() => setMade(null)}>
                I have saved it
              </button>
            </div>
          </section>
        )}
      </div>

      <div className="dev-main">
        <section aria-labelledby="dev-keys-title">
          <h3 id="dev-keys-title">Keys</h3>
          {error && <div className="notice notice-danger" role="alert"><span>{error}</span></div>}
          {keys === null ? (
            <p className="meeting-empty" role="status">Loading keys</p>
          ) : keys.length === 0 ? (
            <p className="meeting-empty">No keys yet. Make one for each app that should use the translator.</p>
          ) : (
            <ul className="meeting-cards">
              {keys.map((item) => (
                <KeyCard key={item.id} item={item} onRevoke={() => void revoke(item)} />
              ))}
            </ul>
          )}
        </section>

        <section className="dev-use" aria-labelledby="dev-use-title">
          <h3 id="dev-use-title">Use it</h3>
          {!link.public_url && link.public_url_problem && (
            <p className="invite-warning" role="note">Other websites cannot reach this app yet: {link.public_url_problem}</p>
          )}
          <p className="meeting-note">On a website: paste this before <code>&lt;/body&gt;</code>. A Translate button appears in the corner and opens the translator.</p>
          <Snippet label="Website widget" text={widgetSnippet(base, secret)} onCopy={(text, what) => void copy(text, what)} />
          <p className="meeting-note">From a server: start a conversation, then send 16 kHz audio to <code>{streamAddress(base)}</code>. Captions and voices come back on the same channel.</p>
          <Snippet label="Start a conversation" text={sessionSnippet(base, secret)} onCopy={(text, what) => void copy(text, what)} />
          <p className="meeting-note">
            Every call is listed in the <a href={`${base}/docs`} target="_blank" rel="noreferrer">API reference</a>. The developer guide, <code>docs/API.md</code> in the project, has examples in curl, Python and JavaScript.
          </p>
          <p className="meeting-note">Anyone who can see a web page can read a key written into it. Keep the daily limit modest and revoke a key if it is misused.</p>
        </section>
        <p className="meeting-done" role="status">{done}</p>
      </div>
    </div>
  );
}
