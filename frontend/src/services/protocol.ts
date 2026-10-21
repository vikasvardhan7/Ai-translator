export const SPEAKER_IDS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export type SpeakerId = (typeof SPEAKER_IDS)[number];
export type SessionMode = 'together' | 'call';
export type ConversationMode = SessionMode | 'remote';

export interface Participant {
  id: SpeakerId;
  name: string;
  preferred_language: string;
}

export type BrowserMessage =
  | { type: 'ping' }
  | { type: 'audio.pause'; participant_id?: SpeakerId }
  | { type: 'voice.settings'; listener_id: SpeakerId; server_voice: boolean; voice: string | null }
  | { type: 'language.set'; participant_id: SpeakerId; language: string }
  | { type: 'voice.played'; utterance_id: string; listener_id: SpeakerId; seconds: number }
  | { type: 'voice.fix'; utterance_id: string; voice: string }
  | { type: 'words.live'; text: string }
  | { type: 'rtc.signal'; to: SpeakerId; data: SignalData }
  | { type: 'chat.send'; text: string }
  | { type: 'media.state'; mic: boolean; camera: boolean }
  | { type: 'recording.set'; on: boolean }
  | { type: 'session.stop' };

export type SignalData = Record<string, unknown>;

export interface ChatLine {
  id: string;
  from: SpeakerId;
  name: string;
  text: string;
  sent_at: string;
}

export interface MediaState {
  mic: boolean;
  camera: boolean;
}

interface SessionReadyMessage {
  type: 'session.ready';
  seq: number;
  session_id: string;
  participants: Participant[];
  server_voice: boolean;
  mode: ConversationMode;
  connected: SpeakerId[] | null;
  chat: ChatLine[];
  recording: SpeakerId[];
  media: Partial<Record<SpeakerId, MediaState>>;
}

interface ParticipantsUpdatedMessage {
  type: 'participants.updated';
  seq: number;
  participants: Participant[];
}

interface PeerMessage {
  type: 'peer.connected' | 'peer.disconnected' | 'peer.left';
  seq: number;
  participant_id: SpeakerId;
}

interface PongMessage {
  type: 'pong';
  seq: number;
}

interface ServerErrorMessage {
  type: 'error';
  seq: number;
  code: string;
  message: string;
  retryable: boolean;
  utterance_id: string | null;
  listener_id: SpeakerId | null;
}

interface UtteranceReceivedMessage {
  type: 'utterance.received';
  seq: number;
  utterance_id: string;
  speaker_id: SpeakerId | null;
  duration_ms: number;
}

interface SpeechActivityMessage {
  type: 'speech.activity';
  seq: number;
  speaker_id: SpeakerId | null;
  active: boolean;
}

interface UtteranceIgnoredMessage {
  type: 'utterance.ignored';
  seq: number;
  utterance_id: string;
}

interface TranscriptFinalMessage {
  type: 'transcript.final';
  seq: number;
  utterance_id: string;
  speaker_id: SpeakerId | null;
  voice: string | null;
  text: string;
  language: string;
  language_name: string;
}

interface TranslationFinalMessage {
  type: 'translation.final';
  seq: number;
  utterance_id: string;
  speaker_id: SpeakerId | null;
  listener_id: SpeakerId;
  target_language: string;
  text: string;
}

interface WordsLiveMessage {
  type: 'words.live';
  seq: number;
  speaker_id: SpeakerId;
  text: string;
}

interface RtcSignalMessage {
  type: 'rtc.signal';
  seq: number;
  from: SpeakerId;
  data: SignalData;
}

interface ChatMessage extends ChatLine {
  type: 'chat.message';
  seq: number;
}

interface MediaStateMessage extends MediaState {
  type: 'media.state';
  seq: number;
  participant_id: SpeakerId;
}

interface RecordingStateMessage {
  type: 'recording.state';
  seq: number;
  participant_id: SpeakerId;
  on: boolean;
}

interface TtsAudioMessage {
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
  | PeerMessage
  | ParticipantsUpdatedMessage
  | ServerErrorMessage
  | UtteranceReceivedMessage
  | SpeechActivityMessage
  | UtteranceIgnoredMessage
  | TranscriptFinalMessage
  | TranslationFinalMessage
  | WordsLiveMessage
  | TtsAudioMessage
  | RtcSignalMessage
  | ChatMessage
  | MediaStateMessage
  | RecordingStateMessage;

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

export function isSpeakerId(value: unknown): value is SpeakerId {
  return typeof value === 'string' && (SPEAKER_IDS as readonly string[]).includes(value);
}

export function perSpeaker<T>(value: T): Record<SpeakerId, T> {
  return Object.fromEntries(SPEAKER_IDS.map((id) => [id, value])) as Record<SpeakerId, T>;
}

function isSpeakerOrNull(value: unknown): value is SpeakerId | null {
  return value === null || isSpeakerId(value);
}

export function isSessionMode(value: unknown): value is SessionMode {
  return value === 'together' || value === 'call';
}

function isConversationMode(value: unknown): value is ConversationMode {
  return isSessionMode(value) || value === 'remote';
}

export function isParticipant(value: unknown): value is Participant {
  return (
    isRecord(value) &&
    isSpeakerId(value.id) &&
    isString(value.name) &&
    isString(value.preferred_language)
  );
}

export function isChatLine(value: unknown): value is ChatLine {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isSpeakerId(value.from) &&
    isString(value.name) &&
    isString(value.text) &&
    isString(value.sent_at)
  );
}

function isMediaState(value: unknown): value is MediaState {
  return isRecord(value) && typeof value.mic === 'boolean' && typeof value.camera === 'boolean';
}

function mediaOf(value: unknown): Partial<Record<SpeakerId, MediaState>> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([id, state]) => isSpeakerId(id) && isMediaState(state))
      .map(([id, state]) => [id, { mic: (state as MediaState).mic, camera: (state as MediaState).camera }]),
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
        isConversationMode(parsed.mode)
      ) {
        return {
          type: 'session.ready',
          seq,
          session_id: parsed.session_id,
          participants: parsed.participants,
          server_voice: parsed.server_voice,
          mode: parsed.mode,
          connected: Array.isArray(parsed.connected) && parsed.connected.every(isSpeakerId) ? parsed.connected : null,
          chat: Array.isArray(parsed.chat) ? parsed.chat.filter(isChatLine) : [],
          recording: Array.isArray(parsed.recording) ? parsed.recording.filter(isSpeakerId) : [],
          media: mediaOf(parsed.media),
        };
      }
      return null;
    case 'participants.updated':
      if (Array.isArray(parsed.participants) && parsed.participants.every(isParticipant)) {
        return { type: 'participants.updated', seq, participants: parsed.participants };
      }
      return null;
    case 'peer.connected':
    case 'peer.disconnected':
    case 'peer.left':
      if (isSpeakerId(parsed.participant_id)) {
        return { type: parsed.type, seq, participant_id: parsed.participant_id };
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
    case 'speech.activity':
      if (isSpeakerOrNull(parsed.speaker_id) && typeof parsed.active === 'boolean') {
        return { type: 'speech.activity', seq, speaker_id: parsed.speaker_id, active: parsed.active };
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
          voice: isString(parsed.voice) ? parsed.voice : null,
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
    case 'words.live':
      if (isSpeakerId(parsed.speaker_id) && isString(parsed.text)) {
        return { type: 'words.live', seq, speaker_id: parsed.speaker_id, text: parsed.text };
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
    case 'rtc.signal':
      if (isSpeakerId(parsed.from) && isRecord(parsed.data)) {
        return { type: 'rtc.signal', seq, from: parsed.from, data: parsed.data };
      }
      return null;
    case 'chat.message':
      if (isChatLine(parsed)) {
        const { id, from, name, text, sent_at } = parsed;
        return { type: 'chat.message', seq, id, from, name, text, sent_at };
      }
      return null;
    case 'media.state':
      if (isSpeakerId(parsed.participant_id) && isMediaState(parsed)) {
        return { type: 'media.state', seq, participant_id: parsed.participant_id, mic: parsed.mic, camera: parsed.camera };
      }
      return null;
    case 'recording.state':
      if (isSpeakerId(parsed.participant_id) && typeof parsed.on === 'boolean') {
        return { type: 'recording.state', seq, participant_id: parsed.participant_id, on: parsed.on };
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
