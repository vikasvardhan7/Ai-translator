import type { Participant } from '../../services/protocol';
import type { Names, Turn } from './conversation';
import { transcriptSubtitles, transcriptText } from './transcript';

const KEEP_DOWNLOAD_MS = 10_000;

function stamp(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function save(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), KEEP_DOWNLOAD_MS);
}

export function downloadText(turns: readonly Turn[], participants: readonly Participant[], names: Names): void {
  save(`conversation-${stamp()}.txt`, transcriptText(turns, participants, names), 'text/plain;charset=utf-8');
}

export function downloadSubtitles(turns: readonly Turn[], reader: Participant, names: Names): void {
  save(
    `conversation-${stamp()}-${reader.preferred_language}.srt`,
    transcriptSubtitles(turns, reader.id, names),
    'application/x-subrip;charset=utf-8',
  );
}
