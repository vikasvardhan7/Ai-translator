import { languageName } from '../../services/languageNames';
import type { VoicePlayer, VoiceStyle } from './voiceQueue';

const VOICE_LIST_WAIT_MS = 1_500;

function wavUrl(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

function primaryCode(tag: string): string {
  return tag.toLowerCase().replace(/_/g, '-').split('-')[0] ?? '';
}

function voicesFor<T extends { lang: string }>(voices: readonly T[], language: string): T[] {
  const code = primaryCode(language);
  const name = languageName(code);
  return voices.filter((voice) => {
    const voiceCode = primaryCode(voice.lang);
    return voiceCode === code || languageName(voiceCode) === name;
  });
}

export function pickVoice<T extends { lang: string; localService: boolean; voiceURI?: string }>(
  voices: readonly T[],
  language: string,
  preferred: string | null = null,
): T | null {
  const matches = voicesFor(voices, language);
  return matches.find((voice) => preferred !== null && voice.voiceURI === preferred)
    ?? matches.find((voice) => voice.localService)
    ?? matches[0]
    ?? null;
}

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const voices = speechSynthesis.getVoices();
  if (voices.length > 0) {
    return Promise.resolve(voices);
  }
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      speechSynthesis.removeEventListener('voiceschanged', done);
      resolve(speechSynthesis.getVoices());
    };
    const timer = setTimeout(done, VOICE_LIST_WAIT_MS);
    speechSynthesis.addEventListener('voiceschanged', done);
  });
}

export function unlockBrowserAudio(): void {
  const silence = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=');
  void silence.play().catch(() => undefined);
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.speak(new SpeechSynthesisUtterance(''));
  }
}

export interface BrowserVoice {
  id: string;
  name: string;
}

export async function browserVoicesFor(language: string): Promise<BrowserVoice[]> {
  if (typeof speechSynthesis === 'undefined') {
    return [];
  }
  return voicesFor(await loadVoices(), language).map((voice) => ({ id: voice.voiceURI, name: voice.name }));
}

export function createBrowserVoicePlayer(): VoicePlayer {
  let audio: HTMLAudioElement | null = null;
  let utterance: SpeechSynthesisUtterance | null = null;
  let interrupt: (() => void) | null = null;
  let stops = 0;

  return {
    playWav(base64, onStart, rate = 1) {
      return new Promise<void>((resolve, reject) => {
        const url = wavUrl(base64);
        const element = new Audio(url);
        element.playbackRate = rate;
        let done = false;
        const finish = (error?: Error): void => {
          if (done) {
            return;
          }
          done = true;
          URL.revokeObjectURL(url);
          if (audio === element) {
            audio = null;
          }
          if (interrupt === stopThis) {
            interrupt = null;
          }
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        };
        const stopThis = (): void => {
          element.pause();
          finish();
        };
        audio = element;
        interrupt = stopThis;
        element.onended = () => finish();
        element.onerror = () => finish(new Error('The voice could not be played.'));
        element.play().then(
          () => {
            if (!done) {
              onStart();
            }
          },
          () => finish(new Error('The voice could not be played.')),
        );
      });
    },

    async speak(text, language, onStart, style?: VoiceStyle) {
      if (typeof speechSynthesis === 'undefined') {
        return false;
      }
      const ticket = stops;
      const voice = pickVoice(await loadVoices(), language, style?.browserVoice ?? null);
      if (ticket !== stops) {
        return true;
      }
      if (!voice) {
        return false;
      }
      return new Promise<boolean>((resolve) => {
        const current = new SpeechSynthesisUtterance(text);
        current.voice = voice;
        current.lang = voice.lang;
        current.rate = style?.rate ?? 1;
        let done = false;
        const finish = (): void => {
          if (done) {
            return;
          }
          done = true;
          if (utterance === current) {
            utterance = null;
          }
          if (interrupt === stopThis) {
            interrupt = null;
          }
          resolve(true);
        };
        const stopThis = (): void => {
          speechSynthesis.cancel();
          finish();
        };
        utterance = current;
        interrupt = stopThis;
        current.onend = finish;
        current.onerror = finish;
        onStart();
        speechSynthesis.speak(current);
      });
    },

    stop() {
      stops += 1;
      const stopCurrent = interrupt;
      interrupt = null;
      if (stopCurrent) {
        stopCurrent();
      } else if (typeof speechSynthesis !== 'undefined') {
        speechSynthesis.cancel();
      }
    },
  };
}
