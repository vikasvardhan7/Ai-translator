import { useSyncExternalStore } from 'react';

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallWay = 'installed' | 'button' | 'apple' | 'menu';

export interface InstallDevice {
  standalone: boolean;
  prompt: boolean;
  apple: boolean;
}

export const INSTALL_STEPS: Record<Exclude<InstallWay, 'installed'>, string> = {
  button: 'Put Voice Translator on this device as an app. It gets its own icon and window, opens straight to your desktop and updates by itself.',
  apple: 'On iPhone or iPad, open this page in Safari, tap the Share button, then Add to Home Screen. It then opens from its own icon like any other app.',
  menu: 'In Chrome or Edge, choose the install icon at the right of the address bar, or open the browser menu and choose Install app or Add to Home screen. On iPhone or iPad, open this page in Safari, tap Share, then Add to Home Screen.',
};

export function installWay({ standalone, prompt, apple }: InstallDevice): InstallWay {
  if (standalone) {
    return 'installed';
  }
  if (prompt) {
    return 'button';
  }
  return apple ? 'apple' : 'menu';
}

export function isAppleTouch(userAgent: string, platform: string, touchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && touchPoints > 1);
}

let waiting: InstallPrompt | null = null;
let installedNow = false;
let current: InstallWay = 'menu';
const listeners = new Set<() => void>();

function standalone(): boolean {
  return (
    installedNow
    || window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function refresh(): void {
  current = installWay({
    standalone: standalone(),
    prompt: waiting !== null,
    apple: isAppleTouch(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
  });
  listeners.forEach((listener) => listener());
}

export function startInstall(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    waiting = event as InstallPrompt;
    refresh();
  });
  window.addEventListener('appinstalled', () => {
    waiting = null;
    installedNow = true;
    refresh();
  });
  refresh();
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    });
  }
}

export async function askToInstall(): Promise<boolean> {
  const prompt = waiting;
  if (!prompt) {
    return false;
  }
  waiting = null;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  refresh();
  return outcome === 'accepted';
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInstallWay(): InstallWay {
  return useSyncExternalStore(subscribe, () => current, () => 'menu');
}
