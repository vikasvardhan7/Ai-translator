import { describe, expect, it } from 'vitest';

import { PhraseDetector, wavFromPcm } from './phrase';

function frame(amplitude: number): ArrayBuffer {
  const samples = new Int16Array(1_600);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.round(amplitude * Math.sin((2 * Math.PI * 220 * index) / 16_000));
  }
  return samples.buffer;
}

function feed(detector: PhraseDetector, amplitude: number, count: number): void {
  for (let index = 0; index < count; index += 1) {
    detector.add(frame(amplitude));
  }
}

describe('PhraseDetector', () => {
  it('ends a phrase after a short silence and keeps the moment before it', () => {
    const detector = new PhraseDetector();
    feed(detector, 0, 5);
    feed(detector, 6_000, 10);
    feed(detector, 0, 8);

    expect(detector.state).toBe('done');
    expect(detector.wav().byteLength).toBe(44 + (3 + 10 + 8) * 3_200);
  });

  it('gives up when nobody speaks', () => {
    const detector = new PhraseDetector();
    feed(detector, 0, 50);

    expect(detector.state).toBe('silent');
  });

  it('ignores a click and keeps waiting for speech', () => {
    const detector = new PhraseDetector();
    feed(detector, 0, 4);
    feed(detector, 6_000, 1);
    feed(detector, 0, 8);
    expect(detector.state).toBe('waiting');

    feed(detector, 6_000, 5);
    feed(detector, 0, 8);
    expect(detector.state).toBe('done');
    expect(detector.wav().byteLength).toBe(44 + (3 + 5 + 8) * 3_200);
  });

  it('gives late speech its full time', () => {
    const detector = new PhraseDetector();
    feed(detector, 0, 40);
    feed(detector, 6_000, 30);

    expect(detector.state).toBe('speaking');
  });

  it('hears speech over steady background noise', () => {
    const detector = new PhraseDetector();
    feed(detector, 400, 5);
    feed(detector, 500, 3);
    expect(detector.state).toBe('waiting');

    feed(detector, 6_000, 5);
    feed(detector, 400, 8);
    expect(detector.state).toBe('done');
  });

  it('stops a phrase that runs too long', () => {
    const detector = new PhraseDetector();
    feed(detector, 0, 3);
    feed(detector, 6_000, 60);

    expect(detector.state).toBe('done');
  });

  it('can be finished early when the person is done', () => {
    const detector = new PhraseDetector();
    feed(detector, 0, 3);
    feed(detector, 6_000, 4);

    expect(detector.finish()).toBe('done');
  });
});

describe('wavFromPcm', () => {
  it('writes a 16 kHz mono 16-bit WAV header', () => {
    const wav = new DataView(wavFromPcm([new ArrayBuffer(3_200)]));
    const text = (offset: number) => String.fromCharCode(...new Uint8Array(wav.buffer, offset, 4));

    expect([text(0), text(8), text(12), text(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(wav.getUint32(24, true)).toBe(16_000);
    expect(wav.getUint16(22, true)).toBe(1);
    expect(wav.getUint16(34, true)).toBe(16);
    expect(wav.getUint32(40, true)).toBe(3_200);
  });
});
