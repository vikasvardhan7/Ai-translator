import { isSpeakerId, perSpeaker, SPEAKER_IDS, type ConversationMode, type Participant, type ServerMessage, type SpeakerId } from '../../services/protocol';

export const MAX_TURNS = 100;
export const MEETING_VOICES = ['1', '2', '3', '4', '5', '6'] as const;

type TurnStatus = 'processing' | 'done' | 'failed';
export type Names = Record<SpeakerId, string>;

export interface Turn {
  utteranceId: string;
  speakerId: SpeakerId | null;
  voice?: string | null;
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
        voice: message.voice,
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

function isMeetingVoice(voice: string | null | undefined): voice is string {
  return typeof voice === 'string' && (MEETING_VOICES as readonly string[]).includes(voice);
}

export function turnSpeaker(names: Names, turn: Pick<Turn, 'speakerId' | 'voice'>): string {
  return isMeetingVoice(turn.voice) ? `Speaker ${turn.voice}` : speakerName(names, turn.speakerId);
}

export interface VoiceChoice {
  voice: string;
  label: string;
}

export function voiceChoices(turns: readonly Turn[], turn: Turn, participants: readonly Participant[], names: Names): VoiceChoice[] {
  if (!turn.voice) {
    return [];
  }
  if (!isMeetingVoice(turn.voice)) {
    return participants.map((person) => ({ voice: person.id, label: names[person.id] }));
  }
  const heard = MEETING_VOICES.filter((voice) => turns.some((item) => item.voice === voice));
  const fresh = MEETING_VOICES.find((voice) => !heard.includes(voice));
  return [
    ...heard.map((voice) => ({ voice, label: `Speaker ${voice}` })),
    ...(fresh ? [{ voice: fresh, label: `Someone new (Speaker ${fresh})` }] : []),
  ];
}

export function fixVoice(turns: Turn[], utteranceId: string, voice: string): Turn[] {
  return update(turns, utteranceId, (turn) => ({
    ...turn,
    voice,
    speakerId: isSpeakerId(voice) ? voice : turn.speakerId,
  }));
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

function baseLanguage(code: string): string {
  return code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

export function awaitsTranslation(turn: Turn, person: Participant): boolean {
  return (
    turn.speakerId !== null &&
    person.id !== turn.speakerId &&
    !turn.translations[person.id] &&
    (!turn.original || baseLanguage(turn.original.language) !== baseLanguage(person.preferred_language))
  );
}

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
  const translating = participants.some((person) => awaitsTranslation(turn, person));
  return {
    kind: 'spoken',
    side,
    text: turn.original.text,
    languageName: turn.original.languageName,
    translations,
    translating,
  };
}
