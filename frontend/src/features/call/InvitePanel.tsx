import { useRef, useState } from 'react';

import { languageName } from '../../services/languageNames';
import type { InviteDetails } from '../../services/conversations';
import type { Participant, SpeakerId } from '../../services/protocol';
import { usePanelFocus } from './usePanelFocus';

interface InviteCardProps {
  invite: InviteDetails;
  room: number;
}

export function InviteCard({ invite, room }: InviteCardProps) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(invite.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function share(): void {
    void navigator.share({ title: 'Voice Translator', text: 'Join my translated call', url: invite.link }).catch(() => undefined);
  }

  return (
    <div className="invite-card">
      <label className="field-label" htmlFor="call-invite-link">Invite link · {room} more can join</label>
      <div className="invite-row">
        <input
          id="call-invite-link"
          className="text-input invite-link"
          readOnly
          value={invite.link}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button className="button button-primary" type="button" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        {canShare && (
          <button className="button button-secondary" type="button" onClick={share}>
            Share
          </button>
        )}
      </div>
      {invite.problem && <p className="invite-warning" role="note">{invite.problem}</p>}
    </div>
  );
}

interface InvitePanelProps {
  open: boolean;
  invite: InviteDetails | null;
  people: Participant[];
  you: SpeakerId | null;
  connected: ReadonlySet<SpeakerId> | null;
  maxPeople: number;
  onClose: () => void;
}

export default function InvitePanel({ open, invite, people, you, connected, maxPeople, onClose }: InvitePanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  usePanelFocus(open, onClose, panelRef);
  return (
    <div
      className="settings-panel invite-panel"
      id="call-people"
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label="People"
      hidden={!open}
    >
      <header className="settings-header">
        <h2>People ({people.length})</h2>
        <button className="button button-small button-secondary" type="button" onClick={onClose}>
          Done
        </button>
      </header>
      <ul className="people-list">
        {people.map((person) => {
          const here = person.id === you || connected === null || connected.has(person.id);
          return (
            <li key={person.id} data-here={here}>
              <span className="people-dot" aria-hidden="true" />
              <span className="people-name" dir="auto">
                {person.name}
                {person.id === you ? ' (you)' : ''}
                {person.id === 'A' ? ' · host' : ''}
              </span>
              <span className="people-language">{languageName(person.preferred_language)}</span>
              <span className="visually-hidden">{here ? 'connected' : 'not connected'}</span>
            </li>
          );
        })}
      </ul>
      {invite ? (
        <InviteCard invite={invite} room={Math.max(0, maxPeople - people.length)} />
      ) : (
        <p className="people-note">Ask the host for the invite link to bring more people in.</p>
      )}
    </div>
  );
}
