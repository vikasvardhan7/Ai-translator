import type { CreatedRoom, RoomAccess, RoomInfo } from './api';
import type { ConversationMode, CreateSessionResponse, Participant, SpeakerId } from './protocol';

export interface Conversation {
  id: string;
  mode: ConversationMode;
  participants: Participant[];
  streamPath: string;
  you: SpeakerId | null;
  room: RoomAccess | null;
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
  };
}

export function roomConversation(room: RoomInfo, token: string, you: SpeakerId): Conversation {
  const query = new URLSearchParams({ token });
  return {
    id: `${room.room_id}:${you}`,
    mode: 'remote',
    participants: room.guest ? [room.host, room.guest] : [room.host],
    streamPath: `/api/rooms/${encodeURIComponent(room.room_id)}/stream?${query.toString()}`,
    you,
    room: { roomId: room.room_id, token },
  };
}

export function inviteLink(room: CreatedRoom, origin: string): string {
  return `${origin}/#join/${encodeURIComponent(room.room_id)}/${encodeURIComponent(room.guest_token)}`;
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

export function isLocalOnly(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost');
}
