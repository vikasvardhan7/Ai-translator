import type { Participant } from '../../services/protocol';
import { languageName } from '../../services/languageNames';
import type { Names, Turn } from './conversation';
import { transcriptDocx } from './docx';
import { printPage, transcriptPage } from './printout';
import { transcriptEntries, transcriptSubtitles, transcriptText, transcriptWebVtt } from './transcript';

const KEEP_DOWNLOAD_MS = 10_000;

function stamp(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export function saveFile(name: string, content: string | Uint8Array<ArrayBuffer>, type: string, byteOrderMark = true): void {
  const parts = typeof content === 'string' && byteOrderMark ? ['\uFEFF', content] : [content];
  const url = URL.createObjectURL(new Blob(parts, { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), KEEP_DOWNLOAD_MS);
}

export function downloadText(turns: readonly Turn[], participants: readonly Participant[], names: Names): void {
  saveFile(`conversation-${stamp()}.txt`, transcriptText(turns, participants, names), 'text/plain;charset=utf-8');
}

export type SubtitleFormat = 'srt' | 'vtt';

export function downloadSubtitles(turns: readonly Turn[], reader: Participant, names: Names, format: SubtitleFormat = 'srt'): void {
  const name = `conversation-${stamp()}-${reader.preferred_language}.${format}`;
  if (format === 'vtt') {
    saveFile(name, transcriptWebVtt(turns, reader.id, names), 'text/vtt;charset=utf-8', false);
  } else {
    saveFile(name, transcriptSubtitles(turns, reader.id, names), 'application/x-subrip;charset=utf-8');
  }
}

export function transcriptHeading(participants: readonly Participant[], names: Names, at: Date = new Date()): string {
  const people = participants.map((person) => `${names[person.id]} (${languageName(person.preferred_language)})`).join(', ');
  const when = at.toLocaleString([], { dateStyle: 'long', timeStyle: 'short' });
  return people ? `${when} · ${people}` : when;
}

export function downloadWord(title: string, turns: readonly Turn[], participants: readonly Participant[], names: Names): void {
  const file = transcriptDocx(title, transcriptHeading(participants, names), transcriptEntries(turns, participants, names));
  saveFile(`conversation-${stamp()}.docx`, file, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

export function printTranscript(title: string, turns: readonly Turn[], participants: readonly Participant[], names: Names): void {
  printPage(transcriptPage(title, transcriptHeading(participants, names), transcriptEntries(turns, participants, names)));
}
