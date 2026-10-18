import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, createSession, detectLanguage, getHealth, getRoom, getVoices, joinRoom } from './api';

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
    fetchMock.mockResolvedValueOnce(new Response('{"status":"ok","version":"0.8.0"}', { status: 200 }));

    await expect(getHealth()).resolves.toEqual({ status: 'ok', version: '0.8.0' });
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
    expect(init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
  });

  it('passes on why no language was found', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"detail":"No speech was heard."}', { status: 422 }));

    await expect(detectLanguage(new ArrayBuffer(48))).rejects.toMatchObject({ status: 422, detail: 'No speech was heard.' });
  });

  it('looks at a room with its token in a header, never in the address', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      room_id: 'r1',
      host: { id: 'A', name: 'Person 1', preferred_language: 'te' },
      guest: null,
    }), { status: 200 }));

    await expect(getRoom('r1', 'secret')).resolves.toMatchObject({ room_id: 'r1', guest: null });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://localhost:8000/api/rooms/r1');
    expect(init).toMatchObject({ headers: { 'X-Room-Token': 'secret' } });
  });

  it('joins with the invite and keeps the new device token', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      room_id: 'r1',
      host: { id: 'A', name: 'Person 1', preferred_language: 'te' },
      guest: { id: 'B', name: 'Person 2', preferred_language: 'en' },
      token: 'device',
    }), { status: 200 }));

    const joined = await joinRoom('r1', 'invite', { name: 'Person 2', preferred_language: 'en' });

    expect(joined.token).toBe('device');
    expect(joined.room.guest?.id).toBe('B');
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toEqual({
      consent: true,
      token: 'invite',
      guest: { name: 'Person 2', preferred_language: 'en' },
    });
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
});
