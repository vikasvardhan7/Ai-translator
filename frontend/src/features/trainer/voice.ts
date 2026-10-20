import { recognitionClass, speechTag, wordsOf, type Recognition } from '../../services/liveWords';
import { loadVoices, pickVoice } from '../session/voicePlayer';

const LONGEST_PAUSE_MS = 4_000;
const MS_PER_LETTER = 90;
const VOICE_KEY = 'voice-translator-coach-voice';
const SPEECH_KEY = 'voice-translator-coach-speech';
const SCRIPTS: Array<[RegExp, string]> = [
  [/[ఀ-౿]/, 'te'],
  [/[ऀ-ॿ]/, 'hi'],
  [/[஀-௿]/, 'ta'],
  [/[ಀ-೿]/, 'kn'],
  [/[ഀ-ൿ]/, 'ml'],
  [/[ঀ-৿]/, 'bn'],
  [/[઀-૿]/, 'gu'],
  [/[਀-੿]/, 'pa'],
  [/[଀-୿]/, 'or'],
  [/[؀-ۿ]/, 'ar'],
  [/[぀-ヿ]/, 'ja'],
  [/[가-힯]/, 'ko'],
  [/[一-鿿]/, 'zh'],
  [/[Ѐ-ӿ]/, 'ru'],
];

export const SPEECH_LANGUAGES: Array<[string, string]> = [
  ['en', 'English'],
  ['hi', 'Hindi'],
  ['te', 'Telugu'],
  ['ta', 'Tamil'],
  ['kn', 'Kannada'],
  ['ml', 'Malayalam'],
  ['mr', 'Marathi'],
  ['bn', 'Bengali'],
  ['gu', 'Gujarati'],
  ['pa', 'Punjabi'],
];

function stored(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    return;
  }
}

export function voiceWanted(): boolean {
  return stored(VOICE_KEY) !== 'off';
}

export function saveVoiceWanted(on: boolean): void {
  store(VOICE_KEY, on ? 'on' : 'off');
}

export function speechLanguage(): string {
  const saved = stored(SPEECH_KEY);
  if (saved && SPEECH_LANGUAGES.some(([code]) => code === saved)) {
    return saved;
  }
  const own = (globalThis.navigator?.language ?? 'en').toLowerCase().split('-')[0] ?? 'en';
  return SPEECH_LANGUAGES.some(([code]) => code === own) ? own : 'en';
}

export function saveSpeechLanguage(code: string): void {
  store(SPEECH_KEY, code);
}

export function languageOfText(text: string, fallback = 'en'): string {
  return SCRIPTS.find(([pattern]) => pattern.test(text))?.[1] ?? fallback;
}

export function speakable(text: string): string {
  return text
    .replace(/\*\*|__|`|#+\s/g, '')
    .replace(/^\s*[-•*]\s+/gm, '')
    .replace(/(\d)\s*[-–]\s*(\d)/g, '$1 to $2')
    .replace(/(\d)\s*×\s*(\d)/g, '$1 by $2')
    .replace(/\bkcal\b/gi, 'calories')
    .replace(/(\d)\s*kg\b/gi, '$1 kilos')
    .replace(/(\d)\s*s\b/g, '$1 seconds')
    .replace(/(\d)\s*g\b/g, '$1 grams')
    .replace(/(\d)\s*ml\b/gi, '$1 millilitres')
    .replace(/\s+/g, ' ')
    .trim();
}

export function canSpeak(): boolean {
  return typeof globalThis.speechSynthesis !== 'undefined';
}

export function canListen(): boolean {
  return recognitionClass() !== null;
}

export function stopSpeaking(): void {
  if (canSpeak()) {
    speechSynthesis.cancel();
  }
}

export async function speak(text: string, language = languageOfText(text, speechLanguage())): Promise<void> {
  if (!canSpeak()) {
    return;
  }
  const words = speakable(text);
  if (!words) {
    return;
  }
  const voice = pickVoice(await loadVoices(), language);
  speechSynthesis.cancel();
  await new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(words);
    const longest = setTimeout(resolve, LONGEST_PAUSE_MS + words.length * MS_PER_LETTER);
    const done = (): void => {
      clearTimeout(longest);
      resolve();
    };
    utterance.lang = speechTag(language);
    if (voice) {
      utterance.voice = voice;
    }
    utterance.rate = 1.02;
    utterance.onend = done;
    utterance.onerror = done;
    speechSynthesis.speak(utterance);
  });
}

export interface Listening {
  stop: () => void;
}

export function listen(
  language: string,
  onWords: (text: string) => void,
  onDone: (text: string) => void,
  onProblem: (message: string) => void,
): Listening | null {
  const Kind = recognitionClass();
  if (!Kind) {
    onProblem('This browser cannot listen. Use Edge or Chrome, or type instead.');
    return null;
  }
  const recognition: Recognition = new Kind();
  let heard = '';
  let finished = false;
  recognition.lang = speechTag(language);
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    const { text } = wordsOf(event);
    if (text) {
      heard = text;
      onWords(text);
    }
  };
  recognition.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      onProblem('The microphone is blocked. Allow it in the browser, or type instead.');
    } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
      onProblem('Listening stopped. Try again, or type instead.');
    }
  };
  recognition.onend = () => {
    if (!finished) {
      finished = true;
      onDone(heard.trim());
    }
  };
  stopSpeaking();
  recognition.start();
  return {
    stop: () => {
      if (!finished) {
        recognition.onend = null;
        finished = true;
        recognition.abort();
        onDone(heard.trim());
      }
    },
  };
}
