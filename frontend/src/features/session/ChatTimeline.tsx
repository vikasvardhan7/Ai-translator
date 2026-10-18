import { memo, useEffect, useRef } from 'react';

import type { Participant, SpeakerId } from '../../services/protocol';
import { bubbleFor, type Bubble, type Turn } from './conversation';

interface ChatTimelineProps {
  participants: Participant[];
  turns: Turn[];
  you: SpeakerId | null;
}

const SCROLL_STICKY_PX = 48;

function sideClass(side: SpeakerId | null, right: SpeakerId): string {
  if (side === null) {
    return 'bubble-center';
  }
  return side === right ? 'bubble-right' : 'bubble-left';
}

function ChatTimeline({ participants, turns, you }: ChatTimelineProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickyRef = useRef(true);
  const nameOf = (id: SpeakerId | null): string => {
    if (you && id) {
      return id === you ? 'You' : 'Them';
    }
    return participants.find((person) => person.id === id)?.name ?? 'Someone';
  };

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
            <p className="bubble-meta">{bubble.side ? nameOf(bubble.side) : 'Someone'} spoke</p>
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
      default:
        return (
          <article className={className} key={turn.utteranceId}>
            <p className="bubble-meta">{nameOf(bubble.side)} · {bubble.languageName}</p>
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
