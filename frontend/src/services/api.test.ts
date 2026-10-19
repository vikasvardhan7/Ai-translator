import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, askAssistant, cancelMeeting, createRoom, getMeeting, joinMeeting, listMeetings, scheduleMeeting, startMeeting, createSession, detectLanguage, getHealth, getRoom, getVoices, isHost, joinRoom, leaveRoom } from './api';

const fetchMock = vi.fn<typeof fetch>();

describe('frontend API calls', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads backend health', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"status":"ok","version":"0.9.0"}', { status: 200 }));

    await expect(getHealth()).resolves.toEqual({ status: 'ok', version: '0.9.0' });
  });

  it('posts participants and consent to create a session', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      session_id: 'session-1',
      mode: 'together',
      participants: [
        { id: 'A', name: 'Person A', preferred_language: 'en' },
        { id: 'B', name: 'Person B', preferred_language: 'te' },
      ],
      created_at: '2026-10-18T09:30:00Z',
    }), { status: 201 }));

    const participants = [
      { id: 'A' as const, name: 'Person A', preferred_language: 'en' },
      { id: 'B' as const, name: 'Person B', preferred_language: 'te' },
    ];

    await expect(createSession(participants, true)).resolves.toMatchObject({
      session_id: 'session-1',
      mode: 'together',
    });
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8000/api/sessions', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ consent: true, mode: 'together', participants }),
    }));
  });

  it('refuses a session response without a known mode', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      session_id: 'session-1',
      mode: 'radio',
      participants: [
        { id: 'A', name: 'Person A', preferred_language: 'en' },
        { id: 'B', name: 'Person B', preferred_language: 'te' },
      ],
      created_at: '2026-10-18T09:30:00Z',
    }), { status: 201 }));

    await expect(createSession([], true)).rejects.toThrow('invalid session response');
  });

  it('throws an ApiError carrying the server detail for a rejected request', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"detail":"Names must be 1 to 40 characters."}', { status: 422 }));

    const request = getHealth();
    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({
      name: 'ApiError',
      status: 422,
      detail: 'Names must be 1 to 40 characters.',
      message: 'Names must be 1 to 40 characters.',
    });
  });

  it('preserves network failures', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(getHealth()).rejects.toThrow('Failed to fetch');
  });

  it('sends a short recording and reads the language heard', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"language":"te","language_name":"Telugu"}', { status: 200 }));
    const wav = new ArrayBuffer(48);

    await expect(detectLanguage(wav)).resolves.toEqual({ language: 'te' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://localhost:8000/api/languages/detect');
    expect(init).toMatchObject({ method: 'POST', body: wav });
    expect(new Headers(init!.headers).get('Content-Type')).toBe('audio/wav');
  });

  it('lets an invited guest find their language with the invite', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"language":"en","language_name":"English"}', { status: 200 }));

    await detectLanguage(new ArrayBuffer(48), { roomId: 'r1', token: 'invite' });

    const headers = new Headers(fetchMock.mock.calls[0]![1]!.headers);
    expect([headers.get('X-Room-Id'), headers.get('X-Room-Token')]).toEqual(['r1', 'invite']);
  });

  it('sends the saved host key with every request and checks a new one', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'K7QM-4XPA-2JRT', setItem: () => undefined });
    fetchMock.mockResolvedValueOnce(new Response('{"host":true}', { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response('{"host":false}', { status: 200 }));

    await expect(isHost()).resolves.toBe(true);
    await expect(isHost('WRONG')).resolves.toBe(false);

    const keys = fetchMock.mock.calls.map(([, init]) => new Headers(init!.headers).get('X-Host-Key'));
    expect(keys).toEqual(['K7QM-4XPA-2JRT', 'WRONG']);
  });

  it('works without saved storage', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); } });
    fetchMock.mockResolvedValueOnce(new Response('{"status":"ok","version":"0.9.0"}', { status: 200 }));

    await getHealth();

    expect(new Headers(fetchMock.mock.calls[0]![1]!.headers).has('X-Host-Key')).toBe(false);
  });

  it('ends a conversation with this device\'s token', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    fetchMock.mockResolvedValueOnce(new Response('{"detail":"Only the person who started it."}', { status: 403 }));

    await expect(leaveRoom('r1', 'host')).resolves.toBeUndefined();
    await expect(leaveRoom('r1', 'wrong')).rejects.toMatchObject({ status: 403 });
    expect(fetchMock.mock.calls[0]).toEqual(['http://localhost:8000/api/rooms/r1', { method: 'DELETE', headers: { 'X-Room-Token': 'host' } }]);
  });

  it('accepts a meeting with only the person using it', async () => {
    const you = { id: 'A' as const, name: 'You', preferred_language: 'en' };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      session_id: 'm1', mode: 'call', participants: [you], created_at: '2026-10-18T09:30:00Z',
    }), { status: 201 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      session_id: 'm2', mode: 'call', participants: [you, { ...you, id: 'B' }], created_at: '2026-10-18T09:30:00Z',
    }), { status: 201 }));

    await expect(createSession([you], true, 'call')).resolves.toMatchObject({ mode: 'call', participants: [you] });
    await expect(createSession([you], true, 'call')).rejects.toThrow('invalid session response');
  });

  it('passes on why no language was found', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"detail":"No speech was heard."}', { status: 422 }));

    await expect(detectLanguage(new ArrayBuffer(48))).rejects.toMatchObject({ status: 422, detail: 'No speech was heard.' });
  });

  it('looks at a room with its token in a header, never in the address', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      room_id: 'r1',
      host: { id: 'A', name: 'Person 1', preferred_language: 'te' },
      guests: [],
      max_people: 6,
    }), { status: 200 }));

    await expect(getRoom('r1', 'secret')).resolves.toMatchObject({ room_id: 'r1', guests: [], max_people: 6 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://localhost:8000/api/rooms/r1');
    expect(new Headers(init!.headers).get('X-Room-Token')).toBe('secret');
  });

  it('joins with the invite and keeps the new device token', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      room_id: 'r1',
      host: { id: 'A', name: 'Person 1', preferred_language: 'te' },
      guests: [{ id: 'B', name: 'Person 2', preferred_language: 'en' }, { id: 'C', name: 'Mei', preferred_language: 'zh' }],
      max_people: 6,
      token: 'device',
      you: 'C',
    }), { status: 200 }));

    const joined = await joinRoom('r1', 'invite', { name: 'Mei', preferred_language: 'zh' });

    expect(joined.you).toBe('C');
    expect(joined.token).toBe('device');
    expect(joined.room.guests.map((person) => person.id)).toEqual(['B', 'C']);
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({
      consent: true,
      token: 'invite',
      guest: { name: 'Mei', preferred_language: 'zh' },
    });
  });

  it('refuses a room answer that names the host as a guest', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      room_id: 'r1',
      host: { id: 'A', name: 'Person 1', preferred_language: 'te' },
      guests: [{ id: 'A', name: 'Twin', preferred_language: 'te' }],
      max_people: 6,
    }), { status: 200 }));

    await expect(getRoom('r1', 'secret')).rejects.toThrow('invalid conversation');
  });

  it('loads the natural voices the backend finds live', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      voices: [
        { id: 'Kore', display_name: 'Kore', description: 'Firm', gender: 'female', language_code: 'en-US' },
        { id: '', display_name: 'broken' },
      ],
    }), { status: 200 }));

    await expect(getVoices()).resolves.toEqual([{
      id: 'Kore',
      display_name: 'Kore',
      description: 'Firm',
      gender: 'female',
      language_code: 'en-US',
      pitch: '',
      accent: '',
    }]);
  });

  it('starts a two-device conversation and keeps the public link and any problem', async () => {
    const created = { room_id: 'r1', host: { id: 'A', name: 'Person 1', preferred_language: 'te' }, guests: [], max_people: 6, host_token: 'h', invite_token: 'g' };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...created, public_url: 'https://fast-cloud.trycloudflare.com', public_url_problem: null }), { status: 201 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...created, public_url: null, public_url_problem: 'No public link: cloudflared is not installed.' }), { status: 201 }));

    await expect(createRoom({ name: 'Person 1', preferred_language: 'te' })).resolves.toMatchObject({
      host_token: 'h',
      public_url: 'https://fast-cloud.trycloudflare.com',
      public_url_problem: null,
    });
    await expect(createRoom({ name: 'Person 1', preferred_language: 'te' })).resolves.toMatchObject({
      public_url: null,
      public_url_problem: 'No public link: cloudflared is not installed.',
    });
  });
  it('asks the assistant with the chat, the live transcript, what it may do and the room headers', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      answer: '  Muted. ',
      actions: [{ name: 'mute', arguments: {} }, { name: 'open_app', arguments: { app: 'help', bad: 3 } }, { arguments: {} }],
      sources: [{ title: 'Site', url: 'https://site.example' }, { title: 'Plain', url: 'http://plain.example' }],
    }), { status: 200 }));
    const request = {
      messages: [{ role: 'user' as const, text: 'Mute me' }],
      language: 'te',
      transcript: [{ speaker: 'Meeting', text: 'Budget next week.' }],
      actions: ['mute'],
      now: '2026-10-19T22:10:00+05:30',
    };

    await expect(askAssistant(request, { roomId: 'room-1', token: 'secret' })).resolves.toEqual({
      answer: 'Muted.',
      actions: [{ name: 'mute', arguments: {} }, { name: 'open_app', arguments: { app: 'help' } }],
      sources: [{ title: 'Site', url: 'https://site.example' }],
    });
    const [url, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(url).toBe('http://localhost:8000/api/assistant');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(request);
    expect(headers.get('X-Room-Id')).toBe('room-1');
    expect(headers.get('X-Room-Token')).toBe('secret');
  });

  it('passes on why the assistant could not answer and refuses a broken answer', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"detail":"The free AI limit was reached."}', { status: 503 }));
    fetchMock.mockResolvedValueOnce(new Response('{"answer":"hi"}', { status: 200 }));
    const request = { messages: [{ role: 'user' as const, text: 'Hi' }], language: 'en', transcript: [], actions: [], now: '2026-10-19T22:10:00+05:30' };

    await expect(askAssistant(request)).rejects.toThrow('The free AI limit was reached.');
    await expect(askAssistant(request)).rejects.toThrow('gave no answer');
  });

  const meeting = {
    id: 'm1',
    title: 'Budget',
    starts_at: '2026-10-20T11:30:00+00:00',
    duration_minutes: 30,
    agenda: 'Q4',
    host_name: 'Vikas',
    status: 'upcoming',
    people: 0,
  };

  it('schedules a meeting and keeps both tokens and the public link', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      ...meeting, host_token: 'h', invite_token: 'i', public_url: null, public_url_problem: 'No public link.',
    }), { status: 201 }));
    const plan = { title: 'Budget', starts_at: '2026-10-20T17:00:00+05:30', duration_minutes: 30, agenda: 'Q4', host_name: 'Vikas' };

    await expect(scheduleMeeting(plan)).resolves.toMatchObject({ id: 'm1', host_token: 'h', invite_token: 'i', public_url_problem: 'No public link.' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://localhost:8000/api/meetings');
    expect(JSON.parse(String(init!.body))).toEqual(plan);
  });

  it('lists upcoming meetings and refuses a broken one', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      meetings: [{ ...meeting, host_token: 'h', invite_token: 'i' }], public_url: 'https://x.example', public_url_problem: null,
    }), { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      meetings: [{ ...meeting, starts_at: 'not a time', host_token: 'h', invite_token: 'i' }],
    }), { status: 200 }));

    await expect(listMeetings()).resolves.toMatchObject({ meetings: [{ id: 'm1' }], public_url: 'https://x.example' });
    await expect(listMeetings()).rejects.toThrow('invalid meeting');
  });

  it('looks at, starts, joins and cancels a meeting with the token in a header', async () => {
    const room = { room_id: 'r1', host: { id: 'A', name: 'Vikas', preferred_language: 'en' }, guests: [], max_people: 6 };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(meeting), { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...room, host_token: 'rh', invite_token: 'ri', public_url: null, public_url_problem: null }), { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...room, guests: [{ id: 'B', name: 'Priya', preferred_language: 'hi' }], token: 'device', you: 'B' }), { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const access = { meetingId: 'm1', token: 'secret' };

    await expect(getMeeting(access)).resolves.toMatchObject({ title: 'Budget', status: 'upcoming' });
    await expect(startMeeting(access, { name: 'Vikas', preferred_language: 'en' })).resolves.toMatchObject({ host_token: 'rh' });
    await expect(joinMeeting(access, { name: 'Priya', preferred_language: 'hi' })).resolves.toMatchObject({ token: 'device', you: 'B' });
    await expect(cancelMeeting(access)).resolves.toBeUndefined();
    const calls = fetchMock.mock.calls;
    expect(calls.map(([url]) => url)).toEqual([
      'http://localhost:8000/api/meetings/m1',
      'http://localhost:8000/api/meetings/m1/start',
      'http://localhost:8000/api/meetings/m1/join',
      'http://localhost:8000/api/meetings/m1',
    ]);
    expect(new Headers(calls[0]![1]!.headers).get('X-Meeting-Token')).toBe('secret');
    expect(new Headers(calls[1]![1]!.headers).get('X-Meeting-Token')).toBe('secret');
    expect(JSON.parse(String(calls[2]![1]!.body))).toEqual({ consent: true, token: 'secret', guest: { name: 'Priya', preferred_language: 'hi' } });
    expect(calls[3]![1]!.method).toBe('DELETE');
  });

  it('lets a meeting guest find their language with the meeting link', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"language":"hi"}', { status: 200 }));

    await detectLanguage(new ArrayBuffer(4), { meetingId: 'm1', token: 'secret' });

    const headers = new Headers(fetchMock.mock.calls[0]![1]!.headers);
    expect(headers.get('X-Meeting-Token')).toBe('secret');
    expect(headers.get('X-Meeting-Id')).toBe('m1');
    expect(headers.get('X-Room-Id')).toBeNull();
  });
});
