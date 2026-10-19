import { describe, expect, it } from 'vitest';

import { inviteFromHash, inviteLink, inviteProblem, linkProblem, meetingFromHash, meetingLink, roomConversation, sessionConversation } from './conversations';

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
      invite: null,
      maxPeople: 2,
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

  it('opens a call of several people with this device\'s token', () => {
    const third = { id: 'C' as const, name: 'Mei', preferred_language: 'zh' };
    expect(roomConversation({ room_id: 'r1', host, guests: [guest, third], max_people: 6 }, 'a/b+c', 'C')).toEqual({
      id: 'r1:C',
      mode: 'remote',
      participants: [host, guest, third],
      streamPath: '/api/rooms/r1/stream?token=a%2Fb%2Bc',
      you: 'C',
      room: { roomId: 'r1', token: 'a/b+c' },
      invite: null,
      maxPeople: 6,
    });
  });

  it('keeps the invite link for the host inside the call', () => {
    const invite = { link: 'https://x.example/#join/r1/i', problem: null };
    expect(roomConversation({ room_id: 'r1', host, guests: [], max_people: 6 }, 'h', 'A', invite).invite).toEqual(invite);
  });

  const room = { room_id: 'r1', host, guests: [], max_people: 6, host_token: 'h', invite_token: 'g/1', public_url: null, public_url_problem: null };

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

  it('makes a meeting link that can be read back', () => {
    const link = meetingLink('m 1', 'a/b', 'https://x.trycloudflare.com/', 'http://localhost:8000');

    expect(link).toBe('https://x.trycloudflare.com/#meet/m%201/a%2Fb');
    expect(meetingFromHash(new URL(link).hash)).toEqual({ meetingId: 'm 1', token: 'a/b' });
    expect(meetingFromHash('#join/r1/t')).toBeNull();
    expect(meetingLink('m1', 't', null, 'http://localhost:8000')).toBe('http://localhost:8000/#meet/m1/t');
  });

  it('warns when a meeting link only works on this computer', () => {
    expect(linkProblem(null, null, 'localhost')).toBe('This link only works on this computer.');
    expect(linkProblem(null, 'No public link: cloudflared is not installed.', 'localhost')).toBe('No public link: cloudflared is not installed.');
    expect(linkProblem('https://x.example', null, 'localhost')).toBeNull();
    expect(linkProblem(null, null, 'x.trycloudflare.com')).toBeNull();
  });
});
