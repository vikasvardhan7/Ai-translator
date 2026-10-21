import type { Turn } from '../session/conversation';
import type { ChatLine, SpeakerId } from '../../services/protocol';

export interface CaptionLine {
  id: string;
  speakerId: SpeakerId | null;
  text: string;
  spokenIn: string | null;
  translated: boolean;
  waiting: boolean;
  at: number;
}

export interface LiveLine {
  speakerId: SpeakerId;
  text: string;
  sameLanguage: boolean;
}

export const CAPTION_LINES = 3;
export const CAPTION_KEEP_MS = 14_000;

export function baseLanguage(code: string): string {
  return code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

export function sameLanguage(one: string, two: string): boolean {
  return baseLanguage(one) !== '' && baseLanguage(one) === baseLanguage(two);
}

/** Every finished sentence as a caption in my language: my own words as said, others translated for me. */
export function captionLines(turns: readonly Turn[], me: SpeakerId, myLanguage: string): CaptionLine[] {
  return turns.flatMap((turn): CaptionLine[] => {
    if (turn.status !== 'done' || !turn.original) {
      return [];
    }
    const { original } = turn;
    const own = turn.speakerId === me;
    const mine = turn.translations[me];
    const alreadyMine = sameLanguage(original.language, myLanguage);
    if (own || alreadyMine || !mine) {
      return [{
        id: turn.utteranceId,
        speakerId: turn.speakerId,
        text: original.text,
        spokenIn: alreadyMine ? null : original.languageName,
        translated: false,
        waiting: !own && !alreadyMine,
        at: turn.endedAt,
      }];
    }
    return [{
      id: turn.utteranceId,
      speakerId: turn.speakerId,
      text: mine.text,
      spokenIn: original.languageName,
      translated: true,
      waiting: false,
      at: turn.endedAt,
    }];
  });
}

/** The few most recent captions still worth showing over the video. */
export function recentCaptions(lines: readonly CaptionLine[], now: number, count = CAPTION_LINES): CaptionLine[] {
  return lines.filter((line) => now - line.at <= CAPTION_KEEP_MS).slice(-count);
}

/** Messages from others after the last one seen (all of them when that one is no longer in the list). */
export function unreadCount(chat: readonly ChatLine[], seenId: string | null, me: SpeakerId): number {
  const after = seenId === null ? -1 : chat.findIndex((line) => line.id === seenId);
  return chat.slice(after + 1).filter((line) => line.from !== me).length;
}

export function chatTime(sentAt: string): string {
  const when = new Date(sentAt);
  return Number.isNaN(when.getTime()) ? '' : when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function letters(word: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word)].map((part) => part.segment);
  }
  return [...word];
}

/** One or two letters for a face with no camera; whole letters, so Indian scripts are not cut mid-letter. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return '?';
  }
  const picked = words.length === 1 ? letters(words[0]!).slice(0, 2) : [letters(words[0]!)[0], letters(words[words.length - 1]!)[0]];
  return picked.join('').toUpperCase();
}

export function clock(since: number | null, now: number): string {
  if (since === null) {
    return '0:00';
  }
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) {
    return names[0] ?? '';
  }
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
