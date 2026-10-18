import { describe, expect, it } from 'vitest';

import { parseServerMessage } from './protocol';

describe('parseServerMessage', () => {
  it('parses a valid session.ready message', () => {
    expect(parseServerMessage(JSON.stringify({
      type: 'session.ready',
      seq: 1,
      session_id: 'session-1',
      participants: [
        { id: 'A', name: 'Person A', preferred_language: 'en' },
        { id: 'B', name: 'Person B', preferred_language: 'te' },
      ],
    }))).toEqual({
      type: 'session.ready',
      seq: 1,
      session_id: 'session-1',
      participants: [
        { id: 'A', name: 'Person A', preferred_language: 'en' },
        { id: 'B', name: 'Person B', preferred_language: 'te' },
      ],
    });
  });

  it('returns null for an unknown message type', () => {
    expect(parseServerMessage('{"type":"something.new","seq":1}')).toBeNull();
  });

  it('returns null for broken JSON', () => {
    expect(parseServerMessage('{')).toBeNull();
  });

  it('returns null when required message fields are missing', () => {
    expect(parseServerMessage('{"type":"error","seq":1,"code":"invalid_message"}')).toBeNull();
  });
});
