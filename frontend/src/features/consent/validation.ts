import type { Participant } from '../../services/protocol';

export function isLanguageCodeValid(value: string): boolean {
  const primaryCode = value.trim().toLowerCase().replace(/_/g, '-').split('-')[0] ?? '';
  return /^[a-z]{2,3}$/.test(primaryCode);
}

export function isParticipantValid(participant: Participant): boolean {
  const name = participant.name.trim();
  return (
    name.length >= 1 &&
    name.length <= 40 &&
    isLanguageCodeValid(participant.preferred_language)
  );
}

export function canStartSession(
  consent: boolean,
  participants: readonly [Participant, Participant],
): boolean {
  const [first, second] = participants.map((person) => person.preferred_language.trim().toLowerCase().split(/[-_]/)[0]);
  return consent && participants.every(isParticipantValid) && first !== second;
}
