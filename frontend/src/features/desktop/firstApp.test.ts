import { describe, expect, it } from 'vitest';

import { firstApp, startFromHash } from './Desktop';

describe('the desktop after signing in', () => {
  it('opens with no window unless the link names one', () => {
    expect(firstApp('')).toBeNull();
    expect(firstApp('#')).toBeNull();
    expect(firstApp('#translator')).toBeNull();
    expect(firstApp('#trainer')).toBe('trainer');
    expect(firstApp('#meetings')).toBe('meetings');
    expect(firstApp('#privacy')).toBe('privacy');
    expect(firstApp('#join/r1/t1')).toBe('translator');
    expect(firstApp('#meet/m1/t1')).toBe('translator');
  });
});

describe('links that open the meeting app', () => {
  it('joins a call or waits for a scheduled meeting', () => {
    expect(startFromHash('#join/room%201/tok')).toEqual({ kind: 'room', invite: { roomId: 'room 1', token: 'tok' } });
    expect(startFromHash('#meet/m1/t1')).toEqual({ kind: 'guest', invite: { meetingId: 'm1', token: 't1' } });
    expect(startFromHash('#trainer')).toBeNull();
  });
});
