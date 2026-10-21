import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiError,
  createRoom,
  getMeeting,
  getRoom,
  joinMeeting,
  joinRoom,
  startMeeting,
  type HostedMeeting,
  type MeetingInfo,
} from '../../services/api';
import {
  inviteLink,
  inviteProblem,
  meetingLink,
  roomConversation,
  type Conversation,
  type Invite,
  type InviteDetails,
  type MeetingInvite,
} from '../../services/conversations';
import { loadLanguageOptions, type LanguageOption } from '../consent/languageOptions';
import { lengthText, whenText } from '../meetings/invite';
import { savedName, saveName } from '../setup/name';
import { clock } from './captions';
import CallView, { type CallSummary } from './CallView';
import Lobby from './Lobby';
import MeetIcon from './MeetIcon';
import { rememberCall } from './resume';
import { useLocalMedia } from './useLocalMedia';
import './meet.css';

export type MeetStart =
  | { kind: 'new' }
  | { kind: 'host'; meeting: HostedMeeting; invite: InviteDetails }
  | { kind: 'room'; invite: Invite }
  | { kind: 'guest'; invite: MeetingInvite }
  | { kind: 'resume'; conversation: Conversation };

interface MeetAppProps {
  start: MeetStart;
  defaultName: string;
  onConversation: (conversation: Conversation | null) => void;
  onStartOwn: () => void;
  onClose: () => void;
}

const LANGUAGE_KEY = 'voice-translator-meet-language';
const END_HEADINGS = {
  left: 'You left the meeting',
  'host-ended': 'The meeting has ended',
  dropped: 'The call was cut off',
  closed: 'You are no longer in this call',
} as const;
const WAIT_MS = 4_000;
const MAX_NAME = 40;

function savedLanguage(): string {
  try {
    const saved = window.localStorage.getItem(LANGUAGE_KEY);
    if (saved) {
      return saved;
    }
  } catch {
    // fall through to the browser's language
  }
  const tag = navigator.languages?.[0] ?? navigator.language ?? 'en';
  return tag.toLowerCase().split(/[-_]/)[0] || 'en';
}

function saveLanguage(code: string): void {
  try {
    window.localStorage.setItem(LANGUAGE_KEY, code);
  } catch {
    return;
  }
}

function problemText(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail;
  }
  if (error instanceof TypeError) {
    return 'The server cannot be reached. Check your internet, then try again.';
  }
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

function meetingDetails(meeting: MeetingInfo): string {
  const agenda = meeting.agenda.trim() ? ` Agenda: ${meeting.agenda.trim().replace(/\s*\n\s*/g, '; ')}.` : '';
  return `${whenText(meeting)}, ${lengthText(meeting.duration_minutes)}, hosted by ${meeting.host_name}.${agenda}`;
}

interface LobbyInfo {
  title: string;
  heading: string;
  details: string | null;
  action: string;
  closed: boolean;
  problem: string | null;
}

function firstInfo(start: MeetStart): LobbyInfo {
  switch (start.kind) {
    case 'new':
      return {
        title: 'Meeting',
        heading: 'Start a meeting',
        details: 'Invite up to 3 people with a link. Everyone hears each other and reads live captions in their own language.',
        action: 'Start meeting',
        closed: false,
        problem: null,
      };
    case 'host':
      return {
        title: start.meeting.title,
        heading: start.meeting.title,
        details: meetingDetails(start.meeting),
        action: start.meeting.status === 'live' ? 'Rejoin' : 'Start meeting',
        closed: false,
        problem: null,
      };
    case 'resume':
      return {
        title: start.conversation.title ?? 'Meeting',
        heading: 'Go back into the call?',
        details: `${start.conversation.title ?? 'Your meeting'}. The page was reloaded while you were in this call; your place is kept for a little while.`,
        action: 'Rejoin',
        closed: false,
        problem: null,
      };
    default:
      return { title: 'Meeting', heading: 'Opening the invitation', details: null, action: 'Join now', closed: false, problem: null };
  }
}

export default function MeetApp({ start, defaultName, onConversation, onStartOwn, onClose }: MeetAppProps) {
  const local = useLocalMedia();
  const [info, setInfo] = useState<LobbyInfo>(() => firstInfo(start));
  const [name, setName] = useState(() => savedName() || defaultName);
  const [language, setLanguageState] = useState(savedLanguage);
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [summary, setSummary] = useState<CallSummary | null>(null);
  const [round, setRound] = useState(0);
  const waitTimerRef = useRef<number | null>(null);
  const runRef = useRef(0);

  useEffect(() => {
    loadLanguageOptions().then(setLanguages, () => setLanguages([]));
  }, []);

  useEffect(() => () => {
    runRef.current += 1;
    if (waitTimerRef.current !== null) {
      window.clearTimeout(waitTimerRef.current);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (start.kind === 'room') {
      getRoom(start.invite.roomId, start.invite.token).then((room) => {
        if (cancelled) {
          return;
        }
        const count = room.guests.length + 1;
        const full = count >= room.max_people;
        setInfo({
          title: `${room.host.name}'s meeting`,
          heading: full ? 'This call is full' : 'Ready to join?',
          details: `${room.host.name} invited you. ${count} ${count === 1 ? 'person is' : 'people are'} in the call.`,
          action: 'Join now',
          closed: full,
          problem: full ? `${room.max_people} people are already in it. Ask ${room.host.name} for a new link.` : null,
        });
      }, (error: unknown) => {
        if (!cancelled) {
          setInfo({ title: 'Meeting', heading: 'This link does not work', details: null, action: 'Join now', closed: true, problem: problemText(error) });
        }
      });
    } else if (start.kind === 'guest') {
      getMeeting(start.invite).then((meeting) => {
        if (cancelled) {
          return;
        }
        const over = meeting.status === 'ended';
        setInfo({
          title: meeting.title,
          heading: over ? 'This meeting is over' : meeting.title,
          details: meetingDetails(meeting),
          action: meeting.status === 'live' ? 'Join now' : 'Join when it starts',
          closed: over,
          problem: over ? `Ask ${meeting.host_name} for a new link.` : null,
        });
      }, (error: unknown) => {
        if (!cancelled) {
          setInfo({ title: 'Meeting', heading: 'This link does not work', details: null, action: 'Join now', closed: true, problem: problemText(error) });
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [start]);

  const enter = useCallback((next: Conversation) => {
    rememberCall(next);
    setConversation(next);
    setWaiting(null);
    setBusy(null);
    onConversation(next);
  }, [onConversation]);

  function changeLanguage(code: string): void {
    setLanguageState(code);
    saveLanguage(code);
  }

  async function join(): Promise<void> {
    runRef.current += 1;
    const run = runRef.current;
    const person = { name: name.trim().slice(0, MAX_NAME) || defaultName || 'Guest', preferred_language: language };
    saveName(person.name);
    saveLanguage(language);
    setProblem(null);
    setBusy(start.kind === 'new' || start.kind === 'host' ? 'Starting' : 'Joining');
    try {
      if (start.kind === 'resume') {
        enter(start.conversation);
      } else if (start.kind === 'new') {
        const room = await createRoom(person);
        if (run === runRef.current) {
          const invitation = { link: inviteLink(room, window.location.origin), problem: inviteProblem(room, window.location.hostname) };
          enter({ ...roomConversation(room, room.host_token, 'A', invitation), title: `${person.name}'s meeting` });
        }
      } else if (start.kind === 'host') {
        const room = await startMeeting({ meetingId: start.meeting.id, token: start.meeting.host_token }, person);
        if (run === runRef.current) {
          enter({ ...roomConversation(room, room.host_token, 'A', start.invite), title: start.meeting.title });
        }
      } else if (start.kind === 'room') {
        const joined = await joinRoom(start.invite.roomId, start.invite.token, person);
        if (run === runRef.current) {
          const base = window.location.origin.replace(/\/+$/, '');
          const link = `${base}/#join/${encodeURIComponent(start.invite.roomId)}/${encodeURIComponent(start.invite.token)}`;
          enter({ ...roomConversation(joined.room, joined.token, joined.you, { link, problem: null }), title: info.title });
        }
      } else {
        await joinScheduled(start.invite, person, run);
      }
    } catch (error) {
      if (run === runRef.current) {
        setBusy(null);
        setProblem(problemText(error));
      }
    }
  }

  async function joinScheduled(access: MeetingInvite, person: { name: string; preferred_language: string }, run: number): Promise<void> {
    waitTimerRef.current = null;
    try {
      const joined = await joinMeeting(access, person);
      if (run === runRef.current) {
        const link = meetingLink(access.meetingId, access.token, null, window.location.origin);
        enter({ ...roomConversation(joined.room, joined.token, joined.you, { link, problem: null }), title: info.title });
      }
    } catch (error) {
      if (run !== runRef.current) {
        return;
      }
      if (error instanceof ApiError && error.status === 409 && /not started/.test(error.detail)) {
        setBusy(null);
        setWaiting('Waiting for the host to start the meeting. You join the moment it starts.');
        waitTimerRef.current = window.setTimeout(() => void joinScheduled(access, person, run), WAIT_MS);
        return;
      }
      throw error;
    }
  }

  function stopWaiting(): void {
    runRef.current += 1;
    if (waitTimerRef.current !== null) {
      window.clearTimeout(waitTimerRef.current);
      waitTimerRef.current = null;
    }
    setWaiting(null);
  }

  const stopMedia = local.stop;
  const ended = useCallback((result: CallSummary) => {
    rememberCall(null);
    setSummary(result);
    onConversation(null);
    stopMedia();
  }, [onConversation, stopMedia]);

  if (summary) {
    const { end } = summary;
    return (
      <div className="meet meet-ended">
        <div className="meet-ended-card">
          <span className="meet-ended-mark" aria-hidden="true"><MeetIcon name="leave" /></span>
          <h1>{END_HEADINGS[end.reason]}</h1>
          {end.reason !== 'left' && <p>{end.text}</p>}
          <p className="meet-ended-facts">
            {conversation?.title ?? info.title}, {clock(0, summary.seconds * 1000)} long.
            {summary.recorded ? ' Your recording is in your Downloads folder.' : ''}
          </p>
          <div className="meet-ended-actions">
            {end.reason === 'dropped' && conversation && (
              <button className="meet-pill meet-pill-strong" type="button" onClick={() => {
                rememberCall(conversation);
                setSummary(null);
                setRound((current) => current + 1);
                onConversation(conversation);
                void local.retry();
              }}>
                Rejoin
              </button>
            )}
            <button className="meet-pill" type="button" onClick={onStartOwn}>Start a new meeting</button>
            <button className="meet-pill" type="button" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  if (conversation) {
    return (
      <div className="meet">
        <CallView
          key={`${conversation.id}/${round}`}
          conversation={conversation}
          local={local}
          languages={languages}
          title={conversation.title ?? info.title}
          onLanguage={changeLanguage}
          onEnded={ended}
        />
      </div>
    );
  }

  return (
    <div className="meet">
      <Lobby
        local={local}
        heading={info.heading}
        details={info.details}
        name={name}
        language={language}
        languages={languages}
        action={info.action}
        busy={busy}
        waiting={waiting}
        problem={problem ?? info.problem}
        closed={info.closed}
        onName={setName}
        onLanguage={changeLanguage}
        onJoin={() => void join()}
        onStopWaiting={stopWaiting}
        onStartOwn={onStartOwn}
        other={start.kind === 'resume' ? { label: 'Start a new meeting instead', run: () => {
          rememberCall(null);
          onStartOwn();
        } } : null}
      />
    </div>
  );
}
