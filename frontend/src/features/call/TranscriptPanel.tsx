import { useRef } from 'react';

import { languageName } from '../../services/languageNames';
import type { Participant, SpeakerId } from '../../services/protocol';
import ChatTimeline from '../session/ChatTimeline';
import { MAX_TURNS, type Names, type Turn } from '../session/conversation';
import { transcriptSubtitles, transcriptText } from '../session/transcript';
import { usePanelFocus } from './usePanelFocus';

interface TranscriptPanelProps {
  open: boolean;
  turns: Turn[];
  participants: Participant[];
  names: Names;
  you: SpeakerId | null;
  onClose: () => void;
}

function stamp(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

const KEEP_DOWNLOAD_MS = 10_000;

function save(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), KEEP_DOWNLOAD_MS);
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
          onClick={() => save(`conversation-${stamp()}.txt`, transcriptText(turns, participants, names), 'text/plain;charset=utf-8')}
        >
          Download text
        </button>
        {readers.map((reader) => (
          <button
            className="button button-small button-secondary"
            type="button"
            disabled={empty}
            key={reader.id}
            onClick={() => save(
              `conversation-${stamp()}-${reader.preferred_language}.srt`,
              transcriptSubtitles(turns, reader.id, names),
              'application/x-subrip;charset=utf-8',
            )}
          >
            Subtitles ({languageName(reader.preferred_language)})
          </button>
        ))}
      </div>
      <ChatTimeline participants={participants} names={names} turns={shown} you={you} />
    </aside>
  );
}
