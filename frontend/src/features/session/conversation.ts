import { perSpeaker, SPEAKER_IDS, type ConversationMode, type Participant, type ServerMessage, type SpeakerId } from '../../services/protocol';

export const MAX_TURNS = 100;

type TurnStatus = 'processing' | 'done' | 'failed';
export type Names = Record<SpeakerId, string>;

export interface Turn {
  utteranceId: string;
  speakerId: SpeakerId | null;
  status: TurnStatus;
  startedAt: number;
  endedAt: number;
  original?: { text: string; language: string; languageName: string };
  translations: Partial<Record<SpeakerId, { targetLanguage: string; text: string }>>;
  error?: string;
}

function update(turns: Turn[], utteranceId: string, change: (turn: Turn) => Turn): Turn[] {
  let found = false;
  const next = turns.map((turn) => {
    if (turn.utteranceId !== utteranceId) {
      return turn;
    }
    found = true;
    return change(turn);
  });
  return found ? next : turns;
}

export function applyServerMessage(
  turns: Turn[],
  message: ServerMessage,
  now: number = Date.now(),
  limit: number = MAX_TURNS,
): Turn[] {
  switch (message.type) {
    case 'utterance.received':
      if (turns.some((turn) => turn.utteranceId === message.utterance_id)) {
        return turns;
      }
      return [
        ...turns,
        {
          utteranceId: message.utterance_id,
          speakerId: message.speaker_id,
          status: 'processing' as const,
          startedAt: now - message.duration_ms,
          endedAt: now,
          translations: {},
        },
      ].slice(-limit);
    case 'utterance.ignored':
      return turns.filter((turn) => turn.utteranceId !== message.utterance_id);
    case 'transcript.final':
      return update(turns, message.utterance_id, (turn) => ({
        ...turn,
        speakerId: message.speaker_id ?? turn.speakerId,
        status: 'done',
        original: {
          text: message.text,
          language: message.language,
          languageName: message.language_name,
        },
      }));
    case 'translation.final':
      return update(turns, message.utterance_id, (turn) => ({
        ...turn,
        translations: {
          ...turn.translations,
          [message.listener_id]: { targetLanguage: message.target_language, text: message.text },
        },
      }));
    case 'error':
      if (message.utterance_id === null || message.code === 'voice_unavailable') {
        return turns;
      }
      return update(turns, message.utterance_id, (turn) => ({
        ...turn,
        status: 'failed',
        error: message.message,
      }));
    default:
      return turns;
  }
}

export function abandonPending(turns: Turn[], reason: string, affected: (turn: Turn) => boolean = () => true): Turn[] {
  return turns.map((turn) =>
    turn.status === 'processing' && affected(turn) ? { ...turn, status: 'failed', error: reason } : turn,
  );
}

export function speakerNames(mode: ConversationMode, participants: readonly Participant[], you: SpeakerId | null): Names {
  const names = perSpeaker('Someone');
  if (mode === 'call') {
    return { ...names, A: 'You', B: 'Meeting' };
  }
  for (const id of SPEAKER_IDS) {
    const person = participants.find((item) => item.id === id);
    if (id === you) {
      names[id] = 'You';
    } else if (person) {
      names[id] = person.name.trim() || `Person ${SPEAKER_IDS.indexOf(id) + 1}`;
    }
  }
  return names;
}

export function speakerName(names: Names, id: SpeakerId | null): string {
  return id ? names[id] : 'Someone';
}

interface BubbleTranslation {
  listenerId: SpeakerId;
  text: string;
}

export type Bubble =
  | { kind: 'pending'; side: SpeakerId | null }
  | { kind: 'failed'; side: SpeakerId | null; error: string }
  | {
    kind: 'spoken';
    side: SpeakerId | null;
    text: string;
    languageName: string;
    translations: BubbleTranslation[];
    translating: boolean;
  };

export function bubbleFor(turn: Turn, participants: readonly Participant[]): Bubble {
  const side = turn.speakerId;
  if (turn.status === 'failed') {
    return { kind: 'failed', side, error: turn.error ?? 'This sentence could not be translated.' };
  }
  if (!turn.original) {
    return { kind: 'pending', side };
  }
  const translations = participants.flatMap((person) => {
    const translation = turn.translations[person.id];
    return translation ? [{ listenerId: person.id, text: translation.text }] : [];
  });
  const translating = side !== null && participants.some(
    (person) => person.id !== side && !turn.translations[person.id],
  );
  return {
    kind: 'spoken',
    side,
    text: turn.original.text,
    languageName: turn.original.languageName,
    translations,
    translating,
  };
}
