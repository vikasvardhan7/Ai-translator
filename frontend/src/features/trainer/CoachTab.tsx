import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { askCoach, localDay, localNow, type CoachAction, type Entry, type TrainerState } from '../../services/trainer';
import RichText from '../assistant/RichText';
import AppIcon from '../desktop/AppIcon';
import { problemText } from './problems';
import {
  canListen,
  canSpeak,
  languageOfText,
  listen,
  saveSpeechLanguage,
  saveVoiceWanted,
  speak,
  SPEECH_LANGUAGES,
  speechLanguage,
  stopSpeaking,
  voiceWanted,
  type Listening,
} from './voice';

export interface CoachEntry {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  logged?: string[];
  failed?: boolean;
}

interface CoachTabProps {
  state: TrainerState;
  chat: CoachEntry[];
  onChat: (update: (chat: CoachEntry[]) => CoachEntry[]) => void;
  onLogged: () => void;
  onActions: (actions: CoachAction[]) => string | null;
}

const MAX_LINES = 30;
const SUGGESTIONS = [
  'Start my workout',
  'Show me how to do a goblet squat',
  'I had 2 idli and sambar for breakfast',
  'I drank a litre of water',
  'What should I eat after my workout?',
  'My knees hurt after squats. What can I do instead?',
  'How am I doing this week?',
];

function said(entry: Entry): string {
  const data = entry.data;
  switch (data.kind) {
    case 'exercise':
      return `${data.name}, ${data.sets} ${data.sets === 1 ? 'set' : 'sets'}`;
    case 'meal':
      return `${data.food} (${data.calories} kcal)`;
    case 'water':
      return `${data.ml} ml water`;
    case 'weight':
      return `weight ${data.kg} kg`;
    case 'sleep':
      return `${data.hours} h sleep`;
    case 'steps':
      return `${data.count} steps`;
    case 'note':
      return 'a note';
  }
}

export default function CoachTab({ state, chat, onChat, onLogged, onActions }: CoachTabProps) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState(() => voiceWanted() && canSpeak());
  const [language, setLanguage] = useState(speechLanguage);
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const nextId = useRef(chat.length + 1);
  const ears = useRef<Listening | null>(null);
  const handsFree = useRef(false);
  const alive = useRef(true);
  const voiceRef = useRef(voice);
  const chatRef = useRef(chat);
  const busyRef = useRef(false);
  chatRef.current = chat;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      handsFree.current = false;
      ears.current?.stop();
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [chat, busy]);

  function startListening(): void {
    setProblem('');
    stopSpeaking();
    ears.current = listen(
      language,
      (words) => setDraft(words),
      (words) => {
        ears.current = null;
        setListening(false);
        if (words) {
          handsFree.current = true;
          void send(words);
        } else {
          handsFree.current = false;
        }
      },
      (message) => {
        handsFree.current = false;
        setProblem(message);
      },
    );
    setListening(ears.current !== null);
  }

  function toggleListening(): void {
    if (ears.current) {
      ears.current.stop();
      return;
    }
    startListening();
  }

  function toggleVoice(): void {
    const next = !voice;
    setVoice(next);
    saveVoiceWanted(next);
    if (!next) {
      stopSpeaking();
    }
  }

  async function send(text: string): Promise<void> {
    const asked = text.trim();
    if (!asked || busyRef.current) {
      return;
    }
    busyRef.current = true;
    const mine: CoachEntry = { id: nextId.current++, role: 'user', text: asked };
    const history = [...chatRef.current.filter((entry) => !entry.failed), mine]
      .slice(-MAX_LINES)
      .map((entry) => ({ role: entry.role, text: entry.text.slice(0, 4000) }));
    onChat((current) => [...current, mine]);
    setDraft('');
    setBusy(true);
    try {
      const reply = await askCoach(history, localDay(), localNow());
      const note = onActions(reply.actions);
      const answer = note ? `${reply.answer}\n\n${note}` : reply.answer;
      onChat((current) => [...current, { id: nextId.current++, role: 'assistant', text: answer, logged: reply.logged.map(said) }]);
      if (reply.logged.length > 0) {
        onLogged();
      }
      busyRef.current = false;
      setBusy(false);
      const leaving = reply.actions.some((action) => action.kind === 'start_workout' || action.kind === 'open');
      if (voiceRef.current && alive.current) {
        await speak(answer, languageOfText(answer, language));
      }
      if (handsFree.current && alive.current && !leaving && canListen()) {
        startListening();
      } else {
        handsFree.current = false;
      }
    } catch (error) {
      handsFree.current = false;
      onChat((current) => [...current, { id: nextId.current++, role: 'assistant', text: problemText(error), failed: true }]);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void send(draft);
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send(draft);
    }
  }

  return (
    <div className="chat-app coach">
      <div className="chat-toolbar">
        <p className="chat-context" data-live={state.coach_ready}>
          <span aria-hidden="true" />
          {state.coach_ready ? 'Knows your plans and what you logged' : 'The AI is not set up on this server'}
        </p>
        <div className="coach-tools">
          {canListen() && (
            <label className="coach-language">
              <span className="visually-hidden">Language you speak</span>
              <select
                className="text-input"
                value={language}
                onChange={(event) => {
                  setLanguage(event.currentTarget.value);
                  saveSpeechLanguage(event.currentTarget.value);
                }}
              >
                {SPEECH_LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </label>
          )}
          {canSpeak() && (
            <button className="button button-small button-secondary" type="button" aria-pressed={voice} onClick={toggleVoice}>
              {voice ? 'Voice on' : 'Voice off'}
            </button>
          )}
          <button
            className="button button-small button-secondary"
            type="button"
            onClick={() => {
              stopSpeaking();
              onChat(() => []);
            }}
            disabled={busy || chat.length === 0}
          >
            New chat
          </button>
        </div>
      </div>
      {problem && <p className="notice notice-danger coach-problem" role="alert">{problem}</p>}
      <div className="chat-scroll" ref={listRef}>
        {chat.length === 0 ? (
          <div className="chat-welcome">
            <AppIcon name="trainer" size="large" />
            <h3>Your coach</h3>
            <p>Ask about training and food, or just tell it what you did and ate; it logs it for you. Press the microphone to talk: it answers out loud and keeps listening until you stop.</p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button className="chat-suggestion" type="button" key={suggestion} onClick={() => void send(suggestion)} disabled={busy || !state.coach_ready}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="chat-list" aria-live="polite" aria-label="Coach chat">
            {chat.map((entry) => (
              <li className="chat-entry" data-role={entry.role} data-failed={entry.failed ?? false} key={entry.id}>
                {entry.role === 'assistant' && <AppIcon name="trainer" size="small" />}
                <div className="chat-bubble">
                  {entry.role === 'assistant' && !entry.failed ? <RichText text={entry.text} /> : <p dir="auto">{entry.text}</p>}
                  {entry.logged && entry.logged.length > 0 && (
                    <ul className="chat-notes" aria-label="Logged">
                      {entry.logged.map((line, index) => <li key={`${line}-${index}`}>Logged {line}</li>)}
                    </ul>
                  )}
                </div>
              </li>
            ))}
            {busy && (
              <li className="chat-entry" data-role="assistant">
                <AppIcon name="trainer" size="small" />
                <div className="chat-bubble chat-thinking" role="status" aria-label="Thinking">
                  <span /><span /><span />
                </div>
              </li>
            )}
          </ol>
        )}
      </div>
      <form className="chat-composer" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="coach-input">Message your coach</label>
        <textarea
          id="coach-input"
          rows={1}
          value={draft}
          maxLength={4000}
          placeholder={listening ? 'Listening… speak now' : 'Tell your coach what you did, or ask anything'}
          disabled={!state.coach_ready}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={keyDown}
        />
        {canListen() && (
          <button
            className="chat-mic"
            type="button"
            data-listening={listening}
            aria-pressed={listening}
            aria-label={listening ? 'Stop listening and send' : 'Talk to your coach'}
            disabled={busy || !state.coach_ready}
            onClick={toggleListening}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1a7 7 0 0 0 6-6.9Z" fill="currentColor" /></svg>
          </button>
        )}
        <button className="chat-send" type="submit" disabled={busy || !draft.trim() || !state.coach_ready} aria-label="Send">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12 2-12 2z" fill="currentColor" /></svg>
        </button>
      </form>
      <p className="chat-footnote">Answers come from Google Gemini and can be wrong; this is not medical advice. The chat is not saved; what it logs is. Speech is turned into words by your browser's own speech service.</p>
    </div>
  );
}
