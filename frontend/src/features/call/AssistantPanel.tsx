import { useEffect, useRef, useState, type FormEvent } from 'react';

import { askAssistant, type RoomAccess } from '../../services/api';
import { languageName } from '../../services/languageNames';
import type { Names, Turn } from '../session/conversation';
import { assistantTranscript } from '../session/transcript';
import { usePanelFocus } from './usePanelFocus';

interface AssistantPanelProps {
  open: boolean;
  turns: Turn[];
  names: Names;
  language: string;
  room?: RoomAccess;
  onClose: () => void;
}

interface Exchange {
  id: number;
  question: string;
  answer?: string;
  failed?: string;
}

const MAX_QUESTION_LENGTH = 500;
const SUGGESTIONS = ['Summarise so far', 'What are the action items?', 'What was decided?', 'What did I miss in the last few minutes?'];

export default function AssistantPanel({ open, turns, names, language, room, onClose }: AssistantPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const nextId = useRef(1);
  const [question, setQuestion] = useState('');
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const busy = exchanges.some((exchange) => exchange.answer === undefined && exchange.failed === undefined);
  usePanelFocus(open, onClose, panelRef);

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView?.({ block: 'end' });
  }, [exchanges]);

  async function ask(text: string): Promise<void> {
    const asked = text.trim().slice(0, MAX_QUESTION_LENGTH);
    if (!asked || busy) {
      return;
    }
    const id = nextId.current++;
    setQuestion('');
    setExchanges((current) => [...current, { id, question: asked }]);
    try {
      const answer = await askAssistant(asked, language, assistantTranscript(turns, names), room);
      setExchanges((current) => current.map((item) => (item.id === id ? { ...item, answer } : item)));
    } catch (error) {
      const failed = error instanceof Error && error.message ? error.message : 'The assistant could not answer. Please ask again.';
      setExchanges((current) => current.map((item) => (item.id === id ? { ...item, failed } : item)));
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void ask(question);
  }

  return (
    <div
      className="settings-panel assistant-panel"
      id="call-assistant"
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label="Assistant"
      hidden={!open}
    >
      <header className="settings-header">
        <h2>Assistant</h2>
        <button className="button button-small button-secondary" type="button" onClick={onClose}>
          Done
        </button>
      </header>
      <p className="assistant-intro">
        Ask about what has been said so far. Answers come in {languageName(language)} and use only this conversation&apos;s
        transcript, which is not saved.
      </p>
      {exchanges.length === 0 ? (
        <div className="assistant-suggestions">
          {SUGGESTIONS.map((suggestion) => (
            <button className="button button-small button-secondary" type="button" key={suggestion} onClick={() => void ask(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
      ) : (
        <ol className="assistant-messages" ref={listRef} aria-live="polite">
          {exchanges.map((exchange) => (
            <li className="assistant-exchange" key={exchange.id}>
              <p className="assistant-question">{exchange.question}</p>
              {exchange.answer !== undefined && <p className="assistant-answer">{exchange.answer}</p>}
              {exchange.failed !== undefined && (
                <p className="assistant-answer assistant-failed" role="alert">
                  {exchange.failed}{' '}
                  <button className="button button-small button-secondary" type="button" disabled={busy} onClick={() => void ask(exchange.question)}>
                    Ask again
                  </button>
                </p>
              )}
              {exchange.answer === undefined && exchange.failed === undefined && (
                <p className="assistant-answer assistant-thinking" role="status">Reading the transcript…</p>
              )}
            </li>
          ))}
        </ol>
      )}
      <form className="assistant-form" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="assistant-question">Your question</label>
        <input
          id="assistant-question"
          className="text-input"
          type="text"
          value={question}
          maxLength={MAX_QUESTION_LENGTH}
          placeholder="Ask about the meeting"
          autoComplete="off"
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button className="button button-primary" type="submit" disabled={busy || !question.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}
