import { describe, expect, it } from 'vitest';

import { firstApp } from './Desktop';

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
