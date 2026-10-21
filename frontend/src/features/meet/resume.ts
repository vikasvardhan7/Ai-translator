import type { Conversation } from '../../services/conversations';

const CALL_KEY = 'voice-translator-meet-call';

/** The call this tab is in, kept for this tab only so a reload can go back into the same place. */
export function rememberCall(conversation: Conversation | null): void {
  try {
    if (conversation) {
      window.sessionStorage.setItem(CALL_KEY, JSON.stringify(conversation));
    } else {
      window.sessionStorage.removeItem(CALL_KEY);
    }
  } catch {
    return;
  }
}

export function rememberedCall(): Conversation | null {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(CALL_KEY) ?? 'null') as Partial<Conversation> | null;
    if (
      saved &&
      saved.mode === 'remote' &&
      typeof saved.id === 'string' &&
      typeof saved.streamPath === 'string' &&
      saved.streamPath.startsWith('/api/rooms/') &&
      typeof saved.you === 'string' &&
      Array.isArray(saved.participants) &&
      typeof saved.maxPeople === 'number'
    ) {
      return saved as Conversation;
    }
  } catch {
    return null;
  }
  return null;
}
