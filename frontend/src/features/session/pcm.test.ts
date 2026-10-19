import { describe, expect, it } from 'vitest';

import {
  floatTo16BitPCM,
  PcmFrameBuilder,
  rmsLevel,
  StreamingPcmResampler,
  tagFrame,
} from './pcm';

describe('PCM helpers', () => {
  it('averages a 48 kHz input into the expected 16 kHz sample count', () => {
    const input = Float32Array.from({ length: 4_800 }, (_, index) => Math.sin((2 * Math.PI * index) / 40));

    const resampler = new StreamingPcmResampler(48_000);

    expect(resampler.process(input)).toHaveLength(1_600);
    expect(resampler.flush()).toHaveLength(0);
  });

  it('keeps the sample count exact when audio arrives in uneven blocks', () => {
    const resampler = new StreamingPcmResampler(44_100);
    let total = 0;
    for (const size of [128, 441, 1_000, 2_841]) {
      total += resampler.process(new Float32Array(size)).length;
    }

    expect(total + resampler.flush().length).toBe(1_600);
  });

  it('clamps samples and scales them to signed 16-bit values', () => {
    expect(Array.from(floatTo16BitPCM(Float32Array.of(-2, -1, 0, 1, 2))))
      .toEqual([-32_768, -32_768, 0, 32_767, 32_767]);
  });

  it('creates 100 ms frames of 3,200 bytes and flushes an even-sized remainder', () => {
    const builder = new PcmFrameBuilder();
    const frames = builder.push(new Float32Array(3_200));
    expect(frames).toHaveLength(2);
    expect(frames.map((frame) => frame.byteLength)).toEqual([3_200, 3_200]);
    expect(builder.flush()).toBeNull();

    builder.push(new Float32Array(1_501));
    expect(builder.flush()?.byteLength).toBe(3_002);
  });

  it('reports the real RMS amplitude of a block', () => {
    expect(rmsLevel(new Float32Array(0))).toBe(0);
    expect(rmsLevel(Float32Array.of(0.5, -0.5))).toBeCloseTo(0.5);
    expect(rmsLevel(Float32Array.of(2))).toBe(1);
  });

  it('puts the source letter in front of a frame for a meeting', () => {
    const frame = new Uint8Array([1, 2, 3, 4]).buffer;

    expect([...new Uint8Array(tagFrame('B', frame))]).toEqual([66, 1, 2, 3, 4]);
    expect([...new Uint8Array(tagFrame('A', frame))]).toEqual([65, 1, 2, 3, 4]);
  });
});
