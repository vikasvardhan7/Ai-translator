import { describe, expect, it } from 'vitest';

import { activeApp, clickTaskbar, close, EMPTY_DESK, fit, focus, isApp, minimize, move, open, toggleMaximize } from './windows';

const WIDE = { width: 1600, height: 900 };
const PHONE = { width: 390, height: 780 };

describe('desktop windows', () => {
  it('opens each app once, on top, and focuses it when opened again', () => {
    let desk = open(EMPTY_DESK, 'translator', WIDE);
    desk = open(desk, 'assistant', WIDE);
    expect(activeApp(desk)).toBe('assistant');

    desk = open(desk, 'translator', WIDE);
    expect(desk.windows).toHaveLength(2);
    expect(activeApp(desk)).toBe('translator');
  });

  it('cascades new windows inside the desktop', () => {
    let desk = open(EMPTY_DESK, 'privacy', WIDE);
    desk = open(desk, 'terms', WIDE);
    const [first, second] = desk.windows;
    expect(second.x - first.x).toBe(32);
    expect(first.x).toBeGreaterThanOrEqual(0);
    expect(first.y).toBeGreaterThanOrEqual(0);
  });

  it('minimizes, restores from the taskbar and closes', () => {
    let desk = open(EMPTY_DESK, 'assistant', WIDE);
    desk = clickTaskbar(desk, 'assistant', WIDE);
    expect(desk.windows[0].minimized).toBe(true);
    expect(activeApp(desk)).toBeNull();

    desk = clickTaskbar(desk, 'assistant', WIDE);
    expect(desk.windows[0].minimized).toBe(false);

    desk = close(desk, 'assistant');
    expect(desk.windows).toEqual([]);
  });

  it('brings a window behind others to the front from the taskbar instead of hiding it', () => {
    let desk = open(EMPTY_DESK, 'assistant', WIDE);
    desk = open(desk, 'help', WIDE);
    desk = clickTaskbar(desk, 'assistant', WIDE);
    expect(activeApp(desk)).toBe('assistant');
    expect(desk.windows.find((window) => window.app === 'assistant')?.minimized).toBe(false);
  });

  it('keeps a moved window reachable and leaves maximized when moved', () => {
    let desk = toggleMaximize(open(EMPTY_DESK, 'help', WIDE), 'help');
    expect(desk.windows[0].maximized).toBe(true);

    desk = move(desk, 'help', 5000, -300, WIDE);
    const [window] = desk.windows;
    expect(window.maximized).toBe(false);
    expect(window.x).toBe(WIDE.width - 96);
    expect(window.y).toBe(0);
  });

  it('fills a phone screen with every window', () => {
    const desk = open(EMPTY_DESK, 'translator', PHONE);
    expect(desk.windows[0].maximized).toBe(true);
    expect(fit(open(EMPTY_DESK, 'help', WIDE), PHONE).windows[0].maximized).toBe(true);
  });

  it('ignores focus and minimize for apps that are not open', () => {
    expect(focus(EMPTY_DESK, 'help')).toBe(EMPTY_DESK);
    expect(minimize(EMPTY_DESK, 'help')).toEqual(EMPTY_DESK);
    expect(isApp('help')).toBe(true);
    expect(isApp('files')).toBe(false);
  });
});
