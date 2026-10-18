import { useEffect, useRef, useState, type FormEvent } from 'react';

import { ApiError, createSession, getHealth } from '../../services/api';
import type { CreateSessionResponse, Participant } from '../../services/protocol';
import ParticipantCard from './ParticipantCard';
import { loadLanguageOptions, type LanguageOption } from './languageOptions';
import { canStartSession } from './validation';

interface ConsentScreenProps {
  onSessionCreated: (session: CreateSessionResponse) => void;
}

const DEFAULT_PARTICIPANTS: [Participant, Participant] = [
  { id: 'A', name: 'Person A', preferred_language: 'en' },
  { id: 'B', name: 'Person B', preferred_language: 'te' },
];

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail;
  }
  if (error instanceof TypeError) {
    return 'Backend is not running';
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'The request could not be completed.';
}

export default function ConsentScreen({ onSessionCreated }: ConsentScreenProps) {
  const consentHeadingRef = useRef<HTMLHeadingElement>(null);
  const [playHeroEntrance] = useState(() => {
    try {
      return window.sessionStorage.getItem('voice-translator-hero-entrance') !== 'played';
    } catch {
      return true;
    }
  });
  const [participants, setParticipants] = useState<[Participant, Participant]>(DEFAULT_PARTICIPANTS);
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [languagesLoading, setLanguagesLoading] = useState(true);
  const [languagesFailed, setLanguagesFailed] = useState(false);
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);
  const [backendChecking, setBackendChecking] = useState(true);
  const [consent, setConsent] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const startIsValid = !languagesLoading && !languagesFailed && canStartSession(consent, participants);

  async function checkBackend(): Promise<void> {
    setBackendChecking(true);
    try {
      await getHealth();
      setBackendAvailable(true);
    } catch {
      setBackendAvailable(false);
    } finally {
      setBackendChecking(false);
    }
  }

  function retryBackend(): void {
    void checkBackend();
  }

  async function checkLanguages(): Promise<void> {
    setLanguagesLoading(true);
    setLanguagesFailed(false);
    try {
      setLanguages(await loadLanguageOptions());
    } catch {
      setLanguagesFailed(true);
    } finally {
      setLanguagesLoading(false);
    }
  }

  useEffect(() => {
    void checkBackend();
    void checkLanguages();
  }, []);

  useEffect(() => {
    if (playHeroEntrance) {
      try {
        window.sessionStorage.setItem('voice-translator-hero-entrance', 'played');
      } catch {
        // The entrance can still run when session storage is unavailable.
      }
    }
  }, [playHeroEntrance]);

  function focusConsentForm(): void {
    const heading = consentHeadingRef.current;
    if (!heading) {
      return;
    }
    heading.scrollIntoView({ block: 'start' });
    heading.focus({ preventScroll: true });
  }

  function updateParticipant(index: 0 | 1, participant: Participant): void {
    setParticipants((current) => {
      const next: [Participant, Participant] = [...current];
      next[index] = participant;
      return next;
    });
  }

  async function handleStart(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!startIsValid || starting) {
      return;
    }

    setStarting(true);
    setStartError('');
    try {
      const session = await createSession(
        participants.map((participant) => ({
          ...participant,
          name: participant.name.trim(),
        })),
        consent,
      );
      setBackendAvailable(true);
      onSessionCreated(session);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setBackendAvailable(false);
      }
      setStartError(messageFor(error));
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      <main>
        <section className={`hero ${playHeroEntrance ? 'hero-entrance' : ''}`} aria-labelledby="page-title">
          <div className="hero-arc" aria-hidden="true" />
          <p className="hero-kicker">A shared conversation</p>
          <h1 id="page-title" tabIndex={-1}>Voice Translator</h1>
          <p className="hero-subtitle">Two people, any two languages, one conversation.</p>
          <p className="hero-description">
            Each person speaks in their own language. Press a talk button, speak, and the other person reads your translated sentence. Voice playback and conversation history are planned.
          </p>
          <div className="hero-actions">
            <button className="button button-primary" type="button" onClick={focusConsentForm}>
              Start a conversation
            </button>
          </div>
          <p className="hero-note">
            Works in Chrome and Edge on Windows. The microphone is active only while a recording is in progress.
          </p>
        </section>

        <section className="consent-section" aria-labelledby="consent-heading">
          <div className="section-intro">
            <p className="eyebrow">Before you begin</p>
            <h2 ref={consentHeadingRef} id="consent-heading" tabIndex={-1}>Set up both people</h2>
            <p>Choose a name and preferred language for each person.</p>
          </div>

          {backendAvailable === false && (
            <div className="notice notice-danger" role="status" aria-live="polite">
              <span>Backend is not running</span>
              <button className="button button-small button-secondary" type="button" onClick={retryBackend} disabled={backendChecking}>
                {backendChecking ? 'Checking' : 'Retry'}
              </button>
            </div>
          )}
          {backendAvailable === true && (
            <p className="backend-note" aria-live="polite">Backend connected</p>
          )}

          <form className="consent-form" onSubmit={(event) => void handleStart(event)}>
            <div className="participant-grid" aria-busy={languagesLoading}>
              <ParticipantCard
                participant={participants[0]}
                languages={languages}
                languagesLoading={languagesLoading}
                languagesFailed={languagesFailed}
                onChange={(participant) => updateParticipant(0, participant)}
              />
              <ParticipantCard
                participant={participants[1]}
                languages={languages}
                languagesLoading={languagesLoading}
                languagesFailed={languagesFailed}
                onChange={(participant) => updateParticipant(1, participant)}
              />
            </div>

            {languagesLoading && (
              <p className="visually-hidden" role="status" aria-live="polite">Loading languages</p>
            )}

            {languagesFailed && (
              <div className="notice notice-danger" role="alert">
                <span>Languages could not be loaded.</span>
                <button className="button button-small button-secondary" type="button" onClick={() => void checkLanguages()}>
                  Retry
                </button>
              </div>
            )}

            <div className="consent-disclosure">
              <p>
                Your microphone is active only between Start speaking and Stop &amp; translate. Speech audio is sent to Google's Gemini service for recognition and translation. Session data stays in backend memory and disappears when the backend restarts. Google's free tier may use submitted data to improve its products.
              </p>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.currentTarget.checked)}
                />
                <span>Both people agree</span>
              </label>
            </div>

            {startError && (
              <div className="notice notice-danger start-error" role="alert" aria-live="polite">
                <span>{startError}</span>
                {backendAvailable === false && (
                  <button className="button button-small button-secondary" type="button" onClick={retryBackend} disabled={backendChecking}>
                    {backendChecking ? 'Checking' : 'Retry'}
                  </button>
                )}
              </div>
            )}

            <div className="form-actions">
              <button className="button button-primary start-button" type="submit" disabled={!startIsValid || starting} aria-busy={starting}>
                {starting && <span className="spinner" aria-hidden="true" />}
                {starting ? 'Starting' : 'Start'}
              </button>
              <p className="form-help">Both people must agree before a conversation can start.</p>
            </div>
          </form>
        </section>
      </main>
    </>
  );
}
