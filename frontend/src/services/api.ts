import { getBackendUrl } from '../config';
import { savedHostKey } from './hostKey';
import {
  isParticipant,
  isSessionMode,
  isSpeakerId,
  type SpeakerId,
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

export interface RoomAccess {
  roomId: string;
  token: string;
}

function roomHeaders(room: RoomAccess | undefined): Record<string, string> {
  return room ? { 'X-Room-Id': room.roomId, 'X-Room-Token': room.token } : {};
}

async function requestJson<T>(path: string, init: RequestInit = {}, hostKey = savedHostKey()): Promise<T> {
  const headers = new Headers(init.headers);
  if (hostKey && !headers.has('X-Host-Key')) {
    headers.set('X-Host-Key', hostKey);
  }
  const response = await fetch(`${getBackendUrl()}${path}`, { ...init, headers });
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

export async function isHost(hostKey?: string): Promise<boolean> {
  const body = await requestJson<unknown>('/api/access', {}, hostKey);
  if (!isRecord(body) || typeof body.host !== 'boolean') {
    throw new Error('The backend returned an invalid access answer.');
  }
  return body.host;
}

export interface DetectedLanguage {
  language: string;
}

export async function detectLanguage(wav: ArrayBuffer, room?: RoomAccess): Promise<DetectedLanguage> {
  const body = await requestJson<unknown>('/api/languages/detect', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav', ...roomHeaders(room) },
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
    !body.participants.every(isParticipant) ||
    body.participants.map((person) => person.id).join() !== (body.mode === 'call' ? 'A' : 'A,B')
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
  guests: Participant[];
  max_people: number;
}

export interface CreatedRoom extends RoomInfo {
  host_token: string;
  invite_token: string;
  public_url: string | null;
  public_url_problem: string | null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function readRoom(body: unknown): RoomInfo {
  if (
    !isRecord(body) ||
    typeof body.room_id !== 'string' ||
    !isParticipant(body.host) ||
    body.host.id !== 'A' ||
    !Array.isArray(body.guests) ||
    !body.guests.every((guest) => isParticipant(guest) && guest.id !== 'A') ||
    typeof body.max_people !== 'number'
  ) {
    throw new Error('The backend returned an invalid conversation.');
  }
  return { room_id: body.room_id, host: body.host, guests: body.guests, max_people: body.max_people };
}

export async function createRoom(host: PersonDetails): Promise<CreatedRoom> {
  const body = await requestJson<unknown>('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consent: true, host }),
  });
  const room = readRoom(body);
  if (!isRecord(body) || typeof body.host_token !== 'string' || typeof body.invite_token !== 'string') {
    throw new Error('The backend returned an invalid conversation.');
  }
  return {
    ...room,
    host_token: body.host_token,
    invite_token: body.invite_token,
    public_url: textOrNull(body.public_url),
    public_url_problem: textOrNull(body.public_url_problem),
  };
}

export async function getRoom(roomId: string, token: string): Promise<RoomInfo> {
  return readRoom(await requestJson<unknown>(`/api/rooms/${encodeURIComponent(roomId)}`, {
    headers: { 'X-Room-Token': token },
  }));
}

export async function leaveRoom(roomId: string, token: string): Promise<void> {
  const response = await fetch(`${getBackendUrl()}/api/rooms/${encodeURIComponent(roomId)}`, {
    method: 'DELETE',
    headers: { 'X-Room-Token': token },
  });
  if (!response.ok && response.status !== 404) {
    throw new ApiError(response.status, 'The conversation could not be ended.');
  }
}

export async function joinRoom(
  roomId: string,
  inviteToken: string,
  guest: PersonDetails,
): Promise<{ room: RoomInfo; token: string; you: SpeakerId }> {
  const body = await requestJson<unknown>(`/api/rooms/${encodeURIComponent(roomId)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consent: true, token: inviteToken, guest }),
  });
  const room = readRoom(body);
  if (!isRecord(body) || typeof body.token !== 'string' || !isSpeakerId(body.you) || body.you === 'A') {
    throw new Error('The backend returned an invalid conversation.');
  }
  return { room, token: body.token, you: body.you };
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

export async function getVoices(room?: RoomAccess): Promise<VoiceOption[]> {
  const body = await requestJson<unknown>('/api/voices', { headers: roomHeaders(room) });
  if (!isRecord(body) || !Array.isArray(body.voices)) {
    throw new Error('The backend returned an invalid voice list.');
  }
  return body.voices.map(readVoice).filter((voice): voice is VoiceOption => voice !== null);
}

export interface SaidLine {
  speaker: string;
  text: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AgentAction {
  name: string;
  arguments: Record<string, string>;
}

export interface Source {
  title: string;
  url: string;
}

export interface AssistantReply {
  answer: string;
  actions: AgentAction[];
  sources: Source[];
}

export interface AssistantRequest {
  messages: ChatTurn[];
  language: string;
  transcript: SaidLine[];
  actions: string[];
}

function readAction(value: unknown): AgentAction | null {
  if (!isRecord(value) || typeof value.name !== 'string' || !isRecord(value.arguments)) {
    return null;
  }
  const entries = Object.entries(value.arguments).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return { name: value.name, arguments: Object.fromEntries(entries) };
}

function readSource(value: unknown): Source | null {
  if (!isRecord(value) || typeof value.title !== 'string' || typeof value.url !== 'string' || !value.url.startsWith('https://')) {
    return null;
  }
  return { title: value.title, url: value.url };
}

export async function askAssistant(request: AssistantRequest, room?: RoomAccess): Promise<AssistantReply> {
  const body = await requestJson<unknown>('/api/assistant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...roomHeaders(room) },
    body: JSON.stringify(request),
  });
  if (!isRecord(body) || typeof body.answer !== 'string' || !Array.isArray(body.actions) || !Array.isArray(body.sources)) {
    throw new Error('The assistant gave no answer. Please ask again.');
  }
  return {
    answer: body.answer.trim(),
    actions: body.actions.map(readAction).filter((action): action is AgentAction => action !== null),
    sources: body.sources.map(readSource).filter((source): source is Source => source !== null),
  };
}
