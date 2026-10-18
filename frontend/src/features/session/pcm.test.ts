import { describe, expect, it } from 'vitest';

import {
  downsampleTo16k,
  floatTo16BitPCM,
  PcmFrameBuilder,
  rmsLevel,
} from './pcm';

describe('PCM helpers', () => {
  it('averages a 48 kHz input into the expected 16 kHz sample count', () => {
    const input = Float32Array.from({ length: 4_800 }, (_, index) => Math.sin((2 * Math.PI * index) / 40));

    expect(downsampleTo16k(input, 48_000)).toHaveLength(1_600);
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
});
