import { afterEach, describe, expect, it, vi } from 'vitest';

import { isTheme, particles, savedCalm, savedTheme, saveLook, themeOf, THEME_LIST } from './themes';

function storage(values: Record<string, string> = {}) {
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value;
    },
  };
}

describe('themes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('remembers the chosen theme and motion, falling back to Ocean', () => {
    vi.stubGlobal('window', { localStorage: storage() });
    expect(savedTheme()).toBe('ocean');
    expect(savedCalm()).toBe(false);

    saveLook('aurora', true);
    expect(savedTheme()).toBe('aurora');
    expect(savedCalm()).toBe(true);
  });

  it('works when the browser blocks storage', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      },
    });
    expect(savedTheme()).toBe('ocean');
    expect(() => saveLook('mint', false)).not.toThrow();
  });

  it('knows every theme and makes the same particles every time', () => {
    expect(THEME_LIST.map((theme) => theme.id)).toEqual(['ocean', 'sunset', 'mint', 'blossom', 'aurora']);
    expect(isTheme('sunset')).toBe(true);
    expect(isTheme('neon')).toBe(false);
    expect(themeOf('aurora').particles).toBe('stars');
    const made = particles(5);
    expect(made).toEqual(particles(5));
    expect(made.every((item) => item.left >= 0 && item.left < 100 && item.size >= 8 && item.duration >= 12)).toBe(true);
  });
});
