interface RecognitionAlternative {
  readonly transcript: string;
}

interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: RecognitionAlternative;
}

interface RecognitionResults {
  readonly length: number;
  readonly [index: number]: RecognitionResult;
}

export interface RecognitionEvent {
  readonly resultIndex: number;
  readonly results: RecognitionResults;
}

export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

type RecognitionClass = new () => Recognition;

const RESTART_MS = 300;
const MAX_FAILED_STARTS = 5;
const STORAGE_KEY = 'voice-translator-live-words';
const GIVE_UP = new Set(['not-allowed', 'service-not-allowed', 'language-not-supported', 'audio-capture']);
const REGIONS: Record<string, string> = {
  ar: 'ar-SA',
  bn: 'bn-IN',
  de: 'de-DE',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  gu: 'gu-IN',
  hi: 'hi-IN',
  it: 'it-IT',
  ja: 'ja-JP',
  kn: 'kn-IN',
  ko: 'ko-KR',
  ml: 'ml-IN',
  mr: 'mr-IN',
  ne: 'ne-NP',
  or: 'or-IN',
  pa: 'pa-IN',
  pt: 'pt-BR',
  ru: 'ru-RU',
  ta: 'ta-IN',
  te: 'te-IN',
  tr: 'tr-TR',
  ur: 'ur-PK',
  vi: 'vi-VN',
  yue: 'yue-Hant-HK',
  zh: 'zh-CN',
};

export function recognitionClass(): RecognitionClass | null {
  const scope = globalThis as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function liveWordsSupported(): boolean {
  return recognitionClass() !== null;
}

export function speechTag(language: string, preferred: readonly string[] = globalThis.navigator?.languages ?? []): string {
  const own = preferred.find((tag) => tag.toLowerCase().startsWith(`${language.toLowerCase()}-`));
  return own ?? REGIONS[language] ?? language;
}

export function liveWordsWanted(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveLiveWordsWanted(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    return;
  }
}

export function wordsOf(event: RecognitionEvent): { text: string; final: boolean } {
  const parts: string[] = [];
  let final = true;
  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const result = event.results[index]!;
    parts.push(result[0]?.transcript ?? '');
    final = final && result.isFinal;
  }
  return { text: parts.join('').replace(/\s+/g, ' ').trim(), final };
}

export class LiveWords {
  private recognition: Recognition | null = null;
  private language: string;
  private paused = false;
  private stopped = false;
  private failedStarts = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly kind: RecognitionClass,
    language: string,
    private readonly onWords: (text: string, final: boolean) => void,
    private readonly onUnavailable: (reason: string) => void,
  ) {
    this.language = language;
    this.begin();
  }

  setLanguage(language: string): void {
    if (language === this.language) {
      return;
    }
    this.language = language;
    this.end();
    this.begin();
  }

  pause(): void {
    this.paused = true;
    this.end();
  }

  resume(): void {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    this.begin();
  }

  stop(): void {
    this.stopped = true;
    this.end();
  }

  private begin(): void {
    if (this.stopped || this.paused || this.recognition) {
      return;
    }
    const recognition = new this.kind();
    recognition.lang = speechTag(this.language);
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      this.failedStarts = 0;
      const { text, final } = wordsOf(event);
      this.onWords(text, final);
    };
    recognition.onerror = (event) => {
      if (GIVE_UP.has(event.error)) {
        this.stopped = true;
        this.onUnavailable(event.error);
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        this.failedStarts += 1;
      }
    };
    recognition.onend = () => {
      if (this.recognition !== recognition) {
        return;
      }
      this.recognition = null;
      if (this.failedStarts >= MAX_FAILED_STARTS) {
        this.stopped = true;
        this.onUnavailable('network');
        return;
      }
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.begin();
      }, RESTART_MS);
    };
    this.recognition = recognition;
    try {
      recognition.start();
    } catch {
      this.recognition = null;
      this.failedStarts += 1;
    }
  }

  private end(): void {
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
    }
  }
}

export function startLiveWords(
  language: string,
  onWords: (text: string, final: boolean) => void,
  onUnavailable: (reason: string) => void,
): LiveWords | null {
  const kind = recognitionClass();
  return kind ? new LiveWords(kind, language, onWords, onUnavailable) : null;
}
