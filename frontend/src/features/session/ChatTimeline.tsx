import { memo, useEffect, useRef, useState } from 'react';

import type { Participant, SpeakerId } from '../../services/protocol';
import { bubbleFor, speakerName, turnSpeaker, voiceChoices, type Bubble, type Names, type Turn, type VoiceChoice } from './conversation';

interface ChatTimelineProps {
  participants: Participant[];
  names: Names;
  turns: Turn[];
  you: SpeakerId | null;
  onFixVoice?: (utteranceId: string, voice: string) => void;
}

function VoiceName({ name, current, choices, onChoose }: { name: string; current: string; choices: VoiceChoice[]; onChoose: (voice: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="voice-name">
      <button
        className="voice-name-button"
        type="button"
        aria-expanded={open}
        aria-label={`${name}. Wrong person? Choose who said this`}
        onClick={() => setOpen((shown) => !shown)}
      >
        {name}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <span className="voice-choices" role="group" aria-label="Who said this?">
          {choices.filter((choice) => choice.voice !== current).map((choice) => (
            <button
              className="button button-small button-secondary"
              type="button"
              key={choice.voice}
              onClick={() => {
                setOpen(false);
                onChoose(choice.voice);
              }}
            >
              {choice.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

const SCROLL_STICKY_PX = 48;

function sideClass(side: SpeakerId | null, right: SpeakerId): string {
  if (side === null) {
    return 'bubble-center';
  }
  return side === right ? 'bubble-right' : 'bubble-left';
}

function ChatTimeline({ participants, names, turns, you, onFixVoice }: ChatTimelineProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickyRef = useRef(true);
  const nameOf = (id: SpeakerId | null): string => speakerName(names, id);

  useEffect(() => {
    const list = listRef.current;
    if (list && stickyRef.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [turns]);

  function renderBubble(turn: Turn, bubble: Bubble) {
    const className = `bubble ${sideClass(bubble.side, you ?? 'B')} bubble-${bubble.kind}`;
    switch (bubble.kind) {
      case 'pending':
        return (
          <article className={className} key={turn.utteranceId}>
            <p className="bubble-meta">{nameOf(bubble.side)} spoke</p>
            <p className="bubble-dots">
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span className="visually-hidden">Translating</span>
            </p>
          </article>
        );
      case 'failed':
        return (
          <article className={className} key={turn.utteranceId}>
            <p className="bubble-meta">{nameOf(bubble.side)}</p>
            <p className="bubble-error">{bubble.error}</p>
          </article>
        );
      default: {
        const speaker = turnSpeaker(names, turn);
        const choices = onFixVoice ? voiceChoices(turns, turn, participants, names) : [];
        return (
          <article className={className} key={turn.utteranceId}>
            <p className="bubble-meta">
              {turn.voice && choices.length > 1 ? (
                <VoiceName name={speaker} current={turn.voice} choices={choices} onChoose={(voice) => onFixVoice?.(turn.utteranceId, voice)} />
              ) : (
                speaker
              )}
              {' · '}
              {bubble.languageName}
            </p>
            <p className="bubble-original" dir="auto">{bubble.text}</p>
            {bubble.translations.map((line) => (
              <p className="bubble-translation" dir="auto" key={line.listenerId}>
                <span className="visually-hidden">For {nameOf(line.listenerId)}: </span>
                {line.text}
              </p>
            ))}
            {bubble.translating && (
              <p className="bubble-dots bubble-dots-small">
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span aria-hidden="true" />
                <span className="visually-hidden">Translating</span>
              </p>
            )}
          </article>
        );
      }
    }
  }

  return (
    <div
      className="chat-timeline"
      ref={listRef}
      role="region"
      aria-label="Conversation"
      tabIndex={0}
      onScroll={(event) => {
        const list = event.currentTarget;
        stickyRef.current = list.scrollHeight - list.scrollTop - list.clientHeight <= SCROLL_STICKY_PX;
      }}
    >
      {turns.length === 0 ? (
        <p className="chat-empty">Just talk. Each sentence appears here with its translation.</p>
      ) : (
        turns.map((turn) => renderBubble(turn, bubbleFor(turn, participants)))
      )}
    </div>
  );
}

export default memo(ChatTimeline);
