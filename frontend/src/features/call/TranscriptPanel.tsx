import { useRef } from 'react';

import { languageName } from '../../services/languageNames';
import type { Participant, SpeakerId } from '../../services/protocol';
import ChatTimeline from '../session/ChatTimeline';
import { MAX_TURNS, type Names, type Turn } from '../session/conversation';
import { downloadSubtitles, downloadText } from '../session/download';
import { usePanelFocus } from './usePanelFocus';

interface TranscriptPanelProps {
  open: boolean;
  turns: Turn[];
  participants: Participant[];
  names: Names;
  you: SpeakerId | null;
  onClose: () => void;
}

export default function TranscriptPanel({ open, turns, participants, names, you, onClose }: TranscriptPanelProps) {
  const readers = you ? participants.filter((person) => person.id === you) : participants;
  const empty = !turns.some((turn) => turn.original);
  const panelRef = useRef<HTMLElement | null>(null);
  const shown = turns.slice(-MAX_TURNS);
  usePanelFocus(open, onClose, panelRef);
  return (
    <aside className="transcript-panel" id="call-transcript" ref={panelRef} tabIndex={-1} aria-label="Transcript" hidden={!open}>
      <header className="transcript-header">
        <h2>Transcript</h2>
        <button className="button button-small button-secondary transcript-close" type="button" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="transcript-downloads">
        <button
          className="button button-small button-secondary"
          type="button"
          disabled={empty}
          onClick={() => downloadText(turns, participants, names)}
        >
          Download text
        </button>
        {readers.map((reader) => (
          <button
            className="button button-small button-secondary"
            type="button"
            disabled={empty}
            key={reader.id}
            onClick={() => downloadSubtitles(turns, reader, names)}
          >
            Subtitles ({languageName(reader.preferred_language)})
          </button>
        ))}
      </div>
      <ChatTimeline participants={participants} names={names} turns={shown} you={you} />
    </aside>
  );
}
