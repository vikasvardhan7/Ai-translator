import { useRef } from 'react';

import { languageName } from '../../services/languageNames';
import type { Participant, SpeakerId } from '../../services/protocol';
import ChatTimeline from '../session/ChatTimeline';
import { MAX_TURNS, type Names, type Turn } from '../session/conversation';
import { downloadSubtitles, downloadText, downloadWord, printTranscript } from '../session/download';
import { usePanelFocus } from './usePanelFocus';

interface TranscriptPanelProps {
  open: boolean;
  title: string;
  turns: Turn[];
  participants: Participant[];
  names: Names;
  you: SpeakerId | null;
  onFixVoice: (utteranceId: string, voice: string) => void;
  onClose: () => void;
}

export default function TranscriptPanel({ open, title, turns, participants, names, you, onFixVoice, onClose }: TranscriptPanelProps) {
  const readers = you ? participants.filter((person) => person.id === you) : participants;
  const empty = !turns.some((turn) => turn.original);
  const panelRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const shown = turns.slice(-MAX_TURNS);
  usePanelFocus(open, onClose, panelRef);

  function save(action: () => void): void {
    action();
    if (menuRef.current) {
      menuRef.current.open = false;
    }
  }

  return (
    <aside className="transcript-panel" id="call-transcript" ref={panelRef} tabIndex={-1} aria-label="Transcript" hidden={!open}>
      <header className="transcript-header">
        <h2>Transcript</h2>
        <button className="button button-small button-secondary transcript-close" type="button" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="transcript-downloads">
        {empty ? (
          <button className="button button-small button-secondary" type="button" disabled>
            Download
          </button>
        ) : (
          <details className="download-menu" ref={menuRef}>
            <summary className="button button-small button-secondary">Download</summary>
            <div className="download-options">
              <button type="button" onClick={() => save(() => downloadWord(title, turns, participants, names))}>
                Word document (.docx)
              </button>
              <button type="button" onClick={() => save(() => printTranscript(title, turns, participants, names))}>
                PDF (choose Save as PDF)
              </button>
              <button type="button" onClick={() => save(() => downloadText(turns, participants, names))}>
                Plain text (.txt)
              </button>
              {readers.map((reader) => (
                <span className="download-pair" key={reader.id}>
                  <button type="button" onClick={() => save(() => downloadSubtitles(turns, reader, names, 'srt'))}>
                    Subtitles in {languageName(reader.preferred_language)} (.srt)
                  </button>
                  <button type="button" onClick={() => save(() => downloadSubtitles(turns, reader, names, 'vtt'))}>
                    Subtitles in {languageName(reader.preferred_language)} (.vtt)
                  </button>
                </span>
              ))}
            </div>
          </details>
        )}
      </div>
      <ChatTimeline participants={participants} names={names} turns={shown} you={you} onFixVoice={onFixVoice} />
    </aside>
  );
}
