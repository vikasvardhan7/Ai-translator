import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, createSession, getHealth } from './api';

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
    fetchMock.mockResolvedValueOnce(new Response('{"status":"ok","version":"0.7.0"}', { status: 200 }));

    await expect(getHealth()).resolves.toEqual({ status: 'ok', version: '0.7.0' });
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
});
