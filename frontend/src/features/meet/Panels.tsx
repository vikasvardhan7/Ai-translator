import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';

import LanguageSelect from '../consent/LanguageSelect';
import type { LanguageOption } from '../consent/languageOptions';
import type { ChatLine, MediaState, Participant, SpeakerId } from '../../services/protocol';
import { languageName } from '../../services/languageNames';
import { chatTime, initials } from './captions';
import { canChooseSpeaker, deviceLabel, type DeviceChoice, type DeviceLists } from './devices';
import type { PeerState } from './mesh';
import MeetIcon from './MeetIcon';

interface PanelFrameProps {
  id: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function PanelFrame({ id, title, onClose, children }: PanelFrameProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [id]);
  return (
    <aside className="meet-panel" id={id} aria-label={title}>
      <header className="meet-panel-top">
        <h2 ref={headingRef} tabIndex={-1}>{title}</h2>
        <button className="meet-round meet-round-small" type="button" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}>
          <MeetIcon name="close" />
        </button>
      </header>
      {children}
    </aside>
  );
}

interface ChatPanelProps {
  chat: ChatLine[];
  you: SpeakerId;
  live: boolean;
  onSend: (text: string) => void;
}

export function ChatPanel({ chat, you, live, onSend }: ChatPanelProps) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [chat.length]);

  function send(event?: FormEvent<HTMLFormElement>): void {
    event?.preventDefault();
    if (text.trim() && live) {
      onSend(text);
      setText('');
    }
  }

  function keys(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  return (
    <>
      <p className="meet-panel-note">Everyone in the call sees these messages. They are gone when the call ends.</p>
      <ol className="meet-chat" ref={listRef}>
        {chat.length === 0 && <li className="meet-chat-empty">No messages yet. Say hello, or share a link.</li>}
        {chat.map((line, index) => {
          const mine = line.from === you;
          const follows = index > 0 && chat[index - 1]!.from === line.from;
          return (
            <li className="meet-chat-line" key={line.id} data-mine={mine} data-follows={follows}>
              {!follows && (
                <p className="meet-chat-who">
                  <strong dir="auto">{mine ? 'You' : line.name || 'Someone'}</strong>
                  <time dateTime={line.sent_at}>{chatTime(line.sent_at)}</time>
                </p>
              )}
              <p className="meet-chat-text" dir="auto">{line.text}</p>
            </li>
          );
        })}
      </ol>
      <form className="meet-chat-form" onSubmit={send}>
        <label className="visually-hidden" htmlFor="meet-chat-input">Message everyone</label>
        <textarea
          id="meet-chat-input"
          rows={1}
          maxLength={1000}
          value={text}
          placeholder={live ? 'Message everyone' : 'Chat works once you are connected'}
          disabled={!live}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={keys}
        />
        <button className="meet-round meet-round-small meet-send" type="submit" disabled={!live || !text.trim()} aria-label="Send message">
          <MeetIcon name="send" />
        </button>
      </form>
    </>
  );
}

interface PeoplePanelProps {
  participants: Participant[];
  you: SpeakerId;
  connected: ReadonlySet<SpeakerId>;
  media: Partial<Record<SpeakerId, MediaState>>;
  peerStates: Partial<Record<SpeakerId, PeerState>>;
  recording: ReadonlySet<SpeakerId>;
  maxPeople: number;
  inviteLink: string | null;
  inviteProblem: string | null;
}

export function InviteLink({ link, problem, room }: { link: string; problem: string | null; room: number }) {
  const [done, setDone] = useState('');
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      setDone('Link copied');
    } catch {
      setDone('Copying is blocked here. Select the link and copy it.');
    }
  }

  return (
    <div className="meet-invite">
      <p className="meet-invite-lead">
        {room > 0 ? `Send this link to up to ${room} ${room === 1 ? 'person' : 'people'}. They sign in, pick their language and join.` : 'The call is full.'}
      </p>
      <div className="meet-invite-row">
        <MeetIcon name="link" />
        <input className="meet-invite-link" readOnly value={link} aria-label="Invite link" onFocus={(event) => event.currentTarget.select()} />
      </div>
      <div className="meet-invite-actions">
        <button className="meet-pill" type="button" onClick={() => void copy()}>
          <MeetIcon name="copy" />
          Copy link
        </button>
        {canShare && (
          <button className="meet-pill" type="button" onClick={() => void navigator.share({ title: 'Join my call', url: link }).catch(() => undefined)}>
            Share
          </button>
        )}
      </div>
      {problem && <p className="meet-invite-warning" role="note">{problem}</p>}
      <p className="meet-invite-done" role="status">{done}</p>
    </div>
  );
}

export function PeoplePanel({ participants, you, connected, media, peerStates, recording, maxPeople, inviteLink, inviteProblem }: PeoplePanelProps) {
  const room = Math.max(0, maxPeople - participants.length);
  return (
    <>
      {inviteLink && <InviteLink link={inviteLink} problem={inviteProblem} room={room} />}
      <h3 className="meet-panel-heading">In the call ({participants.length} of {maxPeople})</h3>
      <ul className="meet-people">
        {participants.map((person) => {
          const mine = person.id === you;
          const state = media[person.id];
          const here = mine || connected.has(person.id);
          const link = peerStates[person.id];
          let note = languageName(person.preferred_language);
          if (!here) {
            note = 'Connection lost';
          } else if (!mine && link === 'failed') {
            note = `${note}, video could not connect`;
          }
          return (
            <li className="meet-person" key={person.id} data-here={here}>
              <span className="meet-person-face" aria-hidden="true">{initials(person.name)}</span>
              <span className="meet-person-text">
                <strong dir="auto">{mine ? `${person.name} (you)` : person.name}{person.id === 'A' ? ', host' : ''}</strong>
                <small>{note}{recording.has(person.id) ? ', recording' : ''}</small>
              </span>
              <span className="meet-person-icons">
                <MeetIcon name={state?.mic === false ? 'mic-off' : 'mic'} />
                <MeetIcon name={state?.camera === false ? 'camera-off' : 'camera'} />
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

interface SettingsPanelProps {
  devices: DeviceChoice;
  lists: DeviceLists;
  language: string;
  languages: LanguageOption[];
  liveWords: { available: boolean; on: boolean };
  onDevice: (kind: keyof DeviceChoice, id: string) => void;
  onLanguage: (code: string) => void;
  onLiveWords: (on: boolean) => void;
}

function DeviceSelect({ label, value, devices, kind, onChange }: { label: string; value: string; devices: MediaDeviceInfo[]; kind: string; onChange: (id: string) => void }) {
  const id = `meet-device-${kind.toLowerCase()}`;
  return (
    <div className="meet-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={devices.some((device) => device.deviceId === value) ? value : ''} onChange={(event) => onChange(event.target.value)}>
        <option value="">Same as the computer</option>
        {devices.filter((device) => device.deviceId !== 'default').map((device, index) => (
          <option key={device.deviceId} value={device.deviceId}>{deviceLabel(device, index, kind)}</option>
        ))}
      </select>
    </div>
  );
}

export function DeviceFields({ devices, lists, onDevice }: Pick<SettingsPanelProps, 'devices' | 'lists' | 'onDevice'>) {
  return (
    <>
      <DeviceSelect label="Microphone" kind="Microphone" value={devices.mic} devices={lists.mics} onChange={(id) => onDevice('mic', id)} />
      <DeviceSelect label="Camera" kind="Camera" value={devices.camera} devices={lists.cameras} onChange={(id) => onDevice('camera', id)} />
      {canChooseSpeaker() && (
        <DeviceSelect label="Speaker" kind="Speaker" value={devices.speaker} devices={lists.speakers} onChange={(id) => onDevice('speaker', id)} />
      )}
    </>
  );
}

export function SettingsPanel({ devices, lists, language, languages, liveWords, onDevice, onLanguage, onLiveWords }: SettingsPanelProps) {
  return (
    <div className="meet-settings">
      <h3 className="meet-panel-heading">Captions</h3>
      <LanguageSelect label="Show captions in" value={language} languages={languages} onChange={onLanguage} />
      <p className="meet-panel-note">Everyone else's words are translated into this language. Your own words show as you say them.</p>
      {liveWords.available && (
        <label className="meet-switch">
          <input type="checkbox" checked={liveWords.on} onChange={(event) => onLiveWords(event.target.checked)} />
          <span>Show words while people are still speaking</span>
        </label>
      )}
      <h3 className="meet-panel-heading">Audio and video</h3>
      <DeviceFields devices={devices} lists={lists} onDevice={onDevice} />
    </div>
  );
}
