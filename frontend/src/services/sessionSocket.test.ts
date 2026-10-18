import { describe, expect, it } from 'vitest';

import { shouldAcceptSequence } from './sessionSocket';

describe('shouldAcceptSequence', () => {
  it('accepts the next sequence value', () => {
    expect(shouldAcceptSequence(2, 1)).toBe(true);
  });

  it('rejects a duplicate or older sequence value', () => {
    expect(shouldAcceptSequence(2, 2)).toBe(false);
    expect(shouldAcceptSequence(1, 2)).toBe(false);
  });

  it('rejects a non-integer sequence value', () => {
    expect(shouldAcceptSequence(1.5, 1)).toBe(false);
  });
});
