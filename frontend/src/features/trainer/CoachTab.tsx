import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { askCoach, localDay, localNow, type Entry, type TrainerState } from '../../services/trainer';
import RichText from '../assistant/RichText';
import AppIcon from '../desktop/AppIcon';
import { problemText } from './problems';

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
}

const MAX_LINES = 30;
const SUGGESTIONS = [
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
      return `${data.name}, ${data.sets} sets`;
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

export default function CoachTab({ state, chat, onChat, onLogged }: CoachTabProps) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const nextId = useRef(chat.length + 1);

  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [chat, busy]);

  async function send(text: string): Promise<void> {
    const asked = text.trim();
    if (!asked || busy) {
      return;
    }
    const mine: CoachEntry = { id: nextId.current++, role: 'user', text: asked };
    const history = [...chat.filter((entry) => !entry.failed), mine]
      .slice(-MAX_LINES)
      .map((entry) => ({ role: entry.role, text: entry.text.slice(0, 4000) }));
    onChat((current) => [...current, mine]);
    setDraft('');
    setBusy(true);
    try {
      const reply = await askCoach(history, localDay(), localNow());
      onChat((current) => [...current, { id: nextId.current++, role: 'assistant', text: reply.answer, logged: reply.logged.map(said) }]);
      if (reply.logged.length > 0) {
        onLogged();
      }
    } catch (error) {
      onChat((current) => [...current, { id: nextId.current++, role: 'assistant', text: problemText(error), failed: true }]);
    } finally {
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
        <button className="button button-small button-secondary" type="button" onClick={() => onChat(() => [])} disabled={busy || chat.length === 0}>
          New chat
        </button>
      </div>
      <div className="chat-scroll" ref={listRef}>
        {chat.length === 0 ? (
          <div className="chat-welcome">
            <AppIcon name="trainer" size="large" />
            <h3>Your coach</h3>
            <p>Ask about training and food, or just tell it what you did and ate; it logs it for you.</p>
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
          placeholder="Tell your coach what you did, or ask anything"
          disabled={!state.coach_ready}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={keyDown}
        />
        <button className="chat-send" type="submit" disabled={busy || !draft.trim() || !state.coach_ready} aria-label="Send">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12 2-12 2z" fill="currentColor" /></svg>
        </button>
      </form>
      <p className="chat-footnote">Answers come from Google Gemini and can be wrong; this is not medical advice. The chat is not saved; what it logs is.</p>
    </div>
  );
}
