import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiError,
  leaveRoom,
  createRoom,
  createSession,
  detectLanguage,
  getRoom,
  joinRoom,
  type CreatedRoom,
  type DetectedLanguage,
} from '../../services/api';
import {
  inviteLink,
  inviteProblem,
  roomConversation,
  sessionConversation,
  type Conversation,
  type Invite,
} from '../../services/conversations';
import { languageLabel, languageName } from '../../services/languageNames';
import { openMicrophoneCapture, type AudioCapture } from '../../services/microphoneCapture';
import type { Participant, SpeakerId } from '../../services/protocol';
import { PhraseDetector } from './phrase';

interface SetupAssistantProps {
  invite: Invite | null;
  onConversation: (conversation: Conversation) => void;
  onChooseManually: () => void;
  onLeaveInvite: () => void;
}

type Phase = 'loading' | 'intro' | 'where' | 'opening' | 'listening' | 'checking' | 'retry' | 'starting' | 'waiting' | 'dead';
type Where = 'here' | 'remote' | 'meeting' | 'guest';
type Retry = { kind: 'listen'; person: SpeakerId } | { kind: 'start' };

interface Message {
  id: number;
  from: 'assistant' | SpeakerId;
  text: string;
}

const PEOPLE: Record<SpeakerId, string> = { A: 'Person 1', B: 'Person 2' };
const ROOM_CHECK_MS = 2_000;
const WHERE_QUESTION = 'Who are you talking to: someone next to you, someone on another phone or computer, or people in an online meeting?';
const DISCLOSURE = "What you say is sent to Google's Gemini to be understood and translated. Nothing is saved here, but on Google's free tier what is sent may be used to improve Google's products.";

function problemText(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail;
  }
  if (error instanceof TypeError) {
    return 'The backend cannot be reached. Check that it is running, then try again.';
  }
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

export default function SetupAssistant({ invite, onConversation, onChooseManually, onLeaveInvite }: SetupAssistantProps) {
  const [messages, setMessages] = useState<Message[]>(() => (invite ? [] : [{
    id: 0,
    from: 'assistant',
    text: `Hi! I translate conversations: with someone next to you, with someone on another device, or in an online meeting. Just say hello in your own language and I'll work out the rest. ${DISCLOSURE}`,
  }]));
  const [phase, setPhase] = useState<Phase>(invite ? 'loading' : 'intro');
  const [listeningTo, setListeningTo] = useState<SpeakerId>('A');
  const [level, setLevel] = useState(0);
  const [retry, setRetry] = useState<Retry>({ kind: 'listen', person: 'A' });
  const [link, setLink] = useState('');
  const [linkProblem, setLinkProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const whereRef = useRef<Where>(invite ? 'guest' : 'here');
  const hostRef = useRef<Participant | null>(null);
  const roomRef = useRef<CreatedRoom | null>(null);
  const foundRef = useRef<Partial<Record<SpeakerId, DetectedLanguage>>>({});
  const captureRef = useRef<AudioCapture | null>(null);
  const detectorRef = useRef<PhraseDetector | null>(null);
  const finishRef = useRef<(() => void) | null>(null);
  const roomTimerRef = useRef<number | null>(null);
  const runRef = useRef(0);
  const nextIdRef = useRef(1);
  const listRef = useRef<HTMLOListElement | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const listenRef = useRef<((person: SpeakerId) => Promise<void>) | null>(null);

  const add = useCallback((from: Message['from'], text: string) => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    setMessages((current) => [...current, { id, from, text }]);
  }, []);

  const stopCapture = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    setLevel(0);
  }, []);

  const stopWaiting = useCallback(() => {
    if (roomTimerRef.current !== null) {
      window.clearTimeout(roomTimerRef.current);
      roomTimerRef.current = null;
    }
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      void leaveRoom(room.room_id, room.host_token).catch(() => undefined);
    }
  }, []);

  useEffect(() => () => {
    runRef.current += 1;
    captureRef.current?.stop();
    if (roomTimerRef.current !== null) {
      window.clearTimeout(roomTimerRef.current);
    }
    const room = roomRef.current;
    if (room) {
      void leaveRoom(room.room_id, room.host_token).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (phase === 'intro' || phase === 'loading') {
      return;
    }
    const actions = actionsRef.current;
    const active = document.activeElement;
    if (actions && (active === document.body || active === null || actions.contains(active))) {
      actions.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }, [phase]);

  useEffect(() => {
    if (!invite) {
      return undefined;
    }
    let cancelled = false;
    getRoom(invite.roomId, invite.token).then((room) => {
      if (cancelled) {
        return;
      }
      if (room.guest) {
        add('assistant', 'Someone has already joined this conversation. Ask for a new link.');
        setPhase('dead');
        return;
      }
      hostRef.current = room.host;
      add(
        'assistant',
        `Hi! Someone who speaks ${languageName(room.host.preferred_language)} invited you to a translated conversation. Say hello in your own language and I'll set it up. ${DISCLOSURE}`,
      );
      setPhase('intro');
    }, (error: unknown) => {
      if (!cancelled) {
        add('assistant', problemText(error));
        setPhase('dead');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [add, invite]);

  const fail = useCallback((text: string, next: Retry) => {
    add('assistant', text);
    setRetry(next);
    setPhase('retry');
  }, [add]);

  const startMeeting = useCallback(async (found: DetectedLanguage, run: number) => {
    setPhase('starting');
    const session = await createSession([{ id: 'A', name: 'You', preferred_language: found.language }], true, 'call');
    if (run === runRef.current) {
      add('assistant', `Captions will be in ${languageName(found.language)}. Next, connect your meeting.`);
      onConversation(sessionConversation(session));
    }
  }, [add, onConversation]);

  const startTogether = useCallback(async () => {
    const run = runRef.current;
    const first = foundRef.current.A;
    const second = foundRef.current.B;
    if (!first || !second) {
      return;
    }
    setPhase('starting');
    try {
      const session = await createSession([
        { id: 'A', name: PEOPLE.A, preferred_language: first.language },
        { id: 'B', name: PEOPLE.B, preferred_language: second.language },
      ], true);
      if (run === runRef.current) {
        onConversation(sessionConversation(session));
      }
    } catch (error) {
      if (run === runRef.current) {
        fail(problemText(error), { kind: 'start' });
      }
    }
  }, [fail, onConversation]);

  const waitForGuest = useCallback((room: CreatedRoom) => {
    const run = runRef.current;
    const check = (): void => {
      roomTimerRef.current = null;
      getRoom(room.room_id, room.host_token).then((latest) => {
        if (run !== runRef.current) {
          return;
        }
        if (latest.guest) {
          roomRef.current = null;
          add('assistant', `They joined, speaking ${languageName(latest.guest.preferred_language)}. Starting now.`);
          setPhase('starting');
          onConversation(roomConversation(latest, room.host_token, 'A'));
          return;
        }
        roomTimerRef.current = window.setTimeout(check, ROOM_CHECK_MS);
      }, (error: unknown) => {
        if (run !== runRef.current) {
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          fail(`${error.detail} Tap Start over to make a new one.`, { kind: 'listen', person: 'A' });
          return;
        }
        roomTimerRef.current = window.setTimeout(check, ROOM_CHECK_MS);
      });
    };
    roomTimerRef.current = window.setTimeout(check, ROOM_CHECK_MS);
  }, [add, fail, onConversation]);

  const afterDetecting = useCallback(async (person: SpeakerId, found: DetectedLanguage, run: number) => {
    const where = whereRef.current;
    if (where === 'meeting') {
      await startMeeting(found, run);
      return;
    }
    if (where === 'guest' && invite) {
      const host = hostRef.current;
      if (host && host.preferred_language === found.language) {
        fail(
          `You both speak ${languageName(found.language)}, so there is nothing to translate. Say hello in a different language.`,
          { kind: 'listen', person },
        );
        return;
      }
      setPhase('starting');
      try {
        const joined = await joinRoom(invite.roomId, invite.token, { name: PEOPLE.B, preferred_language: found.language });
        if (run === runRef.current) {
          add('assistant', 'You are connected. Starting now.');
          onConversation(roomConversation(joined.room, joined.token, 'B'));
        }
      } catch (error) {
        if (run !== runRef.current) {
          return;
        }
        if (error instanceof ApiError && (error.status === 409 || error.status === 404 || error.status === 403)) {
          add('assistant', error.detail);
          setPhase('dead');
          return;
        }
        throw error;
      }
      return;
    }
    if (where === 'remote') {
      setPhase('starting');
      const room = await createRoom({ name: PEOPLE.A, preferred_language: found.language });
      if (run !== runRef.current) {
        void leaveRoom(room.room_id, room.host_token).catch(() => undefined);
        return;
      }
      roomRef.current = room;
      setLink(inviteLink(room, window.location.origin));
      setLinkProblem(inviteProblem(room, window.location.hostname));
      setCopied(false);
      add(
        'assistant',
        room.public_url || inviteProblem(room, window.location.hostname) === null
          ? 'Send this link to the other person. I will start as soon as they open it and say hello.'
          : 'I could not make a public link, so this one only works on this computer.',
      );
      setPhase('waiting');
      waitForGuest(room);
      return;
    }
    const other = person === 'A' ? foundRef.current.B : foundRef.current.A;
    if (other && other.language === found.language) {
      fail(
        `You both speak ${languageName(found.language)}, so there is nothing to translate. ${PEOPLE[person]}, say hello in a different language.`,
        { kind: 'listen', person },
      );
      return;
    }
    foundRef.current = { ...foundRef.current, [person]: found };
    if (person === 'A' && !foundRef.current.B) {
      add('assistant', `Got it. ${PEOPLE.B}, now say hello in your language.`);
      void listenRef.current?.('B');
      return;
    }
    add('assistant', `${languageName(foundRef.current.A!.language)} and ${languageName(foundRef.current.B!.language)}. Starting now.`);
    void startTogether();
  }, [add, fail, invite, onConversation, startMeeting, startTogether, waitForGuest]);

  const listen = useCallback(async (person: SpeakerId) => {
    runRef.current += 1;
    const run = runRef.current;
    stopCapture();
    stopWaiting();
    setListeningTo(person);
    setPhase('opening');

    const heard = async (detector: PhraseDetector): Promise<void> => {
      if (run !== runRef.current || detectorRef.current !== detector) {
        return;
      }
      detectorRef.current = null;
      finishRef.current = null;
      stopCapture();
      if (detector.state !== 'done') {
        fail("I didn't hear anything. Tap Try again and say hello.", { kind: 'listen', person });
        return;
      }
      setPhase('checking');
      try {
        const found = await detectLanguage(detector.wav(), invite ? { roomId: invite.roomId, token: invite.token } : undefined);
        if (run !== runRef.current) {
          return;
        }
        add(person, languageLabel(found.language));
        await afterDetecting(person, found, run);
      } catch (error) {
        if (run === runRef.current) {
          fail(problemText(error), { kind: 'listen', person });
        }
      }
    };

    try {
      const capture = await openMicrophoneCapture();
      if (run !== runRef.current) {
        capture.stop();
        return;
      }
      const detector = new PhraseDetector();
      captureRef.current = capture;
      detectorRef.current = detector;
      finishRef.current = () => {
        detector.finish();
        void heard(detector);
      };
      capture.start(
        (frame) => {
          const state = detector.add(frame);
          if (state === 'done' || state === 'silent') {
            void heard(detector);
          }
        },
        (value) => setLevel(value),
        () => {
          if (run === runRef.current) {
            stopCapture();
            fail('The microphone was disconnected. Plug it back in and tap Try again.', { kind: 'listen', person });
          }
        },
      );
      setPhase('listening');
    } catch (error) {
      if (run === runRef.current) {
        fail(problemText(error), { kind: 'listen', person });
      }
    }
  }, [add, afterDetecting, fail, invite, stopCapture, stopWaiting]);

  listenRef.current = listen;

  function agree(): void {
    if (phase !== 'intro') {
      return;
    }
    if (whereRef.current === 'guest') {
      add('assistant', 'Say hello in your language.');
      void listen('B');
      return;
    }
    add('assistant', WHERE_QUESTION);
    setPhase('where');
  }

  function choose(where: 'here' | 'remote' | 'meeting'): void {
    if (phase !== 'where') {
      return;
    }
    whereRef.current = where;
    const prompts = {
      here: `${PEOPLE.A}, say hello in your language.`,
      remote: 'Say hello in your language.',
      meeting: 'Say hello in the language you want the captions in.',
    };
    add('assistant', prompts[where]);
    void listen('A');
  }

  function tryAgain(): void {
    if (retry.kind === 'start') {
      add('assistant', 'Trying again.');
      void startTogether();
    } else {
      void listen(retry.person);
    }
  }

  function startOver(): void {
    runRef.current += 1;
    stopCapture();
    stopWaiting();
    foundRef.current = {};
    setLink('');
    setLinkProblem(null);
    if (whereRef.current === 'guest') {
      add('assistant', 'Starting over. Say hello in your language.');
      void listen('B');
      return;
    }
    add('assistant', `Starting over. ${WHERE_QUESTION}`);
    setPhase('where');
  }

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function shareLink(): void {
    void navigator.share({ title: 'Voice Translator', text: 'Join my translated conversation', url: link }).catch(() => undefined);
  }

  const meter = Math.round(Math.max(0, Math.min(1, level)) * 100);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const listName = whereRef.current === 'guest' ? null : onChooseManually;

  return (
    <section className="assistant" aria-label="Setup assistant">
      <ol className="assistant-messages" ref={listRef} aria-live="polite" aria-label="Setup messages" tabIndex={0}>
        {messages.map((message) => (
          <li
            key={message.id}
            className={`assistant-message ${message.from === 'assistant' ? 'from-assistant' : 'from-person'}`}
          >
            {message.from !== 'assistant' && (
              <span className="assistant-who">{whereRef.current === 'here' ? PEOPLE[message.from] : 'You'}</span>
            )}
            <span dir="auto">{message.text}</span>
          </li>
        ))}
        {phase === 'loading' && (
          <li className="assistant-message from-assistant">
            <span>Opening the invitation</span>
          </li>
        )}
      </ol>

      {phase === 'waiting' && (
        <div className="invite-box">
          <label className="field-label" htmlFor="invite-link">Invite link</label>
          <input id="invite-link" className="text-input invite-link" readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
          {linkProblem && (
            <p className="invite-warning" role="note">{linkProblem}</p>
          )}
        </div>
      )}

      <div className="assistant-actions" ref={actionsRef}>
        {phase === 'intro' && (
          <>
            <button className="button button-primary" type="button" onClick={agree}>
              I agree, let&apos;s start
            </button>
            {listName && (
              <button className="button button-link" type="button" onClick={listName}>
                Choose languages from a list
              </button>
            )}
          </>
        )}
        {phase === 'where' && (
          <>
            <button className="button button-primary" type="button" onClick={() => choose('here')}>
              Next to me
            </button>
            <button className="button button-secondary" type="button" onClick={() => choose('remote')}>
              On another device
            </button>
            <button className="button button-secondary" type="button" onClick={() => choose('meeting')}>
              In an online meeting
            </button>
          </>
        )}
        {phase === 'opening' && (
          <p className="assistant-busy" role="status">
            <span className="spinner" aria-hidden="true" />
            Opening the microphone
          </p>
        )}
        {phase === 'listening' && (
          <>
            <div className="assistant-listening" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={meter}>
              <span className="assistant-mic" style={{ transform: `scale(${1 + meter / 160})` }} aria-hidden="true" />
              <span>{whereRef.current === 'here' ? `Listening to ${PEOPLE[listeningTo]}` : 'Listening'}</span>
            </div>
            <button className="button button-secondary button-small" type="button" onClick={() => finishRef.current?.()}>
              Done
            </button>
          </>
        )}
        {(phase === 'checking' || phase === 'starting') && (
          <p className="assistant-busy" role="status">
            <span className="spinner" aria-hidden="true" />
            {phase === 'checking' ? 'Finding the language' : 'Starting the conversation'}
          </p>
        )}
        {phase === 'waiting' && (
          <>
            <button className="button button-primary" type="button" onClick={() => void copyLink()}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
            {canShare && (
              <button className="button button-secondary" type="button" onClick={shareLink}>
                Share
              </button>
            )}
            <button className="button button-link" type="button" onClick={startOver}>
              Cancel
            </button>
            <p className="assistant-busy" role="status">
              <span className="spinner" aria-hidden="true" />
              Waiting for them to join
            </p>
          </>
        )}
        {phase === 'retry' && (
          <>
            <button className="button button-primary" type="button" onClick={tryAgain}>
              Try again
            </button>
            <button className="button button-secondary" type="button" onClick={startOver}>
              Start over
            </button>
            {listName && (
              <button className="button button-link" type="button" onClick={listName}>
                Choose from a list
              </button>
            )}
          </>
        )}
        {phase === 'dead' && (
          <button className="button button-primary" type="button" onClick={onLeaveInvite}>
            Start my own conversation
          </button>
        )}
      </div>
    </section>
  );
}
