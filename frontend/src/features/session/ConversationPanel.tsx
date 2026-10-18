import { memo, useEffect, useMemo, useRef } from 'react';

import { languageLabel, languageName } from '../../services/languageNames';
import type { Participant, SpeakerId } from '../../services/protocol';
import { viewFor, type Turn } from './conversation';

interface ConversationPanelProps {
  person: Participant;
  participants: Participant[];
  turns: Turn[];
  voiceOn: boolean;
  speaking: boolean;
  onToggleVoice: (id: SpeakerId) => void;
}

const SCROLL_STICKY_PX = 36;

function ConversationPanel({ person, participants, turns, voiceOn, speaking, onToggleVoice }: ConversationPanelProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickyRef = useRef(true);
  const label = useMemo(() => languageLabel(person.preferred_language), [person.preferred_language]);
  const nameOf = (id: SpeakerId | null): string =>
    participants.find((participant) => participant.id === id)?.name ?? 'Unknown speaker';

  useEffect(() => {
    const list = listRef.current;
    if (list && stickyRef.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [turns]);

  function renderTurn(turn: Turn) {
    const view = viewFor(turn, person);
    const speaker = nameOf(turn.speakerId);
    switch (view.kind) {
      case 'pending':
        return (
          <article className="turn turn-pending" key={turn.utteranceId}>
            <p className="turn-label">{turn.speakerId ? speaker : 'Someone'} spoke</p>
            <p className="turn-dots">
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span className="visually-hidden">Translating</span>
            </p>
          </article>
        );
      case 'failed':
        return (
          <article className="turn turn-failed" key={turn.utteranceId}>
            <p className="turn-label">{speaker}</p>
            <p className="turn-error">{view.error}</p>
          </article>
        );
      case 'own':
        return (
          <article className="turn turn-own" key={turn.utteranceId}>
            <p className="turn-label">You said · {view.languageName}</p>
            <p className="turn-text" dir="auto">{view.text}</p>
          </article>
        );
      case 'translated':
        return (
          <article className="turn turn-translated" key={turn.utteranceId}>
            <p className="turn-label">{speaker} · from {view.languageName}</p>
            <p className="turn-text" dir="auto">{view.text}</p>
            <p className="turn-original" dir="auto">{view.original}</p>
          </article>
        );
      default:
        return (
          <article className="turn turn-translated" key={turn.utteranceId}>
            <p className="turn-label">{speaker} · {view.languageName}</p>
            <p className="turn-text" dir="auto">{view.text}</p>
            <p className="turn-note">In your language</p>
          </article>
        );
    }
  }

  return (
    <section className="conversation-panel" aria-labelledby={`person-${person.id}-title`}>
      <header className="conversation-panel-header">
        <div>
          <h2 id={`person-${person.id}-title`} dir="auto">{person.name}</h2>
          <p className="language-label">{label}</p>
        </div>
        <label className="voice-toggle">
          <input
            type="checkbox"
            role="switch"
            aria-label={`Voice for ${person.name}`}
            checked={voiceOn}
            onChange={() => onToggleVoice(person.id)}
          />
          <span aria-hidden="true">Voice</span>
        </label>
      </header>
      <div
        className="utterance-list"
        data-speaking={speaking}
        ref={listRef}
        onScroll={(event) => {
          const list = event.currentTarget;
          stickyRef.current = list.scrollHeight - list.scrollTop - list.clientHeight <= SCROLL_STICKY_PX;
        }}
      >
        {turns.length === 0 ? (
          <p className="conversation-empty">
            Speak naturally. Each sentence appears here in {languageName(person.preferred_language)}.
          </p>
        ) : (
          turns.map(renderTurn)
        )}
      </div>
    </section>
  );
}

export default memo(ConversationPanel);
