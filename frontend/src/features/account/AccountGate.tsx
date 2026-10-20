import { useCallback, useEffect, useState } from 'react';

import { currentUser, SIGNED_OUT_EVENT, signOut, type AccountUser } from '../../services/api';
import Desktop from '../desktop/Desktop';
import { PrivacyPolicy, TermsAndConditions } from '../legal/LegalPages';
import GuestApp, { isGuestLink } from './GuestApp';
import SignInScreen from './SignInScreen';

type Phase = 'checking' | 'ready' | 'offline';
type Legal = 'privacy' | 'terms' | null;

function legalFromHash(): Legal {
  const hash = window.location.hash.slice(1);
  return hash === 'privacy' || hash === 'terms' ? hash : null;
}

export default function AccountGate() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [user, setUser] = useState<AccountUser | null>(null);
  const [guest, setGuest] = useState(() => isGuestLink(window.location.hash));
  const [legal, setLegal] = useState<Legal>(legalFromHash);

  const check = useCallback(async () => {
    setPhase('checking');
    try {
      setUser(await currentUser());
      setPhase('ready');
    } catch {
      setPhase('offline');
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    const signedOut = (): void => setUser(null);
    const follow = (): void => {
      setLegal(legalFromHash());
      if (isGuestLink(window.location.hash)) {
        setGuest(true);
      }
    };
    window.addEventListener(SIGNED_OUT_EVENT, signedOut);
    window.addEventListener('hashchange', follow);
    return () => {
      window.removeEventListener(SIGNED_OUT_EVENT, signedOut);
      window.removeEventListener('hashchange', follow);
    };
  }, []);

  const leave = useCallback(async () => {
    try {
      await signOut();
    } finally {
      setUser(null);
    }
  }, []);

  if (phase === 'checking') {
    return (
      <main className="sign-in-page" aria-busy="true">
        <p className="sign-in-loading" role="status"><span className="spinner" aria-hidden="true" /> Opening</p>
      </main>
    );
  }

  if (phase === 'offline') {
    return (
      <main className="sign-in-page">
        <section className="sign-in-card">
          <p className="sign-in-brand">Voice Translator</p>
          <h1>Backend is not running</h1>
          <p className="form-help">Start the backend on the computer that runs the app, then try again.</p>
          <button className="button button-primary sign-in-submit" type="button" onClick={() => void check()}>Try again</button>
        </section>
      </main>
    );
  }

  if (user) {
    return <Desktop user={user} onUser={setUser} onSignOut={() => void leave().catch(() => undefined)} onDeleted={() => setUser(null)} />;
  }

  if (guest) {
    return <GuestApp onSignIn={() => setGuest(false)} />;
  }

  if (legal) {
    return (
      <div className="sign-in-legal">
        <button
          className="button button-secondary button-small"
          type="button"
          onClick={() => {
            window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
            setLegal(null);
          }}
        >
          Back to sign in
        </button>
        {legal === 'privacy' ? <PrivacyPolicy /> : <TermsAndConditions />}
      </div>
    );
  }

  return <SignInScreen onSignedIn={setUser} />;
}
