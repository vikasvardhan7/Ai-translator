import { describe, expect, it, vi } from 'vitest';

import { history, MAX_HISTORY, note, possibleActions, runActions } from './agent';
import { blocks, inline } from './markdown';

function handlers() {
  return { open: vi.fn(), close: vi.fn(), start: vi.fn() };
}

describe('assistant actions', () => {
  it('runs desktop and call actions it is allowed to and says what it did', () => {
    const desktop = handlers();
    const call = { available: ['mute' as const], run: vi.fn() };

    const done = runActions([
      { name: 'open_app', arguments: { app: 'help' } },
      { name: 'mute', arguments: {} },
      { name: 'end_conversation', arguments: {} },
      { name: 'open_app', arguments: { app: 'files' } },
      { name: 'start_conversation', arguments: { where: 'meeting' } },
    ], desktop, call);

    expect(desktop.open).toHaveBeenCalledWith('help');
    expect(call.run).toHaveBeenCalledWith('mute', {});
    expect(call.run).toHaveBeenCalledTimes(1);
    expect(desktop.start).toHaveBeenCalledWith('meeting');
    expect(done).toEqual([
      'Opened Help',
      'Muted your microphone',
      "Ready to start meeting captions: press I agree, let's start",
    ]);
  });

  it('describes language changes and subtitle downloads', () => {
    expect(note({ name: 'set_my_language', arguments: { language: 'te' } })).toMatch(/^Your language is now /);
    expect(note({ name: 'download_transcript', arguments: { format: 'subtitles' } })).toBe('Downloaded the subtitles');
    expect(note({ name: 'unknown', arguments: {} })).toBe('');
  });

  it('offers starting a conversation only when none is running', () => {
    const call = { available: ['mute' as const], run: vi.fn() };
    expect(possibleActions(false, null)).toEqual(['open_app', 'close_app', 'start_conversation']);
    expect(possibleActions(true, call)).toEqual(['open_app', 'close_app', 'mute']);
  });

  it('sends only the latest trimmed chat turns', () => {
    const turns = Array.from({ length: MAX_HISTORY + 4 }, (_, index) => ({ role: 'user' as const, text: ` ${index} ` }));
    const kept = history([...turns, { role: 'assistant', text: '   ' }]);
    expect(kept).toHaveLength(MAX_HISTORY);
    expect(kept[0].text).toBe('4');
  });
});

describe('assistant answers', () => {
  it('turns lists, bold words and links into blocks', () => {
    expect(blocks('## Summary\n**Budget** is next week.\n\n- one\n- two\n1. first\n2) second')).toEqual([
      { kind: 'paragraph', parts: [{ kind: 'text', text: 'Summary\n' }, { kind: 'bold', text: 'Budget' }, { kind: 'text', text: ' is next week.' }] },
      { kind: 'list', ordered: false, items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two' }]] },
      { kind: 'list', ordered: true, items: [[{ kind: 'text', text: 'first' }], [{ kind: 'text', text: 'second' }]] },
    ]);
  });

  it('links only https addresses', () => {
    expect(inline('See [docs](https://a.example/x) or https://b.example and javascript:alert(1)')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', text: 'docs', url: 'https://a.example/x' },
      { kind: 'text', text: ' or ' },
      { kind: 'link', text: 'https://b.example', url: 'https://b.example' },
      { kind: 'text', text: ' and javascript:alert(1)' },
    ]);
  });
});
