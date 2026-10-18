export type SpeakerId = 'A' | 'B';
export type SessionMode = 'together' | 'call';

export interface Participant {
  id: SpeakerId;
  name: string;
  preferred_language: string;
}

export type BrowserMessage =
  | { type: 'ping' }
  | { type: 'audio.pause' }
  | { type: 'session.stop' };

export interface SessionReadyMessage {
  type: 'session.ready';
  seq: number;
  session_id: string;
  participants: Participant[];
  server_voice: boolean;
  mode: SessionMode;
}

export interface PongMessage {
  type: 'pong';
  seq: number;
}

export interface ServerErrorMessage {
  type: 'error';
  seq: number;
  code: string;
  message: string;
  retryable: boolean;
  utterance_id: string | null;
  listener_id: SpeakerId | null;
}

export interface UtteranceReceivedMessage {
  type: 'utterance.received';
  seq: number;
  utterance_id: string;
  speaker_id: SpeakerId | null;
  duration_ms: number;
}

export interface UtteranceIgnoredMessage {
  type: 'utterance.ignored';
  seq: number;
  utterance_id: string;
}

export interface TranscriptFinalMessage {
  type: 'transcript.final';
  seq: number;
  utterance_id: string;
  speaker_id: SpeakerId | null;
  text: string;
  language: string;
  language_name: string;
}

export interface TranslationFinalMessage {
  type: 'translation.final';
  seq: number;
  utterance_id: string;
  speaker_id: SpeakerId | null;
  listener_id: SpeakerId;
  target_language: string;
  text: string;
}

export interface TtsAudioMessage {
  type: 'tts.audio';
  seq: number;
  utterance_id: string;
  listener_id: SpeakerId;
  format: 'wav';
  audio_base64: string;
}

export type ServerMessage =
  | SessionReadyMessage
  | PongMessage
  | ServerErrorMessage
  | UtteranceReceivedMessage
  | UtteranceIgnoredMessage
  | TranscriptFinalMessage
  | TranslationFinalMessage
  | TtsAudioMessage;

export interface CreateSessionRequest {
  consent: boolean;
  mode: SessionMode;
  participants: Participant[];
}

export interface CreateSessionResponse {
  session_id: string;
  mode: SessionMode;
  participants: Participant[];
  created_at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isSpeakerId(value: unknown): value is SpeakerId {
  return value === 'A' || value === 'B';
}

function isSpeakerOrNull(value: unknown): value is SpeakerId | null {
  return value === null || isSpeakerId(value);
}

export function isSessionMode(value: unknown): value is SessionMode {
  return value === 'together' || value === 'call';
}

export function isParticipant(value: unknown): value is Participant {
  return (
    isRecord(value) &&
    isSpeakerId(value.id) &&
    isString(value.name) &&
    isString(value.preferred_language)
  );
}

function hasSequence(value: Record<string, unknown>): value is Record<string, unknown> & { seq: number } {
  return typeof value.seq === 'number' && Number.isInteger(value.seq) && value.seq > 0;
}

function parseKnown(parsed: Record<string, unknown> & { seq: number }): ServerMessage | null {
  const { seq } = parsed;
  switch (parsed.type) {
    case 'session.ready':
      if (
        isString(parsed.session_id) &&
        Array.isArray(parsed.participants) &&
        parsed.participants.every(isParticipant) &&
        typeof parsed.server_voice === 'boolean' &&
        isSessionMode(parsed.mode)
      ) {
        return {
          type: 'session.ready',
          seq,
          session_id: parsed.session_id,
          participants: parsed.participants,
          server_voice: parsed.server_voice,
          mode: parsed.mode,
        };
      }
      return null;
    case 'pong':
      return { type: 'pong', seq };
    case 'error':
      if (
        isString(parsed.code) &&
        isString(parsed.message) &&
        typeof parsed.retryable === 'boolean' &&
        (parsed.utterance_id === null || isString(parsed.utterance_id))
      ) {
        return {
          type: 'error',
          seq,
          code: parsed.code,
          message: parsed.message,
          retryable: parsed.retryable,
          utterance_id: parsed.utterance_id,
          listener_id: isSpeakerId(parsed.listener_id) ? parsed.listener_id : null,
        };
      }
      return null;
    case 'utterance.received':
      if (
        isString(parsed.utterance_id) &&
        isSpeakerOrNull(parsed.speaker_id) &&
        typeof parsed.duration_ms === 'number' &&
        Number.isFinite(parsed.duration_ms)
      ) {
        return {
          type: 'utterance.received',
          seq,
          utterance_id: parsed.utterance_id,
          speaker_id: parsed.speaker_id,
          duration_ms: parsed.duration_ms,
        };
      }
      return null;
    case 'utterance.ignored':
      if (isString(parsed.utterance_id)) {
        return { type: 'utterance.ignored', seq, utterance_id: parsed.utterance_id };
      }
      return null;
    case 'transcript.final':
      if (
        isString(parsed.utterance_id) &&
        isSpeakerOrNull(parsed.speaker_id) &&
        isString(parsed.text) &&
        isString(parsed.language) &&
        isString(parsed.language_name)
      ) {
        return {
          type: 'transcript.final',
          seq,
          utterance_id: parsed.utterance_id,
          speaker_id: parsed.speaker_id,
          text: parsed.text,
          language: parsed.language,
          language_name: parsed.language_name,
        };
      }
      return null;
    case 'translation.final':
      if (
        isString(parsed.utterance_id) &&
        isSpeakerOrNull(parsed.speaker_id) &&
        isSpeakerId(parsed.listener_id) &&
        isString(parsed.target_language) &&
        isString(parsed.text)
      ) {
        return {
          type: 'translation.final',
          seq,
          utterance_id: parsed.utterance_id,
          speaker_id: parsed.speaker_id,
          listener_id: parsed.listener_id,
          target_language: parsed.target_language,
          text: parsed.text,
        };
      }
      return null;
    case 'tts.audio':
      if (
        isString(parsed.utterance_id) &&
        isSpeakerId(parsed.listener_id) &&
        parsed.format === 'wav' &&
        isString(parsed.audio_base64)
      ) {
        return {
          type: 'tts.audio',
          seq,
          utterance_id: parsed.utterance_id,
          listener_id: parsed.listener_id,
          format: 'wav',
          audio_base64: parsed.audio_base64,
        };
      }
      return null;
    default:
      return null;
  }
}

export function parseServerMessage(raw: string): ServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !hasSequence(parsed) || !isString(parsed.type)) {
    return null;
  }
  return parseKnown(parsed);
}
