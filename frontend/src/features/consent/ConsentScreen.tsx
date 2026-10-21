import { useEffect, useRef, useState, type FormEvent } from 'react';

import { ApiError, createSession, getHealth, isHost } from '../../services/api';
import { sessionConversation, type Conversation, type Invite, type MeetingFlow } from '../../services/conversations';
import type { Participant } from '../../services/protocol';
import SetupAssistant, { type Start } from '../setup/SetupAssistant';
import HostKeyPrompt from './HostKeyPrompt';
import ParticipantCard from './ParticipantCard';
import { loadLanguageOptions, type LanguageOption } from './languageOptions';
import { canStartSession } from './validation';

interface ConsentScreenProps {
  invite: Invite | null;
  start: Start | null;
  flow: MeetingFlow | null;
  onConversation: (conversation: Conversation) => void;
  onLeaveInvite: () => void;
}

function browserLanguage(): string {
  const tag = navigator.languages?.[0] ?? navigator.language ?? '';
  return tag.toLowerCase().split(/[-_]/)[0] ?? '';
}

function initialParticipants(): [Participant, Participant] {
  return [
    { id: 'A', name: 'Person 1', preferred_language: browserLanguage() },
    { id: 'B', name: 'Person 2', preferred_language: '' },
  ];
}

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

export default function ConsentScreen({ invite, start, flow, onConversation, onLeaveInvite }: ConsentScreenProps) {
  const consentHeadingRef = useRef<HTMLHeadingElement>(null);
  const [participants, setParticipants] = useState<[Participant, Participant]>(initialParticipants);
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [manual, setManual] = useState(false);
  const [languagesLoading, setLanguagesLoading] = useState(true);
  const [languagesFailed, setLanguagesFailed] = useState(false);
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);
  const [backendChecking, setBackendChecking] = useState(true);
  const [host, setHost] = useState<boolean | null>(null);
  const [consent, setConsent] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const startIsValid = !languagesLoading && !languagesFailed && canStartSession(consent, participants);

  async function checkBackend(): Promise<void> {
    setBackendChecking(true);
    try {
      await getHealth();
      setBackendAvailable(true);
      setHost(invite || flow?.kind === 'guest' ? true : await isHost());
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
  }, []);

  function chooseManually(): void {
    setManual(true);
    void checkLanguages();
    window.setTimeout(() => consentHeadingRef.current?.focus(), 0);
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
      onConversation(sessionConversation(session));
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
        <section className="hero hero-entrance" aria-labelledby="page-title">
          <div className="hero-arc" aria-hidden="true" />
          <p className="hero-kicker">Live translation</p>
          <h1 id="page-title" tabIndex={-1}>Voice Translator</h1>
          <p className="hero-subtitle">Talk, meet and caption in any language, live.</p>
          <p className="hero-note">
            Works best in Edge or Chrome. Use headphones or keep the volume low so the app does not hear its own voice.
          </p>
        </section>

        {backendAvailable === false && (
          <div className="notice notice-danger start-notice" role="status" aria-live="polite">
            <span>Backend is not running</span>
            <button className="button button-small button-secondary" type="button" onClick={retryBackend} disabled={backendChecking}>
              {backendChecking ? 'Checking' : 'Retry'}
            </button>
          </div>
        )}
        {backendAvailable === true && (
          <p className="backend-note" aria-live="polite">Backend connected</p>
        )}

        {host === false ? (
          <HostKeyPrompt onReady={() => setHost(true)} />
        ) : !manual ? (
          <SetupAssistant
            key={invite ? `${invite.roomId}/${invite.token}` : flow?.kind === 'guest' ? `meet/${flow.invite.meetingId}` : 'own'}
            invite={invite}
            start={start}
            flow={flow}
            onConversation={onConversation}
            onChooseManually={chooseManually}
            onLeaveInvite={onLeaveInvite}
          />
        ) : (
          <section className="consent-section" aria-labelledby="consent-heading">
            <div className="section-intro">
              <h2 ref={consentHeadingRef} id="consent-heading" tabIndex={-1}>Choose the languages</h2>
              <p className="section-intro-text">Pick a name and a language for each person.</p>
              <button className="button button-link" type="button" onClick={() => setManual(false)}>
                Set up by speaking instead
              </button>
            </div>

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
                  The microphone listens while the conversation is open. Each sentence is sent to Google's Gemini service to be transcribed, translated and spoken, and words shown while you speak come from the browser's own speech service (Microsoft for Edge, Google for Chrome). Nothing is saved: captions disappear when the conversation ends. Google's free tier may use submitted data to improve its products.
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
                <p className="form-help">Choose a language for each person, then both must agree before the conversation can start.</p>
              </div>
            </form>
          </section>
        )}
      </main>
    </>
  );
}
