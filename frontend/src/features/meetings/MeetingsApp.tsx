import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import {
  ApiError,
  cancelMeeting,
  listMeetings,
  scheduleMeeting,
  type HostedMeeting,
  type MeetingPlan,
  type PublicLink,
} from '../../services/api';
import { linkProblem, meetingLink, type InviteDetails } from '../../services/conversations';
import { saveFile } from '../session/download';
import { savedName, saveName } from '../setup/name';
import { calendarFile, countdown, defaultStart, inviteText, lengthText, mailtoUrl, startFrom, whenText } from './invite';

export interface PlanRequest {
  id: number;
  plan: Omit<MeetingPlan, 'host_name'>;
}

interface MeetingsAppProps {
  request: PlanRequest | null;
  onRequestTaken: () => void;
  onStart: (meeting: HostedMeeting, invite: InviteDetails) => void;
}

const LENGTHS = [15, 30, 45, 60, 90, 120, 180, 240];
const REFRESH_MS = 8_000;
const TICK_MS = 15_000;

function problemText(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail;
  }
  if (error instanceof TypeError) {
    return 'The backend cannot be reached. Check that it is running.';
  }
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

interface CardProps {
  meeting: HostedMeeting;
  invite: InviteDetails;
  fresh: boolean;
  now: number;
  onStart: () => void;
  onCancel: () => void;
}

function MeetingCard({ meeting, invite, fresh, now, onStart, onCancel }: CardProps) {
  const [done, setDone] = useState('');
  const [confirming, setConfirming] = useState(false);
  const invitation = { meeting, link: invite.link };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const live = meeting.status === 'live';

  async function copy(text: string, what: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setDone(`${what} copied`);
    } catch {
      setDone('Copying is blocked here. Select the link and copy it.');
    }
  }

  function share(): void {
    void navigator.share({ title: meeting.title, text: inviteText(invitation), url: invite.link }).catch(() => undefined);
  }

  function calendar(): void {
    const name = `${meeting.title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'meeting'}.ics`;
    saveFile(name, calendarFile(invitation), 'text/calendar;charset=utf-8', false);
    setDone('Calendar invite downloaded');
  }

  return (
    <li className="meeting-card" data-fresh={fresh} data-live={live}>
      <header className="meeting-card-top">
        <div>
          <h4 dir="auto">{meeting.title}</h4>
          <p className="meeting-when">{whenText(meeting)} · {lengthText(meeting.duration_minutes)} · host {meeting.host_name}</p>
        </div>
        <span className="meeting-badge" data-status={meeting.status}>
          {live ? `Live · ${meeting.people} in` : countdown(meeting, now)}
        </span>
      </header>
      {meeting.agenda.trim() && <p className="meeting-agenda" dir="auto">{meeting.agenda}</p>}
      <div className="invite-row">
        <label className="visually-hidden" htmlFor={`link-${meeting.id}`}>Join link for {meeting.title}</label>
        <input
          id={`link-${meeting.id}`}
          className="text-input invite-link"
          readOnly
          value={invite.link}
          onFocus={(event) => event.currentTarget.select()}
        />
      </div>
      {invite.problem && <p className="invite-warning" role="note">{invite.problem}</p>}
      <div className="meeting-actions">
        <button className="button button-primary" type="button" onClick={onStart} disabled={meeting.status === 'ended' && !live}>
          {live ? 'Rejoin' : 'Start meeting'}
        </button>
        <button className="button button-secondary button-small" type="button" onClick={() => void copy(invite.link, 'Link')}>
          Copy link
        </button>
        <button className="button button-secondary button-small" type="button" onClick={() => void copy(inviteText(invitation), 'Invitation')}>
          Copy invitation
        </button>
        <a className="button button-secondary button-small" href={mailtoUrl(invitation)}>
          Email
        </a>
        {canShare && (
          <button className="button button-secondary button-small" type="button" onClick={share}>
            Share
          </button>
        )}
        <button className="button button-secondary button-small" type="button" onClick={calendar}>
          Add to calendar
        </button>
        {confirming ? (
          <>
            <button className="button button-small meeting-cancel" type="button" onClick={onCancel}>
              Yes, cancel it
            </button>
            <button className="button button-link" type="button" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="button button-link" type="button" onClick={() => setConfirming(true)}>
            Cancel meeting
          </button>
        )}
      </div>
      <p className="meeting-done" role="status">{done}</p>
    </li>
  );
}

export default function MeetingsApp({ request, onRequestTaken, onStart }: MeetingsAppProps) {
  const first = defaultStart();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(first.date);
  const [time, setTime] = useState(first.time);
  const [length, setLength] = useState(30);
  const [agenda, setAgenda] = useState('');
  const [host, setHost] = useState(savedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [meetings, setMeetings] = useState<HostedMeeting[] | null>(null);
  const [link, setLink] = useState<PublicLink>({ public_url: null, public_url_problem: null });
  const [fresh, setFresh] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const found = await listMeetings();
      setMeetings(found.meetings);
      setLink({ public_url: found.public_url, public_url_problem: found.public_url_problem });
    } catch (problem) {
      setError(problemText(problem));
      setMeetings((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const reload = window.setInterval(() => void refresh(), REFRESH_MS);
    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      window.clearInterval(reload);
      window.clearInterval(tick);
    };
  }, [refresh]);

  const create = useCallback(async (plan: Omit<MeetingPlan, 'host_name'>, hostName: string) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const name = hostName.trim().slice(0, 40) || 'Host';
      saveName(name);
      const made = await scheduleMeeting({ ...plan, host_name: name });
      setFresh(made.id);
      setTitle('');
      setAgenda('');
      await refresh();
    } catch (problem) {
      setError(problemText(problem));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [refresh]);

  useEffect(() => {
    if (request && !busyRef.current) {
      onRequestTaken();
      void create(request.plan, host);
    }
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const starts = startFrom(date, time);
    if (!starts) {
      setError('Pick a date and a time.');
      return;
    }
    void create({ title: title.trim(), starts_at: starts, duration_minutes: length, agenda: agenda.trim() }, host);
  }

  function inviteFor(meeting: HostedMeeting): InviteDetails {
    return {
      link: meetingLink(meeting.id, meeting.invite_token, link.public_url, window.location.origin),
      problem: linkProblem(link.public_url, link.public_url_problem, window.location.hostname),
    };
  }

  async function cancel(meeting: HostedMeeting): Promise<void> {
    try {
      await cancelMeeting({ meetingId: meeting.id, token: meeting.host_token });
      await refresh();
    } catch (problem) {
      setError(problemText(problem));
    }
  }

  return (
    <div className="meetings-app">
      <form className="meeting-form" onSubmit={submit}>
        <h3>Schedule a meeting</h3>
        <label className="field-label" htmlFor="meeting-title">What is it called?</label>
        <input id="meeting-title" className="text-input" required maxLength={120} value={title} placeholder="Weekly sync" onChange={(event) => setTitle(event.target.value)} />
        <div className="meeting-form-row">
          <div>
            <label className="field-label" htmlFor="meeting-date">Date</label>
            <input id="meeting-date" className="text-input" type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="meeting-time">Time</label>
            <input id="meeting-time" className="text-input" type="time" required value={time} onChange={(event) => setTime(event.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="meeting-length">How long</label>
            <select id="meeting-length" className="text-input" value={length} onChange={(event) => setLength(Number(event.target.value))}>
              {LENGTHS.map((minutes) => <option key={minutes} value={minutes}>{lengthText(minutes)}</option>)}
            </select>
          </div>
        </div>
        <label className="field-label" htmlFor="meeting-agenda">What will you talk about? (agenda, optional)</label>
        <textarea id="meeting-agenda" className="text-input meeting-agenda-input" maxLength={2000} rows={4} value={agenda} placeholder="For example: Q4 numbers, hiring plan" onChange={(event) => setAgenda(event.target.value)} />
        <label className="field-label" htmlFor="meeting-host">Your name (shown on the invitation)</label>
        <input id="meeting-host" className="text-input" maxLength={40} value={host} placeholder="Host" onChange={(event) => setHost(event.target.value)} />
        {error && <p className="settings-error" role="alert">{error}</p>}
        <button className="button button-primary" type="submit" disabled={busy || !title.trim()} aria-busy={busy}>
          {busy ? 'Scheduling' : 'Schedule and get the link'}
        </button>
        <p className="meeting-note">
          Only the title, time, length, agenda and your name are kept, on this computer. People join through the link while
          this app is running here.
        </p>
      </form>
      <section className="meeting-list" aria-label="Upcoming meetings">
        <h3>Upcoming</h3>
        {meetings === null ? (
          <p className="meeting-empty" role="status">Loading</p>
        ) : meetings.length === 0 ? (
          <p className="meeting-empty">Nothing scheduled yet. Fill in the form, then send the link to everyone who should join.</p>
        ) : (
          <ol className="meeting-cards">
            {meetings.map((meeting) => (
              <MeetingCard
                key={meeting.id}
                meeting={meeting}
                invite={inviteFor(meeting)}
                fresh={meeting.id === fresh}
                now={now}
                onStart={() => onStart(meeting, inviteFor(meeting))}
                onCancel={() => void cancel(meeting)}
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
