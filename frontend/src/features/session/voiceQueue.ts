import type { SpeakerId } from '../../services/protocol';

const VOICE_WAIT_MS = 20_000;
const HOLD_LIMIT_MS = 15_000;
const PLAY_LIMIT_BASE_MS = 10_000;
const PLAY_LIMIT_PER_CHARACTER_MS = 150;

export interface VoiceStyle {
  rate: number;
  browserVoice: string | null;
}

export interface VoicePlayer {
  playWav(base64: string, onStart: () => void, rate?: number): Promise<void>;
  speak(text: string, language: string, onStart: () => void, style?: VoiceStyle): Promise<boolean>;
  stop(): void;
}

const DEFAULT_STYLE: VoiceStyle = { rate: 1, browserVoice: null };

type SlotState = 'waiting' | 'audio' | 'speech' | 'skip';

interface Slot {
  utteranceId: string;
  listenerId: SpeakerId;
  text: string;
  language: string;
  state: SlotState;
  audio?: string;
  timer?: ReturnType<typeof setTimeout>;
}

export class VoiceQueue {
  private slots: Slot[] = [];
  private serverVoice = false;
  private readonly enabled: Record<SpeakerId, boolean> = { A: true, B: true };
  private readonly localVoice: Record<SpeakerId, boolean> = { A: false, B: false };
  private readonly styles: Record<SpeakerId, VoiceStyle> = { A: DEFAULT_STYLE, B: DEFAULT_STYLE };
  private held = false;
  private holdExpired = false;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly reportedNoVoice = new Set<string>();
  private current: Slot | null = null;
  private lastPlayed: { utteranceId: string; signature: string } | null = null;
  private speakingTo: SpeakerId | null = null;
  private generation = 0;
  private pumping: number | null = null;

  constructor(
    private readonly player: VoicePlayer,
    private readonly onSpeakingChange: (listenerId: SpeakerId | null) => void,
    private readonly onNoVoice: (language: string) => void,
    private readonly onPlayed: (utteranceId: string, listenerId: SpeakerId, seconds: number) => void = () => undefined,
    private readonly waitMs: number = VOICE_WAIT_MS,
    private readonly holdLimitMs: number = HOLD_LIMIT_MS,
  ) {}

  setServerVoice(on: boolean): void {
    this.serverVoice = on;
  }

  setStyle(listenerId: SpeakerId, style: VoiceStyle): void {
    this.styles[listenerId] = style;
  }

  setLocalVoice(listenerId: SpeakerId, on: boolean): void {
    this.localVoice[listenerId] = on;
    if (!on) {
      return;
    }
    for (const slot of this.slots) {
      if (slot.listenerId === listenerId && slot.state === 'waiting') {
        this.settle(slot, 'speech');
      }
    }
    void this.pump();
  }

  setHeld(on: boolean): void {
    if (on) {
      if (this.held || this.holdExpired) {
        return;
      }
      this.held = true;
      this.holdTimer = setTimeout(() => {
        this.held = false;
        this.holdExpired = true;
        void this.pump();
      }, this.holdLimitMs);
      return;
    }
    clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
    this.held = false;
    this.holdExpired = false;
    void this.pump();
  }

  setEnabled(listenerId: SpeakerId, on: boolean): void {
    this.enabled[listenerId] = on;
    if (on) {
      return;
    }
    for (const slot of this.slots) {
      if (slot.listenerId === listenerId && slot !== this.current) {
        this.settle(slot, 'skip');
      }
    }
    if (this.current?.listenerId === listenerId) {
      this.player.stop();
    }
    void this.pump();
  }

  expect(utteranceId: string, listenerId: SpeakerId, text: string, language: string): void {
    const state: SlotState = !this.enabled[listenerId]
      ? 'skip'
      : this.serverVoice && !this.localVoice[listenerId]
        ? 'waiting'
        : 'speech';
    const slot: Slot = { utteranceId, listenerId, text, language, state };
    if (state === 'waiting') {
      slot.timer = setTimeout(() => this.resolve(slot, 'speech'), this.waitMs);
    }
    this.slots.push(slot);
    void this.pump();
  }

  audio(utteranceId: string, listenerId: SpeakerId, base64: string): void {
    const slot = this.waitingSlot(utteranceId, listenerId);
    if (slot) {
      this.resolve(slot, 'audio', base64);
    }
  }

  unavailable(utteranceId: string, listenerId: SpeakerId): void {
    const slot = this.waitingSlot(utteranceId, listenerId);
    if (slot) {
      this.resolve(slot, 'speech');
    }
  }

  cancelAll(): void {
    this.generation += 1;
    clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
    this.held = false;
    this.holdExpired = false;
    for (const slot of this.slots) {
      clearTimeout(slot.timer);
    }
    this.slots = [];
    this.current = null;
    this.lastPlayed = null;
    this.player.stop();
    this.setSpeaking(null);
  }

  private waitingSlot(utteranceId: string, listenerId: SpeakerId): Slot | undefined {
    return this.slots.find(
      (slot) => slot.state === 'waiting' && slot.utteranceId === utteranceId && slot.listenerId === listenerId,
    );
  }

  private resolve(slot: Slot, state: 'audio' | 'speech', audio?: string): void {
    if (slot.state !== 'waiting') {
      return;
    }
    this.settle(slot, state);
    slot.audio = audio;
    void this.pump();
  }

  private settle(slot: Slot, state: SlotState): void {
    clearTimeout(slot.timer);
    slot.timer = undefined;
    slot.state = state;
  }

  private setSpeaking(listenerId: SpeakerId | null): void {
    if (this.speakingTo !== listenerId) {
      this.speakingTo = listenerId;
      this.onSpeakingChange(listenerId);
    }
  }

  private async pump(): Promise<void> {
    const generation = this.generation;
    if (this.pumping === generation) {
      return;
    }
    this.pumping = generation;
    try {
      for (let slot = this.slots[0]; slot && slot.state !== 'waiting' && !this.held; slot = this.slots[0]) {
        if (slot.state !== 'skip') {
          const signature = slot.state === 'audio' ? `audio:${slot.audio}` : `speech:${slot.language}:${slot.text}`;
          const repeated =
            this.lastPlayed?.utteranceId === slot.utteranceId && this.lastPlayed.signature === signature;
          if (!repeated) {
            this.current = slot;
            const listenerId = slot.listenerId;
            let startedAt: number | null = null;
            await this.play(slot, () => {
              if (generation === this.generation) {
                startedAt = Date.now();
                this.setSpeaking(listenerId);
              }
            });
            if (generation !== this.generation) {
              return;
            }
            this.current = null;
            if (this.enabled[listenerId]) {
              this.lastPlayed = { utteranceId: slot.utteranceId, signature };
            }
            if (startedAt !== null) {
              this.onPlayed(slot.utteranceId, listenerId, (Date.now() - startedAt) / 1_000);
            }
          }
        }
        this.slots.shift();
      }
      this.setSpeaking(null);
    } finally {
      if (this.pumping === generation) {
        this.pumping = null;
      }
    }
  }

  private async play(slot: Slot, onStart: () => void): Promise<void> {
    const watchdog = setTimeout(
      () => this.player.stop(),
      PLAY_LIMIT_BASE_MS + slot.text.length * PLAY_LIMIT_PER_CHARACTER_MS,
    );
    try {
      const style = this.styles[slot.listenerId];
      if (slot.state === 'audio' && slot.audio) {
        try {
          await this.player.playWav(slot.audio, onStart, style.rate);
          return;
        } catch {
          if (!this.enabled[slot.listenerId]) {
            return;
          }
        }
      }
      const spoken = await this.player.speak(slot.text, slot.language, onStart, style).catch(() => true);
      if (!spoken && !this.reportedNoVoice.has(slot.language)) {
        this.reportedNoVoice.add(slot.language);
        this.onNoVoice(slot.language);
      }
    } finally {
      clearTimeout(watchdog);
    }
  }
}
