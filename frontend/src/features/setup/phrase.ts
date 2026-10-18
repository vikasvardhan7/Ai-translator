const SAMPLE_RATE = 16_000;
const MIN_SPEECH_RMS = 200;
const NOISE_MARGIN = 3;
const CALIBRATION_FRAMES = 3;
const PRE_ROLL_FRAMES = 3;
const MIN_SPEECH_FRAMES = 3;
const END_SILENT_FRAMES = 8;
const MAX_FRAMES = 60;
const NO_SPEECH_FRAMES = 50;

type PhraseState = 'waiting' | 'speaking' | 'done' | 'silent';

function frameLoudness(frame: ArrayBuffer): number {
  const samples = new Int16Array(frame);
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
}

export class PhraseDetector {
  private readonly preRoll: ArrayBuffer[] = [];
  private readonly frames: ArrayBuffer[] = [];
  private noiseFloor: number | null = null;
  private seen = 0;
  private sinceSpeech = 0;
  private spoken = 0;
  private silent = 0;
  state: PhraseState = 'waiting';

  add(frame: ArrayBuffer): PhraseState {
    if (this.state === 'done' || this.state === 'silent') {
      return this.state;
    }
    this.seen += 1;
    const level = frameLoudness(frame);
    const calibrating = this.seen <= CALIBRATION_FRAMES;
    const speech = !calibrating && level >= Math.max(MIN_SPEECH_RMS, (this.noiseFloor ?? 0) * NOISE_MARGIN);
    if (this.state === 'waiting') {
      if (speech) {
        this.state = 'speaking';
        this.frames.push(...this.preRoll, frame);
        this.spoken = 1;
        this.silent = 0;
        this.sinceSpeech = 1;
      } else {
        this.noiseFloor = this.noiseFloor === null ? level : Math.min(this.noiseFloor, level);
        this.preRoll.push(frame);
        if (this.preRoll.length > PRE_ROLL_FRAMES) {
          this.preRoll.shift();
        }
        if (this.seen >= NO_SPEECH_FRAMES) {
          this.state = 'silent';
        }
      }
      return this.state;
    }
    this.frames.push(frame);
    this.sinceSpeech += 1;
    if (speech) {
      this.spoken += 1;
      this.silent = 0;
    } else {
      this.silent += 1;
    }
    if (this.silent >= END_SILENT_FRAMES && this.spoken < MIN_SPEECH_FRAMES) {
      this.state = 'waiting';
      this.frames.length = 0;
      this.spoken = 0;
    } else if (this.silent >= END_SILENT_FRAMES || this.sinceSpeech >= MAX_FRAMES) {
      this.state = 'done';
    }
    if (this.state === 'waiting' && this.seen >= NO_SPEECH_FRAMES) {
      this.state = 'silent';
    }
    return this.state;
  }

  finish(): PhraseState {
    if (this.state === 'speaking' || this.state === 'waiting') {
      this.state = this.spoken >= MIN_SPEECH_FRAMES ? 'done' : 'silent';
    }
    return this.state;
  }

  wav(): ArrayBuffer {
    return wavFromPcm(this.frames);
  }
}

export function wavFromPcm(frames: readonly ArrayBuffer[]): ArrayBuffer {
  const dataBytes = frames.reduce((total, frame) => total + frame.byteLength, 0);
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const text = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  const bytes = new Uint8Array(buffer);
  let offset = 44;
  for (const frame of frames) {
    bytes.set(new Uint8Array(frame), offset);
    offset += frame.byteLength;
  }
  return buffer;
}
