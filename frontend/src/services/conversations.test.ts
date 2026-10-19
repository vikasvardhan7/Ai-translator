import { describe, expect, it } from 'vitest';

import { inviteFromHash, inviteLink, isLocalOnly, roomConversation, sessionConversation } from './conversations';

const host = { id: 'A' as const, name: 'Person 1', preferred_language: 'te' };
const guest = { id: 'B' as const, name: 'Person 2', preferred_language: 'en' };

describe('conversations', () => {
  it('opens a shared-screen session on its own stream', () => {
    expect(sessionConversation({
      session_id: 's 1',
      mode: 'together',
      participants: [host, guest],
      created_at: '2026-10-18T09:30:00Z',
    })).toEqual({
      id: 's 1',
      mode: 'together',
      participants: [host, guest],
      streamPath: '/api/sessions/s%201/stream',
      you: null,
      room: null,
    });
  });

  it('opens a meeting as the one person using it', () => {
    expect(sessionConversation({
      session_id: 'm1',
      mode: 'call',
      participants: [host],
      created_at: '2026-10-18T09:30:00Z',
    })).toMatchObject({ mode: 'call', participants: [host], you: 'A', room: null });
  });

  it('opens a two-device conversation with this device\'s token', () => {
    expect(roomConversation({ room_id: 'r1', host, guest }, 'a/b+c', 'B')).toEqual({
      id: 'r1:B',
      mode: 'remote',
      participants: [host, guest],
      streamPath: '/api/rooms/r1/stream?token=a%2Fb%2Bc',
      you: 'B',
      room: { roomId: 'r1', token: 'a/b+c' },
    });
  });

  it('makes an invite link that can be read back', () => {
    const link = inviteLink(
      { room_id: 'r1', host, guest: null, host_token: 'h', guest_token: 'g/1' },
      'https://quiet-river.trycloudflare.com',
    );

    expect(link).toBe('https://quiet-river.trycloudflare.com/#join/r1/g%2F1');
    expect(inviteFromHash(new URL(link).hash)).toEqual({ roomId: 'r1', token: 'g/1' });
    expect(inviteFromHash('#privacy')).toBeNull();
  });

  it('knows when a link would only work on this computer', () => {
    expect(isLocalOnly('localhost')).toBe(true);
    expect(isLocalOnly('127.0.0.1')).toBe(true);
    expect(isLocalOnly('quiet-river.trycloudflare.com')).toBe(false);
  });
});
