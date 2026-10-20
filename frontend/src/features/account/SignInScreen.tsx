import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import {
  ApiError,
  resetPassword,
  sendCode,
  signIn,
  signUp,
  type AccountUser,
  type CodePurpose,
} from '../../services/api';
import { passwordProblem } from './passwords';

type Mode = 'sign-in' | 'sign-up' | 'reset';
type Step = 'email' | 'code';

interface SignInScreenProps {
  onSignedIn: (user: AccountUser) => void;
  invited?: boolean;
}

const TITLES: Record<Mode, string> = {
  'sign-in': 'Sign in',
  'sign-up': 'Create your account',
  reset: 'Set a new password',
};

const LEADS: Record<Mode, string> = {
  'sign-in': 'Everyone signs in with their own email and their own password. First time here? Choose Create account.',
  'sign-up': 'Use your own email. We email you a 6-digit code to check it is yours, then you choose your own password.',
  reset: 'We email a 6-digit code to your address, then you choose a new password.',
};

function problemText(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail;
  }
  if (error instanceof TypeError) {
    return 'The backend cannot be reached. Check that it is running.';
  }
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

export default function SignInScreen({ onSignedIn, invited = false }: SignInScreenProps) {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [step, setStep] = useState<Step>('email');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [refused, setRefused] = useState(false);
  const [notice, setNotice] = useState('');
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const passwordId = useId();
  const waitSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => {
    if (waitSeconds === 0) {
      return undefined;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waitSeconds]);

  function switchTo(next: Mode): void {
    setMode(next);
    setStep('email');
    setPassword('');
    setConfirm('');
    setCode('');
    setProblem('');
    setRefused(false);
    setNotice('');
    window.setTimeout(() => headingRef.current?.focus(), 0);
  }

  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) {
      return;
    }
    setBusy(true);
    setProblem('');
    setRefused(false);
    try {
      await action();
    } catch (error) {
      setProblem(problemText(error));
      setRefused(mode === 'sign-in' && error instanceof ApiError && error.status === 401);
    } finally {
      setBusy(false);
    }
  }

  async function askForCode(purpose: CodePurpose): Promise<void> {
    const sent = await sendCode(email, purpose);
    setResendAt(Date.now() + sent.resendAfter * 1000);
    setNow(Date.now());
    setStep('code');
    setNotice(
      purpose === 'sign_up'
        ? `We emailed a 6-digit code to ${email.trim()}. It works for ${Math.round(sent.expiresIn / 60)} minutes; check Spam if you do not see it. If this email already has an account, the email says so instead: then sign in, or choose Forgot password.`
        : `If ${email.trim()} has an account, we emailed it a 6-digit code. Check Spam if you do not see it.`,
    );
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (mode === 'sign-in') {
      void run(async () => onSignedIn(await signIn(email, password)));
      return;
    }
    const purpose: CodePurpose = mode === 'sign-up' ? 'sign_up' : 'reset';
    if (step === 'email') {
      void run(() => askForCode(purpose));
      return;
    }
    const issue = passwordProblem(password, confirm, email);
    if (issue) {
      setProblem(issue);
      return;
    }
    void run(async () => {
      const user = mode === 'sign-up'
        ? await signUp(email, code, name, password)
        : await resetPassword(email, code, password);
      onSignedIn(user);
    });
  }

  const asking = mode !== 'sign-in' && step === 'email';
  const choosing = mode !== 'sign-in' && step === 'code';
  const submitLabel = mode === 'sign-in'
    ? 'Sign in'
    : asking
      ? 'Email me a code'
      : mode === 'sign-up'
        ? 'Create account'
        : 'Set password';

  return (
    <main className="sign-in-page">
      <div className="sign-in-glow" aria-hidden="true" />
      <section className="sign-in-card" aria-labelledby="sign-in-title">
        <p className="sign-in-brand">Voice Translator</p>
        <h1 id="sign-in-title" ref={headingRef} tabIndex={-1}>{TITLES[mode]}</h1>
        {invited && (
          <p className="sign-in-invite" role="status">
            You were invited to a call. Sign in, or create your account, and you join it straight after.
          </p>
        )}
        <p className="sign-in-lead">{LEADS[mode]}</p>
        {mode !== 'reset' && (
          <div className="sign-in-tabs" role="tablist" aria-label="Account">
            <button type="button" role="tab" aria-selected={mode === 'sign-in'} onClick={() => switchTo('sign-in')}>
              Sign in
            </button>
            <button type="button" role="tab" aria-selected={mode === 'sign-up'} onClick={() => switchTo('sign-up')}>
              Create account
            </button>
          </div>
        )}

        <form className="sign-in-form" onSubmit={submit} noValidate>
          {mode === 'sign-up' && step === 'email' && (
            <label className="field-label">
              Your name
              <input
                className="text-input"
                value={name}
                maxLength={40}
                autoComplete="name"
                required
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </label>
          )}
          <label className="field-label">
            Email
            <input
              className="text-input"
              type="email"
              value={email}
              maxLength={254}
              autoComplete="email"
              inputMode="email"
              required
              readOnly={choosing}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
          </label>
          {choosing && (
            <label className="field-label">
              6-digit code from the email
              <input
                className="text-input sign-in-code"
                value={code}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                pattern="[0-9]{6}"
                required
                onChange={(event) => setCode(event.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
              />
            </label>
          )}
          {(mode === 'sign-in' || choosing) && (
            <div className="field-label">
              <label htmlFor={passwordId}>{mode === 'sign-in' ? 'Password' : 'New password'}</label>
              <span className="password-row">
                <input
                  id={passwordId}
                  className="text-input"
                  type={shown ? 'text' : 'password'}
                  value={password}
                  maxLength={128}
                  autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                  required
                  onChange={(event) => setPassword(event.currentTarget.value)}
                />
                <button
                  className="button button-small button-secondary"
                  type="button"
                  aria-label={shown ? 'Hide password' : 'Show password'}
                  aria-pressed={shown}
                  onClick={() => setShown((value) => !value)}
                >
                  {shown ? 'Hide' : 'Show'}
                </button>
              </span>
            </div>
          )}
          {choosing && (
            <>
              <label className="field-label">
                Type the new password again
                <input
                  className="text-input"
                  type={shown ? 'text' : 'password'}
                  value={confirm}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                  onChange={(event) => setConfirm(event.currentTarget.value)}
                />
              </label>
              <p className="form-help">At least 8 characters. A short sentence is easy to remember and hard to guess.</p>
            </>
          )}

          {notice && <p className="sign-in-notice" role="status">{notice}</p>}
          {problem && <p className="notice notice-danger" role="alert">{problem}</p>}
          {refused && (
            <div className="sign-in-refused">
              <p>No account with this email yet? Each person creates their own first.</p>
              <button className="button button-secondary button-small" type="button" onClick={() => switchTo('sign-up')}>
                Create an account with this email
              </button>
            </div>
          )}

          <button className="button button-primary sign-in-submit" type="submit" disabled={busy} aria-busy={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}
            {submitLabel}
          </button>
        </form>

        <div className="sign-in-links">
          {mode === 'sign-in' && (
            <button className="button button-link" type="button" onClick={() => switchTo('reset')}>
              Forgot password?
            </button>
          )}
          {mode === 'reset' && (
            <button className="button button-link" type="button" onClick={() => switchTo('sign-in')}>
              Back to sign in
            </button>
          )}
          {choosing && (
            <button
              className="button button-link"
              type="button"
              disabled={busy || waitSeconds > 0}
              onClick={() => void run(() => askForCode(mode === 'sign-up' ? 'sign_up' : 'reset'))}
            >
              {waitSeconds > 0 ? `Send a new code in ${waitSeconds} s` : 'Send a new code'}
            </button>
          )}
          {choosing && (
            <button className="button button-link" type="button" onClick={() => { setStep('email'); setNotice(''); setProblem(''); }}>
              Use a different email
            </button>
          )}
        </div>
        <p className="sign-in-privacy">
          Passwords are kept only as a scrambled fingerprint, and codes stop working after 10 minutes.
          Read the <a href="#privacy">privacy page</a>.
        </p>
      </section>
    </main>
  );
}
