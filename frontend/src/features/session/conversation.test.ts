import { describe, expect, it } from 'vitest';

import type { Participant, ServerMessage } from '../../services/protocol';
import { abandonPending, applyServerMessage, bubbleFor, MAX_TURNS, speakerName, speakerNames, type Turn } from './conversation';

const A: Participant = { id: 'A', name: 'Person 1', preferred_language: 'en' };
const B: Participant = { id: 'B', name: 'Person 2', preferred_language: 'te' };
const people = [A, B];

function play(messages: ServerMessage[], start: Turn[] = []): Turn[] {
  return messages.reduce((turns, message) => applyServerMessage(turns, message), start);
}

const received = (id: string): ServerMessage => ({
  type: 'utterance.received',
  seq: 1,
  utterance_id: id,
  speaker_id: null,
  duration_ms: 1300,
});

const transcript = (id: string, speaker: 'A' | 'B' | null, text = 'మీరు ఎలా ఉన్నారు?'): ServerMessage => ({
  type: 'transcript.final',
  seq: 2,
  utterance_id: id,
  speaker_id: speaker,
  text,
  language: 'te',
  language_name: 'Telugu',
});

const translation = (id: string, listener: 'A' | 'B', text: string): ServerMessage => ({
  type: 'translation.final',
  seq: 3,
  utterance_id: id,
  speaker_id: 'B',
  listener_id: listener,
  target_language: listener === 'A' ? 'en' : 'te',
  text,
});

describe('conversation store', () => {
  it('builds a turn from the server messages for one sentence', () => {
    const [turn] = play([received('u1'), transcript('u1', 'B'), translation('u1', 'A', 'How are you?')]);

    expect(turn).toMatchObject({ utteranceId: 'u1', speakerId: 'B', status: 'done' });
    expect(bubbleFor(turn!, people)).toEqual({
      kind: 'spoken',
      side: 'B',
      text: 'మీరు ఎలా ఉన్నారు?',
      languageName: 'Telugu',
      translations: [{ listenerId: 'A', text: 'How are you?' }],
      translating: false,
    });
  });

  it('keeps turns in the order received and ignores duplicates', () => {
    const turns = play([received('u1'), received('u2'), received('u1')]);

    expect(turns.map((turn) => turn.utteranceId)).toEqual(['u1', 'u2']);
  });

  it('removes a sentence with no words', () => {
    const turns = play([received('u1'), received('u2'), { type: 'utterance.ignored', seq: 3, utterance_id: 'u1' }]);

    expect(turns.map((turn) => turn.utteranceId)).toEqual(['u2']);
  });

  it('shows a third language translated for both people when nobody is the speaker', () => {
    const turn = play([
      received('u1'),
      transcript('u1', null, 'नमस्ते'),
      translation('u1', 'A', 'Hello'),
      translation('u1', 'B', 'నమస్కారం'),
    ])[0]!;

    expect(bubbleFor(turn, people)).toMatchObject({
      side: null,
      translations: [
        { listenerId: 'A', text: 'Hello' },
        { listenerId: 'B', text: 'నమస్కారం' },
      ],
      translating: false,
    });
  });

  it('shows only the words when both people chose the language spoken', () => {
    const turn = play([received('u1'), transcript('u1', null)])[0]!;

    expect(bubbleFor(turn, people)).toMatchObject({ kind: 'spoken', translations: [], translating: false });
  });

  it('marks a failed sentence but not one whose voice failed', () => {
    const failed = play([
      received('u1'),
      { type: 'error', seq: 2, code: 'provider_unavailable', message: 'Try again.', retryable: true, utterance_id: 'u1', listener_id: null },
    ])[0]!;
    const voiced = play([
      received('u2'),
      transcript('u2', 'B'),
      { type: 'error', seq: 3, code: 'voice_unavailable', message: 'No voice.', retryable: false, utterance_id: 'u2', listener_id: 'A' },
    ])[0]!;

    expect(bubbleFor(failed, people)).toEqual({ kind: 'failed', side: null, error: 'Try again.' });
    expect(voiced.status).toBe('done');
  });

  it('shows a sentence as pending until its transcript arrives', () => {
    expect(bubbleFor(play([received('u1')])[0]!, people)).toEqual({ kind: 'pending', side: null });
  });

  it('shows the words while the translation is still coming', () => {
    const turn = play([received('u1'), transcript('u1', 'B')])[0]!;

    expect(bubbleFor(turn, people)).toMatchObject({ kind: 'spoken', side: 'B', translations: [], translating: true });
  });

  it('ignores messages for sentences it never received', () => {
    expect(play([transcript('missing', 'A')])).toEqual([]);
  });

  it('keeps only the most recent turns', () => {
    const many = Array.from({ length: MAX_TURNS + 5 }, (_, index) => received(`u${index}`));

    const turns = play(many);

    expect(turns).toHaveLength(MAX_TURNS);
    expect(turns[0]!.utteranceId).toBe('u5');
  });

  it('marks sentences that were still being translated as failed when the connection drops', () => {
    const turns = play([received('u1'), transcript('u1', 'A'), received('u2')]);

    const after = abandonPending(turns, 'The connection dropped.');

    expect(after.map((turn) => [turn.status, turn.error])).toEqual([['done', undefined], ['failed', 'The connection dropped.']]);
  });

  it('leaves the other person\'s pending sentences alone when asked', () => {
    const theirs: ServerMessage = { type: 'utterance.received', seq: 1, utterance_id: 'u2', speaker_id: 'B', duration_ms: 900 };
    const turns = play([received('u1'), theirs]);

    const after = abandonPending(turns, 'Dropped.', (turn) => turn.speakerId !== 'B');

    expect(after.map((turn) => turn.status)).toEqual(['failed', 'processing']);
  });

  it('names the speakers for each kind of conversation', () => {
    const nobody = { C: 'Someone', D: 'Someone', E: 'Someone', F: 'Someone' };
    expect(speakerNames('together', people, null)).toEqual({ A: 'Person 1', B: 'Person 2', ...nobody });
    expect(speakerNames('remote', people, 'B')).toEqual({ A: 'Person 1', B: 'You', ...nobody });
    expect(speakerNames('call', [A], 'A')).toEqual({ A: 'You', B: 'Meeting', ...nobody });
    expect(speakerName(speakerNames('call', [A], 'A'), null)).toBe('Someone');
  });

  it('names everyone in a call of several people, and a blank name by place', () => {
    const many = [
      { id: 'A' as const, name: 'Ravi', preferred_language: 'te' },
      { id: 'C' as const, name: 'Mei', preferred_language: 'zh' },
      { id: 'D' as const, name: ' ', preferred_language: 'hi' },
    ];
    expect(speakerNames('remote', many, 'C')).toMatchObject({ A: 'Ravi', B: 'Someone', C: 'You', D: 'Person 4' });
  });
});
