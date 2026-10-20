import type { Participant, SpeakerId } from '../../services/protocol';
import { languageName } from '../../services/languageNames';
import { turnSpeaker, type Names, type Turn } from './conversation';

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function cueTime(ms: number, separator: ',' | '.'): string {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1_000);
  const millis = total % 1_000;
  const pad = (value: number, size = 2): string => String(value).padStart(size, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(millis, 3)}`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function spoken(turns: readonly Turn[]): Turn[] {
  return turns.filter((turn) => turn.original);
}

export interface HeardLine {
  who: string;
  languageName: string;
  text: string;
}

export interface TranscriptEntry {
  time: string;
  speaker: string;
  languageName: string;
  text: string;
  heard: HeardLine[];
}

export function transcriptEntries(turns: readonly Turn[], participants: readonly Participant[], names: Names): TranscriptEntry[] {
  return spoken(turns).map((turn) => {
    const original = turn.original!;
    return {
      time: clock(turn.startedAt),
      speaker: turnSpeaker(names, turn),
      languageName: original.languageName,
      text: original.text,
      heard: participants.flatMap((person) => {
        const translation = turn.translations[person.id];
        return translation
          ? [{ who: names[person.id], languageName: languageName(translation.targetLanguage), text: translation.text }]
          : [];
      }),
    };
  });
}

export function transcriptText(turns: readonly Turn[], participants: readonly Participant[], names: Names): string {
  const lines = transcriptEntries(turns, participants, names).flatMap((entry) => [
    `[${entry.time}] ${entry.speaker} (${entry.languageName}): ${entry.text}`,
    ...entry.heard.map((line) => `    ${line.who} heard (${line.languageName}): ${line.text}`),
    '',
  ]);
  return lines.join('\n');
}

function readerText(turn: Turn, viewer: SpeakerId): string {
  return turn.speakerId === viewer
    ? turn.original!.text
    : turn.translations[viewer]?.text ?? turn.original!.text;
}

export function transcriptSubtitles(turns: readonly Turn[], viewer: SpeakerId, names: Names): string {
  const kept = spoken(turns);
  const start = kept[0]?.startedAt ?? 0;
  return kept.map((turn, index) => [
    String(index + 1),
    `${cueTime(turn.startedAt - start, ',')} --> ${cueTime(turn.endedAt - start, ',')}`,
    `${turnSpeaker(names, turn)}: ${oneLine(readerText(turn, viewer))}`,
    '',
  ].join('\n')).join('\n');
}

function cueText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function transcriptWebVtt(turns: readonly Turn[], viewer: SpeakerId, names: Names): string {
  const kept = spoken(turns);
  const start = kept[0]?.startedAt ?? 0;
  const cues = kept.map((turn) => [
    `${cueTime(turn.startedAt - start, '.')} --> ${cueTime(turn.endedAt - start, '.')}`,
    `<v ${cueText(oneLine(turnSpeaker(names, turn)))}>${cueText(oneLine(readerText(turn, viewer)))}`,
    '',
  ].join('\n'));
  return ['WEBVTT', '', ...cues].join('\n');
}

export const MAX_ASSISTANT_LINES = 400;
export const MAX_ASSISTANT_LINE_LENGTH = 2000;

export function assistantTranscript(turns: readonly Turn[], names: Names): Array<{ speaker: string; text: string }> {
  return spoken(turns)
    .map((turn) => ({
      speaker: turnSpeaker(names, turn),
      text: oneLine(turn.original!.text).slice(0, MAX_ASSISTANT_LINE_LENGTH),
    }))
    .filter((line) => line.text)
    .slice(-MAX_ASSISTANT_LINES);
}
