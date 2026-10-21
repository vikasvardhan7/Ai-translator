import { describe, expect, it } from 'vitest';

import type { Turn } from '../session/conversation';
import { captionLines, clock, initials, joinNames, recentCaptions, sameLanguage, unreadCount } from './captions';
import { recordingName, recordingType, tileLayout, wrapLines } from './recorder';

function turn(id: string, speakerId: 'A' | 'B' | 'C', language: string, text: string, translations: Turn['translations'] = {}, status: Turn['status'] = 'done'): Turn {
  return {
    utteranceId: id,
    speakerId,
    status,
    startedAt: 1_000,
    endedAt: 2_000,
    original: status === 'done' ? { text, language, languageName: { te: 'Telugu', hi: 'Hindi', en: 'English' }[language] ?? language } : undefined,
    translations,
  };
}

describe('captions in my language', () => {
  const turns: Turn[] = [
    turn('1', 'A', 'te', 'మీరు ఎలా ఉన్నారు?', { B: { targetLanguage: 'en', text: 'How are you?' } }),
    turn('2', 'B', 'en', 'Fine, thanks.', { A: { targetLanguage: 'te', text: 'బాగున్నాను.' } }),
    turn('3', 'C', 'en-IN', 'Me too.'),
    turn('4', 'C', 'hi', 'चलो शुरू करें।'),
    turn('5', 'C', 'hi', '', {}, 'processing'),
  ];

  it('shows my own words as said and everyone else translated for me', () => {
    expect(captionLines(turns, 'B', 'en')).toEqual([
      { id: '1', speakerId: 'A', text: 'How are you?', spokenIn: 'Telugu', translated: true, waiting: false, at: 2_000 },
      { id: '2', speakerId: 'B', text: 'Fine, thanks.', spokenIn: null, translated: false, waiting: false, at: 2_000 },
      { id: '3', speakerId: 'C', text: 'Me too.', spokenIn: null, translated: false, waiting: false, at: 2_000 },
      { id: '4', speakerId: 'C', text: 'चलो शुरू करें।', spokenIn: 'Hindi', translated: false, waiting: true, at: 2_000 },
    ]);
  });

  it('keeps only the newest lines from the last few seconds', () => {
    const lines = captionLines(turns, 'A', 'te');
    expect(recentCaptions(lines, 10_000, 2).map((line) => line.id)).toEqual(['3', '4']);
    expect(recentCaptions(lines, 60_000)).toEqual([]);
  });

  it('compares languages by their base code', () => {
    expect([sameLanguage('en-IN', 'en'), sameLanguage('te', 'tel'), sameLanguage('', '')]).toEqual([true, false, false]);
  });
});

describe('call details', () => {
  it('counts chat lines from others since the panel was last open', () => {
    const chat = [
      { id: '1', from: 'A' as const, name: 'Ravi', text: 'hi', sent_at: '' },
      { id: '2', from: 'B' as const, name: 'Priya', text: 'hello', sent_at: '' },
      { id: '3', from: 'A' as const, name: 'Ravi', text: 'ok', sent_at: '' },
    ];
    expect([unreadCount(chat, null, 'B'), unreadCount(chat, '2', 'B'), unreadCount(chat, '3', 'B'), unreadCount(chat, 'gone', 'B')]).toEqual([2, 1, 0, 2]);
  });

  it('shows names, initials and the call length plainly', () => {
    expect([initials('Ravi Kumar'), initials('priya'), initials('  '), initials('శ్రీనివాస్'), initials('राम कुमार')]).toEqual(['RK', 'PR', '?', 'శ్రీని', 'राकु']);
    expect([clock(null, 5_000), clock(0, 65_000), clock(0, 3_726_000)]).toEqual(['0:00', '1:05', '1:02:06']);
    expect([joinNames([]), joinNames(['you']), joinNames(['Ravi', 'Priya', 'you'])]).toEqual(['', 'you', 'Ravi, Priya and you']);
  });
});

describe('the recording', () => {
  const area = { x: 0, y: 0, width: 1000, height: 500 };

  it('lays out one, two, three or four people like the call', () => {
    expect(tileLayout(1, area)).toEqual([{ x: 0, y: 0, width: 1000, height: 500 }]);
    expect(tileLayout(2, area, 10).map((rect) => [rect.x, rect.width, rect.height])).toEqual([[0, 495, 500], [505, 495, 500]]);
    const three = tileLayout(3, area, 10);
    expect(three.map((rect) => [rect.x, rect.y])).toEqual([[0, 0], [505, 0], [252.5, 255]]);
    expect(tileLayout(4, area, 10)[3]).toEqual({ x: 505, y: 255, width: 495, height: 245 });
    expect(tileLayout(0, area)).toEqual([]);
  });

  it('wraps captions and keeps the newest lines', () => {
    const measure = (text: string): number => text.length * 10;
    expect(wrapLines('one two three four five', 100, measure, 5)).toEqual(['one two', 'three four', 'five']);
    expect(wrapLines('one two three four five', 100, measure, 2)).toEqual(['three four', 'five']);
    expect(wrapLines('   ', 100, measure)).toEqual([]);
  });

  it('picks a video type the browser can make and names the file by date', () => {
    expect(recordingType((type) => type === 'video/webm;codecs=vp8,opus')).toBe('video/webm;codecs=vp8,opus');
    expect(recordingType(() => false)).toBe('');
    expect(recordingName(new Date(2026, 9, 21, 9, 5))).toBe('meeting-2026-10-21-0905.webm');
    expect(recordingName(new Date(2026, 9, 21, 9, 5), 'video/mp4;codecs=avc1')).toBe('meeting-2026-10-21-0905.mp4');
  });
});
