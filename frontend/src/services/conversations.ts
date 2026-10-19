import type { CreatedRoom, RoomAccess, RoomInfo } from './api';
import type { ConversationMode, CreateSessionResponse, Participant, SpeakerId } from './protocol';

export interface InviteDetails {
  link: string;
  problem: string | null;
}

export interface Conversation {
  id: string;
  mode: ConversationMode;
  participants: Participant[];
  streamPath: string;
  you: SpeakerId | null;
  room: RoomAccess | null;
  invite: InviteDetails | null;
  maxPeople: number;
}

export interface Invite {
  roomId: string;
  token: string;
}

export function sessionConversation(session: CreateSessionResponse): Conversation {
  return {
    id: session.session_id,
    mode: session.mode,
    participants: session.participants,
    streamPath: `/api/sessions/${encodeURIComponent(session.session_id)}/stream`,
    you: session.mode === 'call' ? 'A' : null,
    room: null,
    invite: null,
    maxPeople: session.participants.length,
  };
}

export function roomConversation(
  room: RoomInfo,
  token: string,
  you: SpeakerId,
  invite: InviteDetails | null = null,
): Conversation {
  const query = new URLSearchParams({ token });
  return {
    id: `${room.room_id}:${you}`,
    mode: 'remote',
    participants: [room.host, ...room.guests],
    streamPath: `/api/rooms/${encodeURIComponent(room.room_id)}/stream?${query.toString()}`,
    you,
    room: { roomId: room.room_id, token },
    invite,
    maxPeople: room.max_people,
  };
}

export function inviteLink(room: CreatedRoom, origin: string): string {
  const base = (room.public_url ?? origin).replace(/\/+$/, '');
  return `${base}/#join/${encodeURIComponent(room.room_id)}/${encodeURIComponent(room.invite_token)}`;
}

export function inviteProblem(room: CreatedRoom, hostname: string): string | null {
  if (room.public_url || !isLocalOnly(hostname)) {
    return null;
  }
  return room.public_url_problem ?? 'This link only works on this computer.';
}

export function inviteFromHash(hash: string): Invite | null {
  const match = /^#join\/([^/]+)\/([^/]+)$/.exec(hash);
  if (!match) {
    return null;
  }
  try {
    return { roomId: decodeURIComponent(match[1]!), token: decodeURIComponent(match[2]!) };
  } catch {
    return null;
  }
}

function isLocalOnly(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost');
}
