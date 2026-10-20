import { useContext, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { askAssistant, type Source } from '../../services/api';
import AppIcon from '../desktop/AppIcon';
import { CallBridgeContext } from '../desktop/bridge';
import { history, MAX_MESSAGE_LENGTH, possibleActions, runActions, type DesktopHandlers } from './agent';
import { localIso } from '../meetings/invite';
import RichText from './RichText';

export interface ChatEntry {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  notes?: string[];
  sources?: Source[];
  failed?: boolean;
}

export interface Prompt {
  id: number;
  text: string;
}

interface AssistantAppProps {
  chat: ChatEntry[];
  onChat: (update: (chat: ChatEntry[]) => ChatEntry[]) => void;
  prompt: Prompt | null;
  onPromptTaken: () => void;
  running: boolean;
  desktop: DesktopHandlers;
}

const IN_CALL = ['Summarise so far', 'What are the action items?', 'What was decided?', 'Show the transcript'];
const ON_DESKTOP = ['Schedule a meeting tomorrow at 5 pm', 'Start a meeting now', 'What can you do?', 'Translate “good morning” into Telugu'];

function browserLanguage(): string {
  const tag = navigator.languages?.[0] ?? navigator.language ?? 'en';
  return tag.toLowerCase().split(/[-_]/)[0] || 'en';
}

function failure(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'The assistant could not answer. Please ask again.';
}

export default function AssistantApp({ chat, onChat, prompt, onPromptTaken, running, desktop }: AssistantAppProps) {
  const bridge = useContext(CallBridgeContext);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const chatRef = useRef(chat);
  const nextIdRef = useRef(chat.reduce((top, entry) => Math.max(top, entry.id), 0) + 1);
  const listRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  chatRef.current = chat;

  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    }
  }, [chat, busy]);

  async function send(text: string): Promise<void> {
    const asked = text.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!asked || busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    const mine: ChatEntry = { id: nextIdRef.current++, role: 'user', text: asked };
    const turns = [...chatRef.current.filter((entry) => !entry.failed), mine].map((entry) => ({
      role: entry.role,
      text: entry.text || (entry.notes ?? []).join('. '),
    }));
    onChat((current) => [...current, mine]);
    const controls = bridge?.get() ?? null;
    const call = controls ? { available: controls.actions, run: controls.run } : null;
    try {
      const reply = await askAssistant({
        messages: history(turns),
        language: controls?.language ?? browserLanguage(),
        transcript: controls?.transcript() ?? [],
        actions: possibleActions(running, call),
        now: localIso(),
      });
      const latest = bridge?.get() ?? null;
      const notes = runActions(reply.actions, desktop, latest ? { available: latest.actions, run: latest.run } : null);
      onChat((current) => [...current, { id: nextIdRef.current++, role: 'assistant', text: reply.answer, notes, sources: reply.sources }]);
    } catch (error) {
      onChat((current) => [...current, { id: nextIdRef.current++, role: 'assistant', text: failure(error), failed: true }]);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    if (prompt && !busyRef.current) {
      onPromptTaken();
      void send(prompt.text);
    }
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = draft;
    setDraft('');
    void send(text);
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  const lastAsked = [...chat].reverse().find((entry) => entry.role === 'user')?.text ?? '';
  const suggestions = running ? IN_CALL : ON_DESKTOP;

  return (
    <div className="chat-app">
      <div className="chat-toolbar">
        <p className="chat-context" data-live={running}>
          <span aria-hidden="true" />
          {running ? 'Knows what is said in the running call' : 'Searches the web when needed'}
        </p>
        <button className="button button-small button-secondary" type="button" onClick={() => onChat(() => [])} disabled={busy || chat.length === 0}>
          New chat
        </button>
      </div>
      <div className="chat-scroll" ref={listRef}>
        {chat.length === 0 ? (
          <div className="chat-welcome">
            <AppIcon name="assistant" size="large" />
            <h3>How can I help?</h3>
            <p>Ask a question, ask about the meeting, or tell me what to do: open an app, start captions, mute, show the transcript.</p>
            <div className="chat-suggestions">
              {suggestions.map((suggestion) => (
                <button className="chat-suggestion" type="button" key={suggestion} onClick={() => void send(suggestion)} disabled={busy}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="chat-list" aria-live="polite" aria-label="Chat">
            {chat.map((entry) => (
              <li className="chat-entry" data-role={entry.role} data-failed={entry.failed ?? false} key={entry.id}>
                {entry.role === 'assistant' && <AppIcon name="assistant" size="small" />}
                <div className="chat-bubble">
                  {entry.text && (entry.role === 'assistant' && !entry.failed ? <RichText text={entry.text} /> : <p dir="auto">{entry.text}</p>)}
                  {entry.notes && entry.notes.length > 0 && (
                    <ul className="chat-notes" aria-label="Done">
                      {entry.notes.map((done) => <li key={done}>{done}</li>)}
                    </ul>
                  )}
                  {entry.sources && entry.sources.length > 0 && (
                    <ul className="chat-sources" aria-label="Sources">
                      {entry.sources.map((source) => (
                        <li key={source.url}>
                          <a href={source.url} target="_blank" rel="noreferrer noopener">{source.title}</a>
                        </li>
                      ))}
                    </ul>
                  )}
                  {entry.failed && (
                    <button className="button button-small button-secondary" type="button" disabled={busy} onClick={() => void send(lastAsked)}>
                      Ask again
                    </button>
                  )}
                </div>
              </li>
            ))}
            {busy && (
              <li className="chat-entry" data-role="assistant">
                <AppIcon name="assistant" size="small" />
                <div className="chat-bubble chat-thinking" role="status" aria-label="Thinking">
                  <span /><span /><span />
                </div>
              </li>
            )}
          </ol>
        )}
      </div>
      <form className="chat-composer" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="chat-input">Message the assistant</label>
        <textarea
          id="chat-input"
          rows={1}
          value={draft}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Message the assistant"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={keyDown}
        />
        <button className="chat-send" type="submit" disabled={busy || !draft.trim()} aria-label="Send">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12 2-12 2z" fill="currentColor" /></svg>
        </button>
      </form>
      <p className="chat-footnote">Answers come from Google Gemini and can be wrong. Nothing here is saved.</p>
    </div>
  );
}
