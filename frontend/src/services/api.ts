import { getBackendUrl } from '../config';
import { requestApiKey } from './apiKey';
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

export interface MeetingAccess {
  meetingId: string;
  token: string;
}

function roomHeaders(room: RoomAccess | undefined): Record<string, string> {
  return room ? { 'X-Room-Id': room.roomId, 'X-Room-Token': room.token } : {};
}

function accessHeaders(access: RoomAccess | MeetingAccess | undefined): Record<string, string> {
  if (access && 'meetingId' in access) {
    return { 'X-Meeting-Id': access.meetingId, 'X-Meeting-Token': access.token };
  }
  return roomHeaders(access);
}

async function requestJson<T>(path: string, init: RequestInit = {}, hostKey = savedHostKey()): Promise<T> {
  const headers = new Headers(init.headers);
  const apiKey = requestApiKey();
  if (apiKey) {
    headers.set('X-Api-Key', apiKey);
  } else if (hostKey && !headers.has('X-Host-Key')) {
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

export async function detectLanguage(wav: ArrayBuffer, access?: RoomAccess | MeetingAccess): Promise<DetectedLanguage> {
  const body = await requestJson<unknown>('/api/languages/detect', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav', ...accessHeaders(access) },
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
  return readCreatedRoom(await requestJson<unknown>('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consent: true, host }),
  }));
}

function readCreatedRoom(body: unknown): CreatedRoom {
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
  return readJoined(await requestJson<unknown>(`/api/rooms/${encodeURIComponent(roomId)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consent: true, token: inviteToken, guest }),
  }));
}

function readJoined(body: unknown): { room: RoomInfo; token: string; you: SpeakerId } {
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
  now: string;
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

export type MeetingStatus = 'upcoming' | 'live' | 'ended';

export interface MeetingInfo {
  id: string;
  title: string;
  starts_at: string;
  duration_minutes: number;
  agenda: string;
  host_name: string;
  status: MeetingStatus;
  people: number;
}

export interface HostedMeeting extends MeetingInfo {
  host_token: string;
  invite_token: string;
}

export interface MeetingPlan {
  title: string;
  starts_at: string;
  duration_minutes: number;
  agenda: string;
  host_name: string;
}

export interface PublicLink {
  public_url: string | null;
  public_url_problem: string | null;
}

function isStatus(value: unknown): value is MeetingStatus {
  return value === 'upcoming' || value === 'live' || value === 'ended';
}

function readMeeting(value: unknown): MeetingInfo {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.starts_at !== 'string' ||
    Number.isNaN(Date.parse(value.starts_at)) ||
    typeof value.duration_minutes !== 'number' ||
    typeof value.agenda !== 'string' ||
    typeof value.host_name !== 'string' ||
    !isStatus(value.status) ||
    typeof value.people !== 'number'
  ) {
    throw new Error('The backend returned an invalid meeting.');
  }
  return {
    id: value.id,
    title: value.title,
    starts_at: value.starts_at,
    duration_minutes: value.duration_minutes,
    agenda: value.agenda,
    host_name: value.host_name,
    status: value.status,
    people: value.people,
  };
}

function readHosted(value: unknown): HostedMeeting {
  const meeting = readMeeting(value);
  if (!isRecord(value) || typeof value.host_token !== 'string' || typeof value.invite_token !== 'string') {
    throw new Error('The backend returned an invalid meeting.');
  }
  return { ...meeting, host_token: value.host_token, invite_token: value.invite_token };
}

function readLink(value: Record<string, unknown>): PublicLink {
  return { public_url: textOrNull(value.public_url), public_url_problem: textOrNull(value.public_url_problem) };
}

export async function scheduleMeeting(plan: MeetingPlan): Promise<HostedMeeting & PublicLink> {
  const body = await requestJson<unknown>('/api/meetings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(plan),
  });
  const meeting = readHosted(body);
  return { ...meeting, ...readLink(body as Record<string, unknown>) };
}

export async function listMeetings(): Promise<{ meetings: HostedMeeting[] } & PublicLink> {
  const body = await requestJson<unknown>('/api/meetings');
  if (!isRecord(body) || !Array.isArray(body.meetings)) {
    throw new Error('The backend returned an invalid meeting list.');
  }
  return { meetings: body.meetings.map(readHosted), ...readLink(body) };
}

export async function getMeeting(access: MeetingAccess): Promise<MeetingInfo> {
  return readMeeting(await requestJson<unknown>(`/api/meetings/${encodeURIComponent(access.meetingId)}`, {
    headers: { 'X-Meeting-Token': access.token },
  }));
}

export async function cancelMeeting(access: MeetingAccess): Promise<void> {
  const response = await fetch(`${getBackendUrl()}/api/meetings/${encodeURIComponent(access.meetingId)}`, {
    method: 'DELETE',
    headers: { 'X-Meeting-Token': access.token },
  });
  if (!response.ok && response.status !== 404) {
    throw new ApiError(response.status, 'The meeting could not be cancelled.');
  }
}

export async function startMeeting(access: MeetingAccess, host: PersonDetails): Promise<CreatedRoom> {
  return readCreatedRoom(await requestJson<unknown>(`/api/meetings/${encodeURIComponent(access.meetingId)}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Meeting-Token': access.token },
    body: JSON.stringify({ consent: true, host }),
  }));
}

export async function joinMeeting(
  access: MeetingAccess,
  guest: PersonDetails,
): Promise<{ room: RoomInfo; token: string; you: SpeakerId }> {
  return readJoined(await requestJson<unknown>(`/api/meetings/${encodeURIComponent(access.meetingId)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consent: true, token: access.token, guest }),
  }));
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  shown: string;
  daily_limit: number;
  used_today: number;
  created_at: string;
  last_used_at: string | null;
}

function readKey(value: unknown): ApiKeyInfo {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.shown !== 'string' ||
    typeof value.daily_limit !== 'number' ||
    typeof value.used_today !== 'number' ||
    typeof value.created_at !== 'string'
  ) {
    throw new Error('The backend returned an invalid key.');
  }
  return {
    id: value.id,
    name: value.name,
    shown: value.shown,
    daily_limit: value.daily_limit,
    used_today: value.used_today,
    created_at: value.created_at,
    last_used_at: textOrNull(value.last_used_at),
  };
}

export async function listKeys(): Promise<{ keys: ApiKeyInfo[] } & PublicLink> {
  const body = await requestJson<unknown>('/api/keys');
  if (!isRecord(body) || !Array.isArray(body.keys)) {
    throw new Error('The backend returned an invalid key list.');
  }
  return { keys: body.keys.map(readKey), ...readLink(body) };
}

export async function createKey(name: string, dailyLimit: number): Promise<{ key: ApiKeyInfo; secret: string }> {
  const body = await requestJson<unknown>('/api/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, daily_limit: dailyLimit }),
  });
  if (!isRecord(body) || typeof body.secret !== 'string') {
    throw new Error('The backend returned an invalid key.');
  }
  return { key: readKey(body.key), secret: body.secret };
}

export async function revokeKey(id: string): Promise<void> {
  await requestJson<unknown>(`/api/keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
