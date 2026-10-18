import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SpeakerId } from '../../services/protocol';
import { VoiceQueue, type VoicePlayer } from './voiceQueue';

class FakePlayer implements VoicePlayer {
  played: string[] = [];
  voices = new Set(['en', 'te']);
  failWav = false;
  private finish: (() => void) | null = null;


  playWav(base64: string, onStart: () => void): Promise<void> {
    this.played.push(`wav:${base64}`);
    if (this.failWav) {
      return Promise.reject(new Error('blocked'));
    }
    onStart();
    return new Promise((resolve) => {
      this.finish = resolve;
    });
  }

  speak(text: string, language: string, onStart: () => void): Promise<boolean> {
    if (!this.voices.has(language)) {
      return Promise.resolve(false);
    }
    this.played.push(`say:${language}:${text}`);
    onStart();
    return new Promise((resolve) => {
      this.finish = () => resolve(true);
    });
  }

  stop(): void {
    this.end();
  }

  end(): void {
    const finish = this.finish;
    this.finish = null;
    finish?.();
  }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

describe('VoiceQueue', () => {
  let player: FakePlayer;
  let speaking: (SpeakerId | null)[];
  let noVoice: string[];
  let queue: VoiceQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    player = new FakePlayer();
    speaking = [];
    noVoice = [];
    queue = new VoiceQueue(player, (id) => speaking.push(id), (language) => noVoice.push(language), 1_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('plays server voices one at a time in sentence order', async () => {
    queue.setServerVoice(true);
    queue.expect('u1', 'A', 'Hello', 'en');
    queue.expect('u2', 'B', 'Bagunnara', 'te');
    queue.audio('u2', 'B', 'second');
    await settle();
    expect(player.played).toEqual([]);

    queue.audio('u1', 'A', 'first');
    await settle();
    expect(player.played).toEqual(['wav:first']);

    player.end();
    await settle();
    expect(player.played).toEqual(['wav:first', 'wav:second']);
    player.end();
    await settle();
    expect(speaking).toEqual(['A', 'B', null]);
  });

  it('uses the browser voice when the server has no voice', async () => {
    queue.expect('u1', 'A', 'Hello', 'en');
    await settle();

    expect(player.played).toEqual(['say:en:Hello']);
  });

  it('falls back to the browser voice when a server voice fails or never comes', async () => {
    queue.setServerVoice(true);
    queue.expect('u1', 'A', 'Hello', 'en');
    queue.expect('u2', 'A', 'Again', 'en');
    queue.unavailable('u1', 'A');
    await settle();
    player.end();
    await settle();
    vi.advanceTimersByTime(1_000);
    await settle();

    expect(player.played).toEqual(['say:en:Hello', 'say:en:Again']);
  });

  it('plays a voice shared by both listeners once', async () => {
    queue.setServerVoice(true);
    queue.expect('u1', 'A', 'Hello', 'en');
    queue.expect('u1', 'B', 'Hello', 'en');
    queue.audio('u1', 'A', 'same');
    queue.audio('u1', 'B', 'same');
    await settle();
    player.end();
    await settle();

    expect(player.played).toEqual(['wav:same']);
    expect(speaking.at(-1)).toBeNull();
  });

  it('speaks with the browser voice when a server voice cannot be played', async () => {
    queue.setServerVoice(true);
    player.failWav = true;
    queue.expect('u1', 'A', 'Hello', 'en');
    queue.audio('u1', 'A', 'broken');
    await settle();

    expect(player.played).toEqual(['wav:broken', 'say:en:Hello']);
  });

  it('skips a person whose voice is switched off, even mid-sentence', async () => {
    queue.expect('u1', 'A', 'Hello', 'en');
    await settle();
    queue.setEnabled('A', false);
    queue.expect('u2', 'A', 'Again', 'en');
    queue.expect('u3', 'B', 'Bagunnara', 'te');
    await settle();

    expect(player.played).toEqual(['say:en:Hello', 'say:te:Bagunnara']);
  });

  it('reports a language with no voice once and carries on', async () => {
    queue.expect('u1', 'A', 'Salut', 'fr');
    queue.expect('u2', 'A', 'Encore', 'fr');
    queue.expect('u3', 'B', 'Bagunnara', 'te');
    await settle();

    expect(noVoice).toEqual(['fr']);
    expect(player.played).toEqual(['say:te:Bagunnara']);
  });

  it('stops everything at once and can start again', async () => {
    queue.expect('u1', 'A', 'Hello', 'en');
    queue.expect('u2', 'A', 'Again', 'en');
    await settle();
    queue.cancelAll();
    await settle();
    expect(speaking.at(-1)).toBeNull();

    queue.expect('u3', 'A', 'Fresh', 'en');
    await settle();
    expect(player.played).toEqual(['say:en:Hello', 'say:en:Fresh']);
  });

  it('never pauses listening for a sentence nobody can hear', async () => {
    player.voices.clear();
    queue.expect('u1', 'B', 'Bagunnara', 'te');
    await settle();

    expect(speaking).toEqual([]);
    expect(noVoice).toEqual(['te']);
  });

  it('pauses once across back-to-back voices for the same person', async () => {
    queue.expect('u1', 'A', 'Hello', 'en');
    queue.expect('u2', 'A', 'Again', 'en');
    await settle();
    player.end();
    await settle();
    player.end();
    await settle();

    expect(speaking).toEqual(['A', null]);
  });

  it('stops a voice that never finishes', async () => {
    queue.expect('u1', 'A', 'Hello', 'en');
    queue.expect('u2', 'A', 'Again', 'en');
    await settle();
    vi.advanceTimersByTime(60_000);
    await settle();

    expect(player.played).toEqual(['say:en:Hello', 'say:en:Again']);
  });

  it('still plays a shared voice for the other person when one turns voice off', async () => {
    queue.setServerVoice(true);
    queue.expect('u1', 'A', 'Hello', 'en');
    queue.expect('u1', 'B', 'Hello', 'en');
    queue.audio('u1', 'A', 'same');
    queue.audio('u1', 'B', 'same');
    await settle();
    queue.setEnabled('A', false);
    await settle();

    expect(player.played).toEqual(['wav:same', 'wav:same']);
  });
});
