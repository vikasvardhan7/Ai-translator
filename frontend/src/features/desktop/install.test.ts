import { describe, expect, it } from 'vitest';

import manifestText from '../../../public/manifest.webmanifest?raw';
import { INSTALL_STEPS, installWay, isAppleTouch } from './install';

const PUBLIC_FILES = new Set(
  Object.keys(import.meta.glob('../../../public/**/*')).map((path) => path.replace('../../../public', '')),
);

interface ManifestIcon {
  src: string;
  sizes: string;
  purpose?: string;
}

describe('installing the app', () => {
  it('offers the browser button when there is one, steps for iPhone otherwise', () => {
    expect(installWay({ standalone: true, prompt: true, apple: false })).toBe('installed');
    expect(installWay({ standalone: false, prompt: true, apple: false })).toBe('button');
    expect(installWay({ standalone: false, prompt: false, apple: true })).toBe('apple');
    expect(installWay({ standalone: false, prompt: false, apple: false })).toBe('menu');
    expect(INSTALL_STEPS.apple).toContain('Add to Home Screen');
  });

  it('knows iPhones and iPads, including iPads that say they are Macs', () => {
    expect(isAppleTouch('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5)).toBe(true);
    expect(isAppleTouch('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe(true);
    expect(isAppleTouch('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0)).toBe(false);
    expect(isAppleTouch('Mozilla/5.0 (Linux; Android 15; Pixel 9)', 'Linux armv8l', 5)).toBe(false);
  });

  it('describes an installable app whose icons all exist', () => {
    const manifest = JSON.parse(manifestText) as {
      name: string;
      short_name: string;
      start_url: string;
      scope: string;
      display: string;
      icons: ManifestIcon[];
      shortcuts: Array<{ url: string; icons: ManifestIcon[] }>;
    };
    expect(manifest.name).toBe('Voice Translator');
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    const files = [...manifest.icons, ...manifest.shortcuts.flatMap((shortcut) => shortcut.icons)].map((icon) => icon.src);
    for (const file of [...files, '/icons/apple-touch-icon.png', '/icons/icon.svg', '/offline.html', '/sw.js']) {
      expect(PUBLIC_FILES.has(file), file).toBe(true);
    }
    expect(manifest.shortcuts.map((shortcut) => shortcut.url)).toEqual(['/#trainer', '/#meetings']);
  });
});
