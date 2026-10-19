import type { Participant, SpeakerId } from '../../services/protocol';
import { languageName } from '../../services/languageNames';
import { speakerName, type Names, type Turn } from './conversation';

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function srtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1_000);
  const millis = total % 1_000;
  const pad = (value: number, size = 2): string => String(value).padStart(size, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function spoken(turns: readonly Turn[]): Turn[] {
  return turns.filter((turn) => turn.original);
}

export function transcriptText(turns: readonly Turn[], participants: readonly Participant[], names: Names): string {
  const lines = spoken(turns).flatMap((turn) => {
    const original = turn.original!;
    const header = `[${clock(turn.startedAt)}] ${speakerName(names, turn.speakerId)} (${original.languageName}): ${original.text}`;
    const translations = participants.flatMap((person) => {
      const translation = turn.translations[person.id];
      return translation
        ? [`    ${names[person.id]} heard (${languageName(translation.targetLanguage)}): ${translation.text}`]
        : [];
    });
    return [header, ...translations, ''];
  });
  return lines.join('\n');
}

export function transcriptSubtitles(turns: readonly Turn[], viewer: SpeakerId, names: Names): string {
  const kept = spoken(turns);
  const start = kept[0]?.startedAt ?? 0;
  return kept.map((turn, index) => {
    const text = turn.speakerId === viewer
      ? turn.original!.text
      : turn.translations[viewer]?.text ?? turn.original!.text;
    return [
      String(index + 1),
      `${srtTime(turn.startedAt - start)} --> ${srtTime(turn.endedAt - start)}`,
      `${speakerName(names, turn.speakerId)}: ${oneLine(text)}`,
      '',
    ].join('\n');
  }).join('\n');
}

export const MAX_ASSISTANT_LINES = 400;
export const MAX_ASSISTANT_LINE_LENGTH = 2000;

export function assistantTranscript(turns: readonly Turn[], names: Names): Array<{ speaker: string; text: string }> {
  return spoken(turns)
    .map((turn) => ({
      speaker: speakerName(names, turn.speakerId),
      text: oneLine(turn.original!.text).slice(0, MAX_ASSISTANT_LINE_LENGTH),
    }))
    .filter((line) => line.text)
    .slice(-MAX_ASSISTANT_LINES);
}
