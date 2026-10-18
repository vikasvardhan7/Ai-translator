import { memo } from 'react';

import { languageLabel } from '../../services/languageNames';
import type { Participant, SpeakerId } from '../../services/protocol';

interface CallTilesProps {
  participants: Participant[];
  you: SpeakerId | null;
  talking: ReadonlySet<SpeakerId>;
  hearing: SpeakerId | null;
  muted: boolean;
  roomTalking: boolean;
}

function title(person: Participant, you: SpeakerId | null): string {
  if (!you) {
    return person.name;
  }
  return person.id === you ? 'You' : 'Them';
}

function badge(person: Participant): string {
  return person.preferred_language.slice(0, 3).toUpperCase();
}

function CallTiles({ participants, you, talking, hearing, muted, roomTalking }: CallTilesProps) {
  const ordered = you
    ? [...participants.filter((person) => person.id !== you), ...participants.filter((person) => person.id === you)]
    : participants;

  return (
    <div className="call-tiles">
      {ordered.map((person) => {
        const state = talking.has(person.id)
          ? 'talking'
          : roomTalking
            ? 'listening'
            : hearing === person.id
            ? 'hearing'
            : person.id === you && muted
              ? 'muted'
              : 'idle';
        const status = {
          talking: 'Speaking',
          listening: 'Listening',
          hearing: 'Hearing the translation',
          muted: 'Microphone off',
          idle: '',
        }[state];
        return (
          <section className="call-tile" data-state={state} aria-label={title(person, you)} key={person.id}>
            <div className="call-avatar" aria-hidden="true">
              <span className="call-avatar-ring" />
              <span className="call-avatar-ring call-avatar-ring-late" />
              <span className="call-avatar-face">{badge(person)}</span>
            </div>
            <h2 dir="auto">{title(person, you)}</h2>
            <p className="call-tile-language">{languageLabel(person.preferred_language)}</p>
            <p className="call-tile-status" aria-live="polite">{status}</p>
          </section>
        );
      })}
    </div>
  );
}

export default memo(CallTiles);
