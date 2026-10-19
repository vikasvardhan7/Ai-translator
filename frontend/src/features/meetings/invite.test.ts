import { describe, expect, it } from 'vitest';

import type { MeetingInfo } from '../../services/api';
import { calendarFile, countdown, defaultStart, inviteText, lengthText, localIso, mailtoUrl, startFrom } from './invite';

const meeting: MeetingInfo = {
  id: 'm1',
  title: 'Budget, Q4; review',
  starts_at: '2026-10-20T11:30:00+00:00',
  duration_minutes: 45,
  agenda: 'Numbers\nHiring',
  host_name: 'Vikas',
  status: 'upcoming',
  people: 0,
};
const link = 'https://quiet-river.trycloudflare.com/#meet/m1/abc';
const start = Date.parse(meeting.starts_at);

describe('meeting invitations', () => {
  it('counts down to the meeting and says when it is live or over', () => {
    expect(countdown(meeting, start - 25 * 60_000)).toBe('Starts in 25 min');
    expect(countdown(meeting, start - 125 * 60_000)).toBe('Starts in 2 h 5 min');
    expect(countdown(meeting, start - 3 * 24 * 3_600_000)).toBe('Starts in 3 days');
    expect(countdown(meeting, start + 60_000)).toBe('Starting time: waiting for the host');
    expect(countdown(meeting, start + 50 * 60_000)).toBe('Ended');
    expect(countdown({ ...meeting, status: 'live' }, start - 60_000)).toBe('Live now');
  });

  it('writes an invitation with the time, length, agenda and link', () => {
    const text = inviteText({ meeting, link }, 'en-GB');
    expect(text).toContain('Vikas invites you to a translated meeting: Budget, Q4; review');
    expect(text).toContain('(45 min)');
    expect(text).toContain('Agenda:\nNumbers\nHiring');
    expect(text).toContain(`Join: ${link}`);
    expect(inviteText({ meeting: { ...meeting, agenda: ' ' }, link })).not.toContain('Agenda');
  });

  it('opens a ready email in the mail app', () => {
    const url = mailtoUrl({ meeting, link });
    expect(url.startsWith('mailto:?subject=Invitation%3A%20Budget')).toBe(true);
    expect(decodeURIComponent(url.split('&body=')[1]!)).toContain(link);
  });

  it('makes a calendar invite any calendar can open', () => {
    const file = calendarFile({ meeting, link }, new Date('2026-10-19T10:00:00Z'));
    const unfolded = file.replace(/\r\n /g, '');
    expect(unfolded).toContain('DTSTART:20261020T113000Z');
    expect(unfolded).toContain('DTEND:20261020T121500Z');
    expect(unfolded).toContain('SUMMARY:Budget\\, Q4\; review');
    expect(unfolded).toContain(`DESCRIPTION:Numbers\\nHiring\\n\\nJoin: ${link}`);
    expect(file.split('\r\n').every((line) => line.length <= 73)).toBe(true);
  });

  it('turns the form date and time into a local time with its offset', () => {
    const iso = startFrom('2026-10-20', '17:00');
    expect(iso).toMatch(/^2026-10-20T17:00:00[+-]\d{2}:\d{2}$/);
    expect(new Date(iso!).getHours()).toBe(17);
    expect(startFrom('20/10/2026', '17:00')).toBeNull();
    expect(localIso(new Date(2026, 0, 2, 3, 4, 5))).toMatch(/^2026-01-02T03:04:05[+-]\d{2}:\d{2}$/);
  });

  it('suggests the next half hour, an hour from now', () => {
    expect(defaultStart(new Date(2026, 9, 19, 22, 10))).toEqual({ date: '2026-10-19', time: '23:30' });
    expect(defaultStart(new Date(2026, 9, 19, 22, 40))).toEqual({ date: '2026-10-20', time: '00:00' });
    expect(lengthText(90)).toBe('1 h 30 min');
    expect(lengthText(120)).toBe('2 h');
  });
});
