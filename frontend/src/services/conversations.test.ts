import { describe, expect, it } from 'vitest';

import { inviteFromHash, inviteLink, inviteProblem, roomConversation, sessionConversation } from './conversations';

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

  const room = { room_id: 'r1', host, guest: null, host_token: 'h', guest_token: 'g/1', public_url: null, public_url_problem: null };

  it('makes an invite link that can be read back', () => {
    const link = inviteLink(room, 'https://quiet-river.trycloudflare.com');

    expect(link).toBe('https://quiet-river.trycloudflare.com/#join/r1/g%2F1');
    expect(inviteFromHash(new URL(link).hash)).toEqual({ roomId: 'r1', token: 'g/1' });
    expect(inviteFromHash('#privacy')).toBeNull();
  });

  it('prefers the public link the backend opened, even when the page is on localhost', () => {
    const link = inviteLink({ ...room, public_url: 'https://fast-cloud.trycloudflare.com/' }, 'http://localhost:8000');

    expect(link).toBe('https://fast-cloud.trycloudflare.com/#join/r1/g%2F1');
    expect(inviteProblem({ ...room, public_url: 'https://fast-cloud.trycloudflare.com' }, 'localhost')).toBeNull();
  });

  it('explains when a link would only work on this computer', () => {
    expect(inviteProblem(room, 'localhost')).toBe('This link only works on this computer.');
    expect(inviteProblem({ ...room, public_url_problem: 'No public link: cloudflared is not installed.' }, '127.0.0.1'))
      .toBe('No public link: cloudflared is not installed.');
    expect(inviteProblem(room, 'quiet-river.trycloudflare.com')).toBeNull();
  });
});
