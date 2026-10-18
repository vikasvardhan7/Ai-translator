import { describe, expect, it } from 'vitest';

import type { Participant } from '../../services/protocol';
import { canStartSession, isLanguageCodeValid, isParticipantValid } from './validation';

const participants: [Participant, Participant] = [
  { id: 'A', name: ' Person A ', preferred_language: 'en' },
  { id: 'B', name: 'Person B', preferred_language: 'te' },
];
describe('consent validation', () => {
  it('allows a valid pair after trimming names', () => {
    expect(canStartSession(true, participants)).toBe(true);
  });

  it('requires agreement from both people', () => {
    expect(canStartSession(false, participants)).toBe(false);
  });

  it('requires non-empty names no longer than 40 characters', () => {
    expect(isParticipantValid({ ...participants[0], name: '   ' })).toBe(false);
    expect(isParticipantValid({ ...participants[0], name: 'a'.repeat(41) })).toBe(false);
    expect(isParticipantValid({ ...participants[0], name: 'a'.repeat(40) })).toBe(true);
  });

  it('accepts any two or three letter ISO language code and normalizes region tags', () => {
    expect(isLanguageCodeValid('yue')).toBe(true);
    expect(isLanguageCodeValid('EN-us')).toBe(true);
    expect(isLanguageCodeValid('e')).toBe(false);
    expect(isLanguageCodeValid('english')).toBe(false);
    expect(isLanguageCodeValid('')).toBe(false);
  });
});
