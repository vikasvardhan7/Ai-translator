const TARGET_SAMPLE_RATE = 16_000;
const PCM_FRAME_SAMPLES = 1_600;
const LEFTOVER_EPSILON = 1e-6;

export class StreamingPcmResampler {
  private readonly inputStep: number;
  private inputPosition = 0;
  private outputPosition = 0;
  private weightedSample = 0;
  private coveredInput = 0;

  constructor(inputRate: number) {
    if (!Number.isFinite(inputRate) || inputRate <= 0) {
      throw new Error('The input sample rate must be a positive number.');
    }
    this.inputStep = inputRate / TARGET_SAMPLE_RATE;
  }

  process(input: Float32Array): Float32Array {
    const output: number[] = [];

    for (const sample of input) {
      const sampleEnd = this.inputPosition + 1;
      let position = Math.max(this.inputPosition, this.outputPosition);

      while (position < sampleEnd) {
        const outputEnd = this.outputPosition + this.inputStep;
        const intervalEnd = Math.min(sampleEnd, outputEnd);
        const overlap = intervalEnd - position;

        this.weightedSample += sample * overlap;
        this.coveredInput += overlap;
        position = intervalEnd;

        if (position >= outputEnd - 1e-9) {
          output.push(this.weightedSample / this.inputStep);
          this.outputPosition = outputEnd;
          this.weightedSample = 0;
          this.coveredInput = 0;
          position = Math.max(position, this.outputPosition);
        }
      }

      this.inputPosition = sampleEnd;
    }

    return Float32Array.from(output);
  }

  flush(): Float32Array {
    if (this.coveredInput < LEFTOVER_EPSILON) {
      this.weightedSample = 0;
      this.coveredInput = 0;
      return new Float32Array(0);
    }
    const lastSample = this.weightedSample / this.coveredInput;
    this.outputPosition += this.inputStep;
    this.weightedSample = 0;
    this.coveredInput = 0;
    return Float32Array.of(lastSample);
  }
}

export function floatTo16BitPCM(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const clipped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    pcm[index] = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
  }
  return pcm;
}

function encodePcmFrame(samples: Float32Array): ArrayBuffer {
  const pcm = floatTo16BitPCM(samples);
  const frame = new ArrayBuffer(pcm.length * 2);
  const view = new DataView(frame);
  pcm.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return frame;
}

export class PcmFrameBuilder {
  private pending = new Float32Array(0);

  push(samples: Float32Array): ArrayBuffer[] {
    const combined = new Float32Array(this.pending.length + samples.length);
    combined.set(this.pending);
    combined.set(samples, this.pending.length);

    const frames: ArrayBuffer[] = [];
    let offset = 0;
    while (offset + PCM_FRAME_SAMPLES <= combined.length) {
      frames.push(encodePcmFrame(combined.subarray(offset, offset + PCM_FRAME_SAMPLES)));
      offset += PCM_FRAME_SAMPLES;
    }
    this.pending = combined.slice(offset);
    return frames;
  }

  flush(): ArrayBuffer | null {
    if (this.pending.length === 0) {
      return null;
    }
    const frame = encodePcmFrame(this.pending);
    this.pending = new Float32Array(0);
    return frame;
  }
}

export function rmsLevel(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let sumOfSquares = 0;
  for (const sample of samples) {
    sumOfSquares += sample * sample;
  }
  return Math.min(1, Math.sqrt(sumOfSquares / samples.length));
}

export function tagFrame(source: 'A' | 'B', frame: ArrayBuffer): ArrayBuffer {
  const tagged = new Uint8Array(frame.byteLength + 1);
  tagged[0] = source.charCodeAt(0);
  tagged.set(new Uint8Array(frame), 1);
  return tagged.buffer;
}
