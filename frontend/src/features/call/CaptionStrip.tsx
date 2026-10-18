import { memo } from 'react';

import type { Participant, SpeakerId } from '../../services/protocol';
import type { Turn } from '../session/conversation';

interface CaptionStripProps {
  turns: Turn[];
  participants: Participant[];
  readers: SpeakerId[];
  you: SpeakerId | null;
}

function nameOf(participants: Participant[], id: SpeakerId | null, you: SpeakerId | null): string {
  if (you && id) {
    return id === you ? 'You' : 'Them';
  }
  return participants.find((person) => person.id === id)?.name ?? 'Someone';
}

function CaptionStrip({ turns, participants, readers, you }: CaptionStripProps) {
  const latest = turns.at(-1);
  if (!latest) {
    return (
      <div className="caption-strip caption-empty">
        <p>Captions appear here in your language as soon as someone finishes a sentence.</p>
      </div>
    );
  }
  const speaker = nameOf(participants, latest.speakerId, you);
  if (!latest.original) {
    return (
      <div className="caption-strip" aria-hidden="true">
        <p className="caption-who">{latest.status === 'failed' ? speaker : `${speaker} is speaking`}</p>
        {latest.status === 'failed' ? (
          <p className="caption-line caption-error">{latest.error}</p>
        ) : (
          <p className="caption-dots"><span /><span /><span /></p>
        )}
      </div>
    );
  }
  const lines = readers.map((reader) => {
    const own = latest.speakerId === reader;
    const translated = latest.translations[reader]?.text;
    return { reader, text: own || !translated ? latest.original!.text : translated, waiting: !own && !translated && latest.speakerId !== null };
  });
  return (
    <div className="caption-strip" key={latest.utteranceId}>
      <p className="caption-who">{speaker}</p>
      {lines.map((line) => (
        <p className="caption-line" dir="auto" key={line.reader}>
          {readers.length > 1 && <span className="caption-for">{nameOf(participants, line.reader, you)}</span>}
          {line.waiting ? <span className="caption-original">{line.text}</span> : line.text}
        </p>
      ))}
    </div>
  );
}

export default memo(CaptionStrip);
