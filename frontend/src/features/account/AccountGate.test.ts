import { describe, expect, it } from 'vitest';

import { isInviteLink } from './AccountGate';

describe('invite links', () => {
  it('are recognised so the sign-in screen can say a call is waiting', () => {
    expect(isInviteLink('#join/r1/t1')).toBe(true);
    expect(isInviteLink('#meet/m1/t1')).toBe(true);
    expect(isInviteLink('#privacy')).toBe(false);
    expect(isInviteLink('')).toBe(false);
  });
});
