import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiError,
  createRoom,
  createSession,
  detectLanguage,
  getRoom,
  joinRoom,
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
import type { SpeakerId } from '../../services/protocol';
import type { Where as Start } from '../assistant/agent';
import { PhraseDetector } from './phrase';

interface SetupAssistantProps {
  invite: Invite | null;
  start: Start | null;
  onConversation: (conversation: Conversation) => void;
  onChooseManually: () => void;
  onLeaveInvite: () => void;
}

type Phase = 'loading' | 'intro' | 'where' | 'opening' | 'listening' | 'checking' | 'retry' | 'starting' | 'dead';
type Where = 'here' | 'remote' | 'meeting' | 'guest';
type Retry = { kind: 'listen'; person: SpeakerId } | { kind: 'start' };

interface Message {
  id: number;
  from: 'assistant' | SpeakerId;
  text: string;
}

const PEOPLE: Partial<Record<SpeakerId, string>> = { A: 'Person 1', B: 'Person 2' };
const NAME_KEY = 'voice-translator-name';
const MAX_NAME_LENGTH = 40;

function savedName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    return;
  }
}

function personLabel(id: SpeakerId): string {
  return PEOPLE[id] ?? 'You';
}
const WHERE_QUESTION = 'Who are you talking to: someone next to you, someone on another phone or computer, or people in an online meeting?';
const STARTS: Record<Start, string> = {
  here: 'Ready for a conversation with someone next to you.',
  remote: 'Ready for a call with people on other devices. You get one invite link that up to 5 people can use.',
  meeting: 'Ready for meeting captions.',
};
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

export default function SetupAssistant({ invite, start, onConversation, onChooseManually, onLeaveInvite }: SetupAssistantProps) {
  const [messages, setMessages] = useState<Message[]>(() => (invite ? [] : [{
    id: 0,
    from: 'assistant',
    text: start
      ? `${STARTS[start]} Press the button below, then say hello in your own language. ${DISCLOSURE}`
      : `Hi! I translate conversations: with someone next to you, with someone on another device, or in an online meeting. Just say hello in your own language and I'll work out the rest. ${DISCLOSURE}`,
  }]));
  const [phase, setPhase] = useState<Phase>(invite ? 'loading' : 'intro');
  const [listeningTo, setListeningTo] = useState<SpeakerId>('A');
  const [level, setLevel] = useState(0);
  const [retry, setRetry] = useState<Retry>({ kind: 'listen', person: 'A' });
  const [name, setName] = useState(savedName);
  const [askName, setAskName] = useState(start === 'remote');
  const whereRef = useRef<Where>(invite ? 'guest' : 'here');
  const nameRef = useRef(name);
  const foundRef = useRef<Partial<Record<SpeakerId, DetectedLanguage>>>({});
  const captureRef = useRef<AudioCapture | null>(null);
  const detectorRef = useRef<PhraseDetector | null>(null);
  const finishRef = useRef<(() => void) | null>(null);
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

  useEffect(() => () => {
    runRef.current += 1;
    captureRef.current?.stop();
  }, []);

  useEffect(() => {
    nameRef.current = name;
  }, [name]);

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
      if (room.guests.length + 1 >= room.max_people) {
        add('assistant', `This conversation is full: ${room.max_people} people are already in it. Ask for a new link.`);
        setPhase('dead');
        return;
      }
      const others = room.guests.length === 0
        ? ''
        : ` ${room.guests.length === 1 ? 'One other person is' : `${room.guests.length} other people are`} already there.`;
      add(
        'assistant',
        `Hi! ${room.host.name} (${languageName(room.host.preferred_language)}) invited you to a translated call.${others} Type your name, then say hello in your own language and I'll set it up. ${DISCLOSURE}`,
      );
      setAskName(true);
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
        { id: 'A', name: personLabel('A'), preferred_language: first.language },
        { id: 'B', name: personLabel('B'), preferred_language: second.language },
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

  const afterDetecting = useCallback(async (person: SpeakerId, found: DetectedLanguage, run: number) => {
    const where = whereRef.current;
    if (where === 'meeting') {
      await startMeeting(found, run);
      return;
    }
    const myName = nameRef.current.trim().slice(0, MAX_NAME_LENGTH);
    if (where === 'guest' && invite) {
      setPhase('starting');
      try {
        saveName(myName);
        const joined = await joinRoom(invite.roomId, invite.token, { name: myName || 'Guest', preferred_language: found.language });
        if (run === runRef.current) {
          add('assistant', 'You are connected. Starting now.');
          onConversation(roomConversation(joined.room, joined.token, joined.you));
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
      saveName(myName);
      const room = await createRoom({ name: myName || 'Host', preferred_language: found.language });
      if (run !== runRef.current) {
        return;
      }
      const invitation = {
        link: inviteLink(room, window.location.origin),
        problem: inviteProblem(room, window.location.hostname),
      };
      add('assistant', 'Your call is ready. Share the invite link from the call; up to 5 people can join.');
      onConversation(roomConversation(room, room.host_token, 'A', invitation));
      return;
    }
    const other = person === 'A' ? foundRef.current.B : foundRef.current.A;
    if (other && other.language === found.language) {
      fail(
        `You both speak ${languageName(found.language)}, so there is nothing to translate. ${personLabel(person)}, say hello in a different language.`,
        { kind: 'listen', person },
      );
      return;
    }
    foundRef.current = { ...foundRef.current, [person]: found };
    if (person === 'A' && !foundRef.current.B) {
      add('assistant', `Got it. ${personLabel('B')}, now say hello in your language.`);
      void listenRef.current?.('B');
      return;
    }
    add('assistant', `${languageName(foundRef.current.A!.language)} and ${languageName(foundRef.current.B!.language)}. Starting now.`);
    void startTogether();
  }, [add, fail, invite, onConversation, startMeeting, startTogether]);

  const listen = useCallback(async (person: SpeakerId) => {
    runRef.current += 1;
    const run = runRef.current;
    stopCapture();
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
  }, [add, afterDetecting, fail, invite, stopCapture]);

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
    if (start) {
      begin(start);
      return;
    }
    add('assistant', WHERE_QUESTION);
    setPhase('where');
  }

  function choose(where: Start): void {
    if (phase === 'where') {
      begin(where);
    }
  }

  function begin(where: Start): void {
    whereRef.current = where;
    setAskName(where === 'remote');
    const prompts = {
      here: `${personLabel('A')}, say hello in your language.`,
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
    foundRef.current = {};
    if (whereRef.current === 'guest') {
      add('assistant', 'Starting over. Say hello in your language.');
      void listen('B');
      return;
    }
    add('assistant', `Starting over. ${WHERE_QUESTION}`);
    setPhase('where');
  }

  const meter = Math.round(Math.max(0, Math.min(1, level)) * 100);
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
              <span className="assistant-who">{whereRef.current === 'here' ? personLabel(message.from) : 'You'}</span>
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

      {askName && (phase === 'intro' || phase === 'where' || phase === 'retry' || phase === 'listening') && (
        <div className="name-box">
          <label className="field-label" htmlFor="setup-name">Your name (others in the call see it)</label>
          <input
            id="setup-name"
            className="text-input"
            type="text"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="name"
            placeholder={whereRef.current === 'guest' ? 'Guest' : 'Host'}
            onChange={(event) => setName(event.target.value)}
          />
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
              <span>{whereRef.current === 'here' ? `Listening to ${personLabel(listeningTo)}` : 'Listening'}</span>
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
