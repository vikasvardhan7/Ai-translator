export type SpeakerId = 'A' | 'B';

export interface Participant {
  id: SpeakerId;
  name: string;
  preferred_language: string;
}

export interface PingMessage {
  type: 'ping';
}

export interface SessionStopMessage {
  type: 'session.stop';
}

export interface UtteranceStartMessage {
  type: 'utterance.start';
  utterance_id: string;
  speaker_id: SpeakerId;
  spoken_language: string | null;
}

export interface UtteranceEndMessage {
  type: 'utterance.end';
  utterance_id: string;
}

export type BrowserMessage =
  | PingMessage
  | SessionStopMessage
  | UtteranceStartMessage
  | UtteranceEndMessage;

export interface SessionReadyMessage {
  type: 'session.ready';
  seq: number;
  session_id: string;
  participants: Participant[];
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
}

export interface UtteranceReceivedMessage {
  type: 'utterance.received';
  seq: number;
  utterance_id: string;
  speaker_id: SpeakerId;
  duration_ms: number;
}

export interface TranscriptFinalMessage {
  type: 'transcript.final';
  seq: number;
  utterance_id: string;
  speaker_id: SpeakerId;
  text: string;
  language: string;
  language_name: string;
}

export interface TranslationFinalMessage {
  type: 'translation.final';
  seq: number;
  utterance_id: string;
  speaker_id: SpeakerId;
  listener_id: SpeakerId;
  target_language: string;
  text: string;
  translated: boolean;
}

export interface TtsAudioMessage {
  type: 'tts.audio';
  seq: number;
  utterance_id: string;
  listener_id: SpeakerId;
  format: 'mp3' | 'wav';
  audio_base64: string;
}

export interface TranscriptPartialMessage {
  type: 'transcript.partial';
  seq: number;
  utterance_id: string;
  speaker_id: SpeakerId;
  text: string;
}

export type ServerMessage =
  | SessionReadyMessage
  | PongMessage
  | ServerErrorMessage
  | UtteranceReceivedMessage
  | TranscriptFinalMessage
  | TranslationFinalMessage
  | TtsAudioMessage
  | TranscriptPartialMessage;

export interface CreateSessionRequest {
  consent: boolean;
  participants: Participant[];
}

export interface CreateSessionResponse {
  session_id: string;
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

function isParticipant(value: unknown): value is Participant {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isSpeakerId(value.id) &&
    isString(value.name) &&
    isString(value.preferred_language)
  );
}

function hasSequence(value: Record<string, unknown>): value is Record<string, unknown> & { seq: number } {
  return Number.isInteger(value.seq) && typeof value.seq === 'number' && value.seq > 0;
}

/** Parses a server text frame and ignores malformed or unknown message types. */
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

  switch (parsed.type) {
    case 'session.ready':
      if (
        isString(parsed.session_id) &&
        Array.isArray(parsed.participants) &&
        parsed.participants.every(isParticipant)
      ) {
        return {
          type: 'session.ready',
          seq: parsed.seq,
          session_id: parsed.session_id,
          participants: parsed.participants,
        };
      }
      return null;
    case 'pong':
      return { type: 'pong', seq: parsed.seq };
    case 'error':
      if (
        isString(parsed.code) &&
        isString(parsed.message) &&
        typeof parsed.retryable === 'boolean' &&
        (parsed.utterance_id === null || isString(parsed.utterance_id))
      ) {
        return {
          type: 'error',
          seq: parsed.seq,
          code: parsed.code,
          message: parsed.message,
          retryable: parsed.retryable,
          utterance_id: parsed.utterance_id,
        };
      }
      return null;
    case 'utterance.received':
      if (
        isString(parsed.utterance_id) &&
        isSpeakerId(parsed.speaker_id) &&
        typeof parsed.duration_ms === 'number' &&
        Number.isFinite(parsed.duration_ms)
      ) {
        return {
          type: 'utterance.received',
          seq: parsed.seq,
          utterance_id: parsed.utterance_id,
          speaker_id: parsed.speaker_id,
          duration_ms: parsed.duration_ms,
        };
      }
      return null;
    case 'transcript.final':
      if (
        isString(parsed.utterance_id) &&
        isSpeakerId(parsed.speaker_id) &&
        isString(parsed.text) &&
        isString(parsed.language) &&
        isString(parsed.language_name)
      ) {
        return {
          type: 'transcript.final',
          seq: parsed.seq,
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
        isSpeakerId(parsed.speaker_id) &&
        isSpeakerId(parsed.listener_id) &&
        isString(parsed.target_language) &&
        isString(parsed.text) &&
        typeof parsed.translated === 'boolean'
      ) {
        return {
          type: 'translation.final',
          seq: parsed.seq,
          utterance_id: parsed.utterance_id,
          speaker_id: parsed.speaker_id,
          listener_id: parsed.listener_id,
          target_language: parsed.target_language,
          text: parsed.text,
          translated: parsed.translated,
        };
      }
      return null;
    case 'tts.audio':
      if (
        isString(parsed.utterance_id) &&
        isSpeakerId(parsed.listener_id) &&
        (parsed.format === 'mp3' || parsed.format === 'wav') &&
        isString(parsed.audio_base64)
      ) {
        return {
          type: 'tts.audio',
          seq: parsed.seq,
          utterance_id: parsed.utterance_id,
          listener_id: parsed.listener_id,
          format: parsed.format,
          audio_base64: parsed.audio_base64,
        };
      }
      return null;
    case 'transcript.partial':
      if (
        isString(parsed.utterance_id) &&
        isSpeakerId(parsed.speaker_id) &&
        isString(parsed.text)
      ) {
        return {
          type: 'transcript.partial',
          seq: parsed.seq,
          utterance_id: parsed.utterance_id,
          speaker_id: parsed.speaker_id,
          text: parsed.text,
        };
      }
      return null;
    default:
      return null;
  }
}
