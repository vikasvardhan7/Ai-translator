import { describe, expect, it } from 'vitest';

import { passwordProblem } from './passwords';

describe('new passwords', () => {
  it('needs eight characters, not the email, typed the same twice', () => {
    expect(passwordProblem('short', 'short', 'a@b.co')).toContain('at least 8');
    expect(passwordProblem('A@B.co   ', 'A@B.co   ', 'a@b.co')).toContain('not your email');
    expect(passwordProblem('long enough', 'long enougH', 'a@b.co')).toContain('not the same');
    expect(passwordProblem('long enough', 'long enough', 'a@b.co')).toBe('');
  });
});
