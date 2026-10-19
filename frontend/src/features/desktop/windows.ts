export const APPS = ['translator', 'assistant', 'help', 'privacy', 'terms'] as const;
export type AppId = (typeof APPS)[number];

export interface WindowState {
  app: AppId;
  minimized: boolean;
  maximized: boolean;
  x: number;
  y: number;
  z: number;
}

export interface Desk {
  windows: WindowState[];
  nextZ: number;
}

export interface Area {
  width: number;
  height: number;
}

export const NARROW_WIDTH = 760;
const CASCADE = 32;
const MIN_VISIBLE = 96;

export const SIZES: Record<AppId, { width: number; height: number }> = {
  translator: { width: 1080, height: 760 },
  assistant: { width: 560, height: 680 },
  help: { width: 640, height: 620 },
  privacy: { width: 680, height: 620 },
  terms: { width: 680, height: 620 },
};

export const EMPTY_DESK: Desk = { windows: [], nextZ: 1 };

export function isApp(value: unknown): value is AppId {
  return typeof value === 'string' && (APPS as readonly string[]).includes(value);
}

export function windowSize(app: AppId, area: Area): { width: number; height: number } {
  const size = SIZES[app];
  return { width: Math.min(size.width, area.width - 24), height: Math.min(size.height, area.height - 24) };
}

function placed(desk: Desk, app: AppId, area: Area): { x: number; y: number } {
  const size = windowSize(app, area);
  const centre = { x: Math.max(12, (area.width - size.width) / 2), y: Math.max(12, (area.height - size.height) / 2) };
  const shift = (desk.windows.length % 5) * CASCADE;
  return clamp({ x: centre.x + shift, y: centre.y + shift }, size.width, area);
}

function clamp(position: { x: number; y: number }, width: number, area: Area): { x: number; y: number } {
  return {
    x: Math.round(Math.min(Math.max(position.x, MIN_VISIBLE - width), area.width - MIN_VISIBLE)),
    y: Math.round(Math.min(Math.max(position.y, 0), area.height - 48)),
  };
}

function change(desk: Desk, app: AppId, update: (window: WindowState) => WindowState): Desk {
  return { ...desk, windows: desk.windows.map((window) => (window.app === app ? update(window) : window)) };
}

export function focus(desk: Desk, app: AppId): Desk {
  if (!desk.windows.some((window) => window.app === app)) {
    return desk;
  }
  return { ...change(desk, app, (window) => ({ ...window, minimized: false, z: desk.nextZ })), nextZ: desk.nextZ + 1 };
}

export function open(desk: Desk, app: AppId, area: Area): Desk {
  if (desk.windows.some((window) => window.app === app)) {
    return focus(desk, app);
  }
  const position = placed(desk, app, area);
  const fresh: WindowState = { app, minimized: false, maximized: area.width < NARROW_WIDTH, ...position, z: desk.nextZ };
  return { windows: [...desk.windows, fresh], nextZ: desk.nextZ + 1 };
}

export function close(desk: Desk, app: AppId): Desk {
  return { ...desk, windows: desk.windows.filter((window) => window.app !== app) };
}

export function minimize(desk: Desk, app: AppId): Desk {
  return change(desk, app, (window) => ({ ...window, minimized: true }));
}

export function toggleMaximize(desk: Desk, app: AppId): Desk {
  return focus(change(desk, app, (window) => ({ ...window, maximized: !window.maximized })), app);
}

export function move(desk: Desk, app: AppId, x: number, y: number, area: Area): Desk {
  const width = windowSize(app, area).width;
  return change(desk, app, (window) => ({ ...window, ...clamp({ x, y }, width, area), maximized: false }));
}

export function fit(desk: Desk, area: Area): Desk {
  return {
    ...desk,
    windows: desk.windows.map((window) => ({
      ...window,
      ...clamp(window, windowSize(window.app, area).width, area),
      maximized: window.maximized || area.width < NARROW_WIDTH,
    })),
  };
}

export function activeApp(desk: Desk): AppId | null {
  const shown = desk.windows.filter((window) => !window.minimized);
  if (shown.length === 0) {
    return null;
  }
  return shown.reduce((top, window) => (window.z > top.z ? window : top)).app;
}

export function clickTaskbar(desk: Desk, app: AppId, area: Area): Desk {
  const window = desk.windows.find((item) => item.app === app);
  if (window && !window.minimized && activeApp(desk) === app) {
    return minimize(desk, app);
  }
  return open(desk, app, area);
}
