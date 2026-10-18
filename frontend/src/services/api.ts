import { getBackendUrl } from '../config';
import {
  isParticipant,
  isSessionMode,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type Participant,
  type SessionMode,
} from './protocol';

interface HealthResponse {
  status: 'ok';
  version: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getBackendUrl()}${path}`, init);
  const body = await readJson(response);

  if (!response.ok) {
    const detail = isRecord(body) && typeof body.detail === 'string'
      ? body.detail
      : `Request failed with status ${response.status}`;
    throw new ApiError(response.status, detail);
  }

  return body as T;
}

export async function getHealth(): Promise<HealthResponse> {
  const body = await requestJson<unknown>('/health');

  if (!isRecord(body) || body.status !== 'ok' || typeof body.version !== 'string') {
    throw new Error('The backend returned an invalid health response.');
  }

  return { status: 'ok', version: body.version };
}

export interface DetectedLanguage {
  language: string;
}

export async function detectLanguage(wav: ArrayBuffer): Promise<DetectedLanguage> {
  const body = await requestJson<unknown>('/api/languages/detect', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: wav,
  });

  if (
    !isRecord(body) ||
    typeof body.language !== 'string' ||
    !/^[a-z]{2,3}$/.test(body.language)
  ) {
    throw new Error('The backend returned an invalid language.');
  }

  return { language: body.language };
}

export async function createSession(
  participants: Participant[],
  consent: boolean,
  mode: SessionMode = 'together',
): Promise<CreateSessionResponse> {
  const payload: CreateSessionRequest = { consent, mode, participants };
  const body = await requestJson<unknown>('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (
    !isRecord(body) ||
    typeof body.session_id !== 'string' ||
    typeof body.created_at !== 'string' ||
    !isSessionMode(body.mode) ||
    !Array.isArray(body.participants) ||
    body.participants.length !== 2 ||
    !body.participants.every(isParticipant) ||
    body.participants[0]?.id !== 'A' ||
    body.participants[1]?.id !== 'B'
  ) {
    throw new Error('The backend returned an invalid session response.');
  }

  return {
    session_id: body.session_id,
    mode: body.mode,
    participants: body.participants,
    created_at: body.created_at,
  };
}

interface PersonDetails {
  name: string;
  preferred_language: string;
}

export interface RoomInfo {
  room_id: string;
  host: Participant;
  guest: Participant | null;
}

export interface CreatedRoom extends RoomInfo {
  host_token: string;
  guest_token: string;
}

function readRoom(body: unknown): RoomInfo {
  if (
    !isRecord(body) ||
    typeof body.room_id !== 'string' ||
    !isParticipant(body.host) ||
    body.host.id !== 'A' ||
    !(body.guest === null || (isParticipant(body.guest) && body.guest.id === 'B'))
  ) {
    throw new Error('The backend returned an invalid conversation.');
  }
  return { room_id: body.room_id, host: body.host, guest: body.guest };
}

export async function createRoom(host: PersonDetails): Promise<CreatedRoom> {
  const body = await requestJson<unknown>('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consent: true, host }),
  });
  const room = readRoom(body);
  if (!isRecord(body) || typeof body.host_token !== 'string' || typeof body.guest_token !== 'string') {
    throw new Error('The backend returned an invalid conversation.');
  }
  return { ...room, host_token: body.host_token, guest_token: body.guest_token };
}

export async function getRoom(roomId: string, token: string): Promise<RoomInfo> {
  return readRoom(await requestJson<unknown>(`/api/rooms/${encodeURIComponent(roomId)}`, {
    headers: { 'X-Room-Token': token },
  }));
}

export async function joinRoom(
  roomId: string,
  inviteToken: string,
  guest: PersonDetails,
): Promise<{ room: RoomInfo; token: string }> {
  const body = await requestJson<unknown>(`/api/rooms/${encodeURIComponent(roomId)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consent: true, token: inviteToken, guest }),
  });
  const room = readRoom(body);
  if (!isRecord(body) || typeof body.token !== 'string') {
    throw new Error('The backend returned an invalid conversation.');
  }
  return { room, token: body.token };
}

export interface VoiceOption {
  id: string;
  display_name: string;
  description: string;
  gender: string;
  language_code: string;
  pitch: string;
  accent: string;
}

function readVoice(value: unknown): VoiceOption | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) {
    return null;
  }
  const text = (key: string): string => (typeof value[key] === 'string' ? value[key] : '');
  return {
    id: value.id,
    display_name: text('display_name') || value.id,
    description: text('description'),
    gender: text('gender'),
    language_code: text('language_code'),
    pitch: text('pitch'),
    accent: text('accent'),
  };
}

export async function getVoices(): Promise<VoiceOption[]> {
  const body = await requestJson<unknown>('/api/voices');
  if (!isRecord(body) || !Array.isArray(body.voices)) {
    throw new Error('The backend returned an invalid voice list.');
  }
  return body.voices.map(readVoice).filter((voice): voice is VoiceOption => voice !== null);
}
