import { getBackendUrl } from '../config';
import {
  isParticipant,
  isSessionMode,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type Participant,
  type SessionMode,
} from './protocol';

export interface HealthResponse {
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

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getBackendUrl()}${path}`, init);
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
    body.participants.length !== 2 ||
    !body.participants.every(isParticipant) ||
    body.participants[0]?.id !== 'A' ||
    body.participants[1]?.id !== 'B'
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
