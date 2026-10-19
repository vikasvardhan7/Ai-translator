import { describe, expect, it } from 'vitest';

import type { Participant } from '../../services/protocol';
import { applyServerMessage, speakerNames, type Turn } from './conversation';
import { MAX_ASSISTANT_LINES, assistantTranscript, transcriptSubtitles, transcriptText } from './transcript';

const people: Participant[] = [
  { id: 'A', name: 'Person 1', preferred_language: 'en' },
  { id: 'B', name: 'Person 2', preferred_language: 'te' },
];
const names = speakerNames('together', people, null);

function sentence(turns: Turn[], id: string, at: number): Turn[] {
  let next = applyServerMessage(turns, { type: 'utterance.received', seq: 1, utterance_id: id, speaker_id: 'B', duration_ms: 2_000 }, at);
  next = applyServerMessage(next, {
    type: 'transcript.final',
    seq: 2,
    utterance_id: id,
    speaker_id: 'B',
    text: 'మీరు ఎలా ఉన్నారు?',
    language: 'te',
    language_name: 'Telugu',
  }, at);
  return applyServerMessage(next, {
    type: 'translation.final',
    seq: 3,
    utterance_id: id,
    speaker_id: 'B',
    listener_id: 'A',
    target_language: 'en',
    text: 'How are you?',
  }, at);
}

describe('transcript downloads', () => {
  const turns = sentence(sentence([], 'u1', 10_000), 'u2', 15_500);

  it('writes both languages as plain text', () => {
    const text = transcriptText(turns, people, names);

    expect(text).toContain('Person 2 (Telugu): మీరు ఎలా ఉన్నారు?');
    expect(text).toContain('Person 1 heard (English): How are you?');
  });

  it('writes subtitles in the viewer\'s language with times from the first sentence', () => {
    expect(transcriptSubtitles(turns, 'A', names)).toBe([
      '1',
      '00:00:00,000 --> 00:00:02,000',
      'Person 2: How are you?',
      '',
      '2',
      '00:00:05,500 --> 00:00:07,500',
      'Person 2: How are you?',
      '',
    ].join('\n'));
    expect(transcriptSubtitles(turns, 'B', names)).toContain('Person 2: మీరు ఎలా ఉన్నారు?');
  });

  it('keeps each subtitle on one line so players do not cut it short', () => {
    const broken = applyServerMessage(
      applyServerMessage([], { type: 'utterance.received', seq: 1, utterance_id: 'u9', speaker_id: 'A', duration_ms: 1_000 }, 1_000),
      { type: 'transcript.final', seq: 2, utterance_id: 'u9', speaker_id: 'A', text: 'One\n\nTwo', language: 'en', language_name: 'English' },
      1_000,
    );

    expect(transcriptSubtitles(broken, 'A', names)).toContain('Person 1: One Two\n');
  });

  it('names the meeting and the person using the app in a meeting transcript', () => {
    const me = people.slice(0, 1);
    const text = transcriptText(turns, me, speakerNames('call', me, 'A'));

    expect(text).toContain('Meeting (Telugu): మీరు ఎలా ఉన్నారు?');
    expect(text).toContain('You heard (English): How are you?');
  });
});

describe('transcript for the assistant', () => {
  it('gives each finished sentence with who said it, on one line', () => {
    let turns = sentence([], 'u1', 10_000);
    turns = applyServerMessage(turns, { type: 'utterance.received', seq: 4, utterance_id: 'u2', speaker_id: 'A', duration_ms: 1_000 }, 11_000);

    expect(assistantTranscript(turns, names)).toEqual([{ speaker: 'Person 2', text: 'మీరు ఎలా ఉన్నారు?' }]);
  });

  it('keeps only the latest sentences', () => {
    let turns: Turn[] = [];
    for (let index = 0; index < MAX_ASSISTANT_LINES + 5; index += 1) {
      turns = sentence(turns, `u${index}`, index * 1_000);
    }

    expect(assistantTranscript(turns, names)).toHaveLength(Math.min(turns.length, MAX_ASSISTANT_LINES));
  });
});
