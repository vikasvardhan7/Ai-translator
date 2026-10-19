import type { MeetingInfo } from '../../services/api';

const MINUTE = 60_000;

export interface Invitation {
  meeting: MeetingInfo;
  link: string;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function localIso(at: Date = new Date()): string {
  const offset = -at.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const hours = pad(Math.floor(Math.abs(offset) / 60));
  const minutes = pad(Math.abs(offset) % 60);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}${sign}${hours}:${minutes}`;
}

export function endsAt(meeting: MeetingInfo): Date {
  return new Date(Date.parse(meeting.starts_at) + meeting.duration_minutes * MINUTE);
}

export function lengthText(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function whenText(meeting: MeetingInfo, locale?: string): string {
  const start = new Date(meeting.starts_at);
  const day = start.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = (at: Date): string => at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time(start)} – ${time(endsAt(meeting))}`;
}

export function countdown(meeting: MeetingInfo, now: number): string {
  if (meeting.status === 'live') {
    return 'Live now';
  }
  const start = Date.parse(meeting.starts_at);
  if (now >= endsAt(meeting).getTime()) {
    return 'Ended';
  }
  if (now >= start) {
    return 'Starting time: waiting for the host';
  }
  const minutes = Math.ceil((start - now) / MINUTE);
  if (minutes < 60) {
    return `Starts in ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Starts in ${hours} h ${minutes % 60} min`;
  }
  const days = Math.floor(hours / 24);
  return `Starts in ${days} ${days === 1 ? 'day' : 'days'}`;
}

export function inviteText({ meeting, link }: Invitation, locale?: string): string {
  const lines = [
    `${meeting.host_name} invites you to a translated meeting: ${meeting.title}`,
    `When: ${whenText(meeting, locale)} (${lengthText(meeting.duration_minutes)})`,
  ];
  if (meeting.agenda.trim()) {
    lines.push('', 'Agenda:', meeting.agenda.trim());
  }
  lines.push(
    '',
    `Join: ${link}`,
    '',
    'Open the link in Chrome or Edge, type your name and say hello. Everyone hears the others in their own language.',
  );
  return lines.join('\n');
}

export function mailtoUrl(invitation: Invitation, locale?: string): string {
  const subject = encodeURIComponent(`Invitation: ${invitation.meeting.title}`);
  const body = encodeURIComponent(inviteText(invitation, locale));
  return `mailto:?subject=${subject}&body=${body}`;
}

function icsTime(at: Date): string {
  return at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function fold(line: string): string {
  const parts: string[] = [];
  for (let index = 0; index < line.length; index += 72) {
    parts.push(line.slice(index, index + 72));
  }
  return parts.join('\r\n ');
}

export function calendarFile({ meeting, link }: Invitation, now: Date = new Date()): string {
  const description = [meeting.agenda.trim(), `Join: ${link}`].filter(Boolean).join('\n\n');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Voice Translator//Meetings//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${meeting.id}@voice-translator`,
    `DTSTAMP:${icsTime(now)}`,
    `DTSTART:${icsTime(new Date(meeting.starts_at))}`,
    `DTEND:${icsTime(endsAt(meeting))}`,
    `SUMMARY:${icsText(meeting.title)}`,
    `DESCRIPTION:${icsText(description)}`,
    `URL:${link}`,
    `ORGANIZER;CN=${icsText(meeting.host_name)}:mailto:noreply@invalid`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].map(fold).join('\r\n');
}

export function defaultStart(now: Date = new Date()): { date: string; time: string } {
  const start = new Date(now.getTime() + 60 * MINUTE);
  start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0);
  return {
    date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    time: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
  };
}

export function startFrom(date: string, time: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !clock) {
    return null;
  }
  const at = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(clock[1]), Number(clock[2]));
  return Number.isNaN(at.getTime()) ? null : localIso(at);
}
