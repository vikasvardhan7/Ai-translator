import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserVoicePlayer, pickVoice } from './voicePlayer';

const voice = (lang: string, localService = false) => ({ lang, localService });

describe('pickVoice', () => {
  it('prefers a voice on this computer for the language', () => {
    const voices = [voice('en-US'), voice('te-IN'), voice('en-GB', true)];

    expect(pickVoice(voices, 'en')).toEqual(voice('en-GB', true));
    expect(pickVoice(voices, 'te')).toEqual(voice('te-IN'));
  });

  it('matches a three-letter code to a two-letter voice of the same language', () => {
    expect(pickVoice([voice('te-IN')], 'tel')).toEqual(voice('te-IN'));
  });

  it('finds nothing when no voice speaks the language', () => {
    expect(pickVoice([voice('en-US')], 'ta')).toBeNull();
  });
});

describe('browser voice player', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does not speak a sentence stopped while the voice list was loading', async () => {
    vi.useFakeTimers();
    const spoken: string[] = [];
    const synthesis = Object.assign(new EventTarget(), {
      getVoices: () => [],
      speak: (utterance: { text: string }) => spoken.push(utterance.text),
      cancel: () => undefined,
    });
    vi.stubGlobal('speechSynthesis', synthesis);
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      constructor(readonly text: string) {}
    });
    const player = createBrowserVoicePlayer();
    const started = vi.fn();

    const result = player.speak('Hello', 'en', started);
    player.stop();
    vi.advanceTimersByTime(2_000);

    await expect(result).resolves.toBe(true);
    expect(spoken).toEqual([]);
    expect(started).not.toHaveBeenCalled();
  });
});
