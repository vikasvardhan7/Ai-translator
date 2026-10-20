import { memo } from 'react';

import type { Participant } from '../../services/protocol';
import { awaitsTranslation, turnSpeaker, type Names, type Turn } from '../session/conversation';

export interface LiveLine {
  name: string;
  text: string;
}

interface CaptionStripProps {
  turns: Turn[];
  names: Names;
  readers: Participant[];
  emptyText: string;
  live: LiveLine | null;
}

function speaking(name: string): string {
  return name === 'You' ? 'You are speaking' : `${name} is speaking`;
}

function CaptionStrip({ turns, names, readers, emptyText, live }: CaptionStripProps) {
  const latest = turns.at(-1);
  if (live?.text) {
    return (
      <div className="caption-strip caption-live" aria-hidden="true">
        <p className="caption-who">{speaking(live.name)}</p>
        <p className="caption-line caption-words" dir="auto">{live.text}</p>
      </div>
    );
  }
  if (!latest) {
    return (
      <div className="caption-strip caption-empty">
        <p>{emptyText}</p>
      </div>
    );
  }
  const speaker = turnSpeaker(names, latest);
  if (!latest.original) {
    return (
      <div className="caption-strip" aria-hidden="true">
        <p className="caption-who">{latest.status === 'failed' ? speaker : speaking(speaker)}</p>
        {latest.status === 'failed' ? (
          <p className="caption-line caption-error">{latest.error}</p>
        ) : (
          <p className="caption-dots"><span /><span /><span /></p>
        )}
      </div>
    );
  }
  const lines = readers.map((reader) => {
    const own = latest.speakerId === reader.id;
    const translated = latest.translations[reader.id]?.text;
    return { reader: reader.id, text: own || !translated ? latest.original!.text : translated, waiting: awaitsTranslation(latest, reader) };
  });
  const shared = lines.length > 1 && lines.every((line) => !line.waiting && line.text === lines[0]!.text);
  const shown = shared ? lines.slice(0, 1) : lines;
  return (
    <div className="caption-strip" key={latest.utteranceId}>
      <p className="caption-who">{speaker}</p>
      {shown.map((line) => (
        <p className="caption-line" dir="auto" key={line.reader}>
          {shown.length > 1 && <span className="caption-for">{names[line.reader]}</span>}
          {line.waiting ? <span className="caption-original">{line.text}</span> : line.text}
        </p>
      ))}
    </div>
  );
}

export default memo(CaptionStrip);
