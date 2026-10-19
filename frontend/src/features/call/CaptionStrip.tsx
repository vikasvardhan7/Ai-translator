import { memo } from 'react';

import type { SpeakerId } from '../../services/protocol';
import { speakerName, type Names, type Turn } from '../session/conversation';

interface CaptionStripProps {
  turns: Turn[];
  names: Names;
  readers: SpeakerId[];
  emptyText: string;
}

function CaptionStrip({ turns, names, readers, emptyText }: CaptionStripProps) {
  const latest = turns.at(-1);
  if (!latest) {
    return (
      <div className="caption-strip caption-empty">
        <p>{emptyText}</p>
      </div>
    );
  }
  const speaker = speakerName(names, latest.speakerId);
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
          {readers.length > 1 && <span className="caption-for">{names[line.reader]}</span>}
          {line.waiting ? <span className="caption-original">{line.text}</span> : line.text}
        </p>
      ))}
    </div>
  );
}

export default memo(CaptionStrip);
