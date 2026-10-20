import { describe, expect, it } from 'vitest';

import { KEY_PLACEHOLDER, sessionSnippet, streamAddress, usedShare, widgetSnippet } from './snippets';

describe('developer snippets', () => {
  it('builds the one-line widget with the key', () => {
    expect(widgetSnippet('https://a.example', 'vt_abc')).toBe(
      '<script src="https://a.example/widget.js" data-key="vt_abc" async></script>',
    );
    expect(widgetSnippet('https://a.example')).toContain(KEY_PLACEHOLDER);
  });

  it('shows how a server starts a conversation', () => {
    const snippet = sessionSnippet('https://a.example', 'vt_abc');

    expect(snippet).toContain('curl -X POST https://a.example/api/sessions');
    expect(snippet).toContain('-H "X-Api-Key: vt_abc"');
    const body = /-d '(.+)'$/.exec(snippet)?.[1];
    expect(JSON.parse(body!)).toMatchObject({ consent: true });
  });

  it('turns the web address into the live channel address', () => {
    expect(streamAddress('https://a.example')).toBe('wss://a.example/api/sessions/SESSION_ID/stream');
    expect(streamAddress('http://localhost:8000')).toBe('ws://localhost:8000/api/sessions/SESSION_ID/stream');
  });

  it.each([
    [0, 1000, 0],
    [250, 1000, 25],
    [1000, 1000, 100],
    [1500, 1000, 100],
    [1, 0, 100],
  ])('%i of %i is %i%% used', (used, limit, share) => {
    expect(usedShare(used, limit)).toBe(share);
  });
});
