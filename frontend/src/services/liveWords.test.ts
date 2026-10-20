import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveWords, speechTag, startLiveWords, wordsOf, type Recognition, type RecognitionEvent } from './liveWords';

class FakeRecognition implements Recognition {
  static made: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((event: RecognitionEvent) => void) | null = null;
  onerror: ((event: { readonly error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  aborted = 0;

  constructor() {
    FakeRecognition.made.push(this);
  }

  start(): void {
    this.started += 1;
  }

  abort(): void {
    this.aborted += 1;
  }

  hear(parts: Array<[string, boolean]>, from = 0): void {
    const results = parts.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal }));
    this.onresult?.({ resultIndex: from, results });
  }
}

function latest(): FakeRecognition {
  return FakeRecognition.made.at(-1)!;
}

describe('words while they are spoken', () => {
  beforeEach(() => {
    FakeRecognition.made = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('listens continuously in the speaker\'s language and passes on the words', () => {
    const heard: Array<[string, boolean]> = [];
    new LiveWords(FakeRecognition, 'te', (text, final) => heard.push([text, final]), () => undefined);

    const recognition = latest();
    recognition.hear([['మీరు  ఎలా', false]]);
    recognition.hear([['మీరు ఎలా ఉన్నారు', true]]);

    expect([recognition.lang, recognition.continuous, recognition.interimResults, recognition.started]).toEqual(['te-IN', true, true, 1]);
    expect(heard).toEqual([['మీరు ఎలా', false], ['మీరు ఎలా ఉన్నారు', true]]);
  });

  it('starts again by itself when the browser stops listening', () => {
    new LiveWords(FakeRecognition, 'en', () => undefined, () => undefined);

    latest().onend?.();
    vi.advanceTimersByTime(300);

    expect(FakeRecognition.made).toHaveLength(2);
    expect(latest().started).toBe(1);
  });

  it('gives up and says why when the browser refuses', () => {
    const reasons: string[] = [];
    new LiveWords(FakeRecognition, 'en', () => undefined, (reason) => reasons.push(reason));

    latest().onerror?.({ error: 'not-allowed' });
    latest().onend?.();
    vi.advanceTimersByTime(1_000);

    expect(reasons).toEqual(['not-allowed']);
    expect(FakeRecognition.made).toHaveLength(1);
  });

  it('gives up after the speech service keeps failing', () => {
    const reasons: string[] = [];
    new LiveWords(FakeRecognition, 'en', () => undefined, (reason) => reasons.push(reason));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      latest().onerror?.({ error: 'network' });
      latest().onend?.();
      vi.advanceTimersByTime(300);
    }

    expect(reasons).toEqual(['network']);
    expect(FakeRecognition.made).toHaveLength(5);
  });

  it('pauses while the app speaks and switches language', () => {
    const words = new LiveWords(FakeRecognition, 'te', () => undefined, () => undefined);
    const first = latest();

    words.pause();
    words.resume();
    const second = latest();
    words.setLanguage('hi');
    const third = latest();
    words.stop();

    expect([first.aborted, second.aborted, third.aborted]).toEqual([1, 1, 1]);
    expect([second.lang, third.lang]).toEqual(['te-IN', 'hi-IN']);
    expect(FakeRecognition.made).toHaveLength(3);
  });

  it('is not offered where the browser cannot recognise speech', () => {
    expect(startLiveWords('en', () => undefined, () => undefined)).toBeNull();
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    expect(startLiveWords('en', () => undefined, () => undefined)).toBeInstanceOf(LiveWords);
  });
});

describe('speech language tags', () => {
  it('prefers the browser\'s own region, then a common one, then the code', () => {
    expect(speechTag('en', ['en-IN', 'te-IN'])).toBe('en-IN');
    expect(speechTag('te', ['en-GB'])).toBe('te-IN');
    expect(speechTag('sw', [])).toBe('sw');
  });

  it('joins the words still being heard', () => {
    const results = [
      Object.assign([{ transcript: 'Done. ' }], { isFinal: true }),
      Object.assign([{ transcript: 'How are' }], { isFinal: false }),
    ];

    expect(wordsOf({ resultIndex: 1, results })).toEqual({ text: 'How are', final: false });
    expect(wordsOf({ resultIndex: 0, results })).toEqual({ text: 'Done. How are', final: false });
  });
});
