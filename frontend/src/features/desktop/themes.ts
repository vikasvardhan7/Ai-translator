export const THEMES = ['ocean', 'sunset', 'mint', 'blossom', 'aurora'] as const;
export type ThemeId = (typeof THEMES)[number];
export type Particles = 'bubbles' | 'leaves' | 'petals' | 'stars';

export interface Theme {
  id: ThemeId;
  name: string;
  description: string;
  particles: Particles;
}

export const THEME_LIST: Theme[] = [
  { id: 'ocean', name: 'Ocean', description: 'Sky blue with rolling waves. Follows light or dark mode.', particles: 'bubbles' },
  { id: 'sunset', name: 'Sunset', description: 'Warm coral and peach with rising bubbles.', particles: 'bubbles' },
  { id: 'mint', name: 'Mint', description: 'Fresh green and teal with drifting leaves.', particles: 'leaves' },
  { id: 'blossom', name: 'Blossom', description: 'Soft pink and lilac with falling petals.', particles: 'petals' },
  { id: 'aurora', name: 'Aurora night', description: 'Deep night with glowing aurora and twinkling stars.', particles: 'stars' },
];

const THEME_KEY = 'voice-translator-theme';
const CALM_KEY = 'voice-translator-calm';
const PARTICLE_COUNT = 18;

export function isTheme(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

export function themeOf(id: ThemeId): Theme {
  return THEME_LIST.find((theme) => theme.id === id) ?? THEME_LIST[0]!;
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    return;
  }
}

export function savedTheme(): ThemeId {
  const value = read(THEME_KEY);
  return isTheme(value) ? value : 'ocean';
}

export function savedCalm(): boolean {
  return read(CALM_KEY) === 'true';
}

export function saveLook(theme: ThemeId, calm: boolean): void {
  write(THEME_KEY, theme);
  write(CALM_KEY, String(calm));
}

export function applyLook(theme: ThemeId, calm: boolean): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.calm = String(calm);
}

export interface Particle {
  left: number;
  size: number;
  delay: number;
  duration: number;
  drift: number;
}

export function particles(count: number = PARTICLE_COUNT): Particle[] {
  return Array.from({ length: count }, (_, index) => {
    const step = (index * 37) % 100;
    return {
      left: (index * 53 + 7) % 100,
      size: 8 + ((index * 29) % 22),
      delay: -((index * 1.7) % 14),
      duration: 12 + (step % 14),
      drift: ((index * 41) % 60) - 30,
    };
  });
}
