import { describe, expect, it } from 'vitest';

import type { Participant, ServerMessage } from '../../services/protocol';
import { applyServerMessage, MAX_TURNS, viewFor, type Turn } from './conversation';

const A: Participant = { id: 'A', name: 'Asha', preferred_language: 'en' };
const B: Participant = { id: 'B', name: 'Bala', preferred_language: 'te' };

function play(messages: ServerMessage[], start: Turn[] = []): Turn[] {
  return messages.reduce(applyServerMessage, start);
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
    expect(viewFor(turn!, A)).toEqual({
      kind: 'translated',
      text: 'How are you?',
      original: 'మీరు ఎలా ఉన్నారు?',
      languageName: 'Telugu',
    });
    expect(viewFor(turn!, B)).toEqual({ kind: 'own', text: 'మీరు ఎలా ఉన్నారు?', languageName: 'Telugu' });
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

    expect(viewFor(turn, A)).toMatchObject({ kind: 'translated', text: 'Hello' });
    expect(viewFor(turn, B)).toMatchObject({ kind: 'translated', text: 'నమస్కారం' });
  });

  it('shows the original to a person who chose the language spoken', () => {
    const turn = play([received('u1'), transcript('u1', null)])[0]!;

    expect(viewFor(turn, B)).toMatchObject({ kind: 'understood', text: 'మీరు ఎలా ఉన్నారు?' });
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

    expect(viewFor(failed, A)).toEqual({ kind: 'failed', error: 'Try again.' });
    expect(voiced.status).toBe('done');
  });

  it('shows a sentence as pending until its transcript arrives', () => {
    expect(viewFor(play([received('u1')])[0]!, A)).toEqual({ kind: 'pending' });
  });

  it('keeps the listener on pending until their translation arrives', () => {
    const turn = play([received('u1'), transcript('u1', 'B')])[0]!;

    expect(viewFor(turn, A)).toEqual({ kind: 'pending' });
    expect(viewFor(turn, B)).toMatchObject({ kind: 'own' });
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
});
