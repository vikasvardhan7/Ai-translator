import { describe, expect, it } from 'vitest';

import { parseServerMessage } from './protocol';

const id = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function parse(message: Record<string, unknown>) {
  return parseServerMessage(JSON.stringify({ seq: 1, ...message }));
}

describe('parseServerMessage', () => {
  it('reads session.ready with the voice setting and mode', () => {
    expect(parse({
      type: 'session.ready',
      session_id: 'session-1',
      participants: [
        { id: 'A', name: 'Person A', preferred_language: 'en' },
        { id: 'B', name: 'Person B', preferred_language: 'te' },
      ],
      server_voice: true,
      mode: 'together',
    })).toMatchObject({ type: 'session.ready', server_voice: true, mode: 'together', connected: null });
  });

  it('reads a call across devices and people coming and going', () => {
    expect(parse({
      type: 'session.ready',
      session_id: 'room-1',
      participants: [
        { id: 'A', name: 'Person 1', preferred_language: 'te' },
        { id: 'B', name: 'Person 2', preferred_language: 'en' },
      ],
      server_voice: true,
      mode: 'remote',
      you: 'B',
      connected: ['B'],
    })).toMatchObject({ mode: 'remote', connected: ['B'] });
    for (const type of ['peer.connected', 'peer.disconnected', 'peer.left']) {
      expect(parse({ type, participant_id: 'A' })).toEqual({ type, seq: 1, participant_id: 'A' });
      expect(parse({ type, participant_id: 'F' })).toEqual({ type, seq: 1, participant_id: 'F' });
      expect(parse({ type, participant_id: 'G' })).toBeNull();
    }
    expect(parse({
      type: 'participants.updated',
      participants: [{ id: 'A', name: 'Person 1', preferred_language: 'hi' }],
    })).toMatchObject({ type: 'participants.updated', participants: [{ preferred_language: 'hi' }] });
  });

  it('accepts sentences whose speaker is not known yet', () => {
    expect(parse({ type: 'utterance.received', utterance_id: id, speaker_id: null, duration_ms: 1300 }))
      .toEqual({ type: 'utterance.received', seq: 1, utterance_id: id, speaker_id: null, duration_ms: 1300 });
    expect(parse({
      type: 'transcript.final',
      utterance_id: id,
      speaker_id: null,
      text: 'नमस्ते',
      language: 'hi',
      language_name: 'Hindi',
    })).toMatchObject({ type: 'transcript.final', speaker_id: null, voice: null });
  });

  it('reads the voice a sentence was matched to, and words still being spoken', () => {
    expect(parse({
      type: 'transcript.final',
      utterance_id: id,
      speaker_id: 'B',
      voice: '2',
      text: 'Hello',
      language: 'en',
      language_name: 'English',
    })).toMatchObject({ speaker_id: 'B', voice: '2' });
    expect(parse({ type: 'words.live', speaker_id: 'C', text: 'How are' }))
      .toEqual({ type: 'words.live', seq: 1, speaker_id: 'C', text: 'How are' });
    expect(parse({ type: 'words.live', speaker_id: 'Z', text: 'How are' })).toBeNull();
    expect(parse({ type: 'words.live', speaker_id: 'C', text: 5 })).toBeNull();
  });

  it('reads a translation exactly as the server sends it', () => {
    expect(parse({
      type: 'translation.final',
      utterance_id: id,
      speaker_id: 'B',
      listener_id: 'A',
      target_language: 'en',
      text: 'How are you?',
    })).toEqual({
      type: 'translation.final',
      seq: 1,
      utterance_id: id,
      speaker_id: 'B',
      listener_id: 'A',
      target_language: 'en',
      text: 'How are you?',
    });
  });

  it('reads when someone starts and stops speaking', () => {
    expect(parse({ type: 'speech.activity', speaker_id: null, active: true }))
      .toEqual({ type: 'speech.activity', seq: 1, speaker_id: null, active: true });
    expect(parse({ type: 'speech.activity', speaker_id: 'B', active: false }))
      .toMatchObject({ speaker_id: 'B', active: false });
    expect(parse({ type: 'speech.activity', speaker_id: null, active: 'yes' })).toBeNull();
  });

  it('reads ignored sentences, voices and voice failures', () => {
    expect(parse({ type: 'utterance.ignored', utterance_id: id })).toEqual({
      type: 'utterance.ignored',
      seq: 1,
      utterance_id: id,
    });
    expect(parse({ type: 'tts.audio', utterance_id: id, listener_id: 'A', format: 'wav', audio_base64: 'UklG' }))
      .toMatchObject({ type: 'tts.audio', listener_id: 'A' });
    expect(parse({
      type: 'error',
      code: 'voice_unavailable',
      message: 'The free voice limit was reached.',
      retryable: false,
      utterance_id: id,
      listener_id: 'B',
    })).toMatchObject({ code: 'voice_unavailable', listener_id: 'B' });
  });

  it('reads what a meeting shares: chat, who is recording, microphones and cameras', () => {
    const line = { id: 'c1', from: 'B', name: 'Priya', text: 'नमस्ते', sent_at: '2026-10-21T10:00:00+00:00' };
    expect(parse({
      type: 'session.ready',
      session_id: 'room-1',
      participants: [{ id: 'A', name: 'Ravi', preferred_language: 'te' }],
      server_voice: false,
      mode: 'remote',
      you: 'A',
      connected: ['A'],
      chat: [line, { id: 'broken' }],
      recording: ['B', 'Z'],
      media: { A: { mic: false, camera: true }, B: { mic: 'yes', camera: true }, Q: { mic: true, camera: true } },
    })).toMatchObject({ chat: [line], recording: ['B'], media: { A: { mic: false, camera: true } } });
    expect(parse({ type: 'session.ready', session_id: 's', participants: [], server_voice: false, mode: 'together' }))
      .toMatchObject({ chat: [], recording: [], media: {} });
    expect(parse({ type: 'chat.message', ...line })).toEqual({ type: 'chat.message', seq: 1, ...line });
    expect(parse({ type: 'media.state', participant_id: 'C', mic: true, camera: false }))
      .toEqual({ type: 'media.state', seq: 1, participant_id: 'C', mic: true, camera: false });
    expect(parse({ type: 'recording.state', participant_id: 'D', on: true }))
      .toEqual({ type: 'recording.state', seq: 1, participant_id: 'D', on: true });
    expect(parse({ type: 'rtc.signal', from: 'A', data: { kind: 'offer', pc: 'k', sdp: 'v=0' } }))
      .toEqual({ type: 'rtc.signal', seq: 1, from: 'A', data: { kind: 'offer', pc: 'k', sdp: 'v=0' } });
  });

  it.each([
    ['chat without a sender', { type: 'chat.message', id: 'x', name: 'n', text: 't', sent_at: '' }],
    ['camera state that is not true or false', { type: 'media.state', participant_id: 'A', mic: true, camera: 'off' }],
    ['recording without on', { type: 'recording.state', participant_id: 'A' }],
    ['set-up without data', { type: 'rtc.signal', from: 'A', data: 'offer' }],
  ])('refuses %s', (_, message) => {
    expect(parse(message)).toBeNull();
  });

  it('gives errors without a listener a null listener', () => {
    expect(parse({ type: 'error', code: 'invalid_message', message: 'x', retryable: false, utterance_id: null }))
      .toMatchObject({ utterance_id: null, listener_id: null });
  });

  it.each([
    ['unknown type', { type: 'something.new' }],
    ['voice in another format', { type: 'tts.audio', utterance_id: id, listener_id: 'A', format: 'mp3', audio_base64: 'x' }],
    ['ready without a mode', { type: 'session.ready', session_id: 's', participants: [], server_voice: false }],
    ['error missing fields', { type: 'error', code: 'invalid_message' }],
  ])('refuses %s', (_, message) => {
    expect(parse(message)).toBeNull();
  });

  it('refuses broken JSON and missing sequence numbers', () => {
    expect(parseServerMessage('{')).toBeNull();
    expect(parseServerMessage('{"type":"pong"}')).toBeNull();
  });
});
