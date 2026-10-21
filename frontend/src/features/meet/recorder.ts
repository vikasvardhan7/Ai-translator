import { initials } from './captions';

export interface RecordingTile {
  name: string;
  video: HTMLVideoElement | null;
  speaking: boolean;
  muted: boolean;
}

export interface RecordingCaption {
  name: string;
  text: string;
}

export interface RecordingScene {
  title: string;
  tiles: () => RecordingTile[];
  captions: () => RecordingCaption[];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const WIDTH = 1280;
const HEIGHT = 720;
const FRAMES_PER_SECOND = 24;
const TOP = 56;
const BOTTOM = 150;
const GAP = 12;
const STAGE = '#0e1726';
const TILE = '#172238';
const INK = '#eef3fb';
const DIM = '#9aa9c2';
const SAFFRON = '#f4b43c';
const RED = '#ef4e5a';
const FONT = "'Segoe UI', 'Nirmala UI', 'Noto Sans', system-ui, sans-serif";
const TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

export function recordingSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    'captureStream' in HTMLCanvasElement.prototype &&
    typeof AudioContext !== 'undefined'
  );
}

export function recordingType(supported: (type: string) => boolean): string {
  return TYPES.find((type) => supported(type)) ?? '';
}

export function recordingName(at: Date, type = 'video/webm'): string {
  const two = (value: number): string => String(value).padStart(2, '0');
  const kind = type.includes('mp4') ? 'mp4' : 'webm';
  return `meeting-${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}.${kind}`;
}

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Tiles in a grid that fills the area: one big, two side by side, three or four in two rows. */
export function tileLayout(count: number, area: Rect, gap = GAP): Rect[] {
  if (count <= 0) {
    return [];
  }
  const columns = count === 1 ? 1 : 2;
  const rows = Math.ceil(count / columns);
  const width = (area.width - gap * (columns - 1)) / columns;
  const height = (area.height - gap * (rows - 1)) / rows;
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const inRow = row === rows - 1 ? count - row * columns : columns;
    const offset = ((columns - inRow) * (width + gap)) / 2;
    return {
      x: area.x + offset + (index % columns) * (width + gap),
      y: area.y + row * (height + gap),
      width,
      height,
    };
  });
}

/** Break text into lines that fit, keeping at most the last `most` lines so the newest words show. */
export function wrapLines(text: string, maxWidth: number, measure: (text: string) => number, most = 2): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) {
    lines.push(line);
  }
  return lines.slice(-most);
}

function cover(video: HTMLVideoElement, rect: Rect): [number, number, number, number] {
  const scale = Math.max(rect.width / video.videoWidth, rect.height / video.videoHeight);
  const width = rect.width / scale;
  const height = rect.height / scale;
  return [(video.videoWidth - width) / 2, (video.videoHeight - height) / 2, width, height];
}

function rounded(context: CanvasRenderingContext2D, rect: Rect, radius: number): void {
  context.beginPath();
  context.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
}

/**
 * Records the call on this device: every tile as the others see it, everyone's voices and the
 * captions, mixed into one WebM video that is downloaded when recording stops.
 */
export class MeetingRecorder {
  private readonly canvas = document.createElement('canvas');
  private readonly context2d: CanvasRenderingContext2D;
  private readonly audio = new AudioContext();
  private readonly mix = this.audio.createMediaStreamDestination();
  private readonly inputs = new Map<string, { track: MediaStreamTrack; node: MediaStreamAudioSourceNode }>();
  private readonly chunks: Blob[] = [];
  private readonly recorder: MediaRecorder;
  private readonly startedAt = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly scene: RecordingScene, tracks: readonly MediaStreamTrack[]) {
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('This browser cannot record the call.');
    }
    this.context2d = context;
    this.setAudio(tracks);
    const video = this.canvas.captureStream(FRAMES_PER_SECOND);
    const stream = new MediaStream([...video.getVideoTracks(), ...this.mix.stream.getAudioTracks()]);
    const mimeType = recordingType((type) => MediaRecorder.isTypeSupported(type));
    try {
      this.recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 2_500_000 } : undefined);
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      void this.audio.close().catch(() => undefined);
      throw error instanceof Error ? error : new Error('This browser cannot record the call.');
    }
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
    this.draw();
    this.timer = setInterval(() => this.draw(), 1000 / FRAMES_PER_SECOND);
    void this.audio.resume().catch(() => undefined);
    this.recorder.start(1000);
  }

  setAudio(tracks: readonly MediaStreamTrack[]): void {
    const wanted = new Set(tracks.filter((track) => track.kind === 'audio' && track.readyState === 'live').map((track) => track.id));
    for (const [id, input] of this.inputs) {
      if (!wanted.has(id)) {
        input.node.disconnect();
        this.inputs.delete(id);
      }
    }
    for (const track of tracks) {
      if (wanted.has(track.id) && !this.inputs.has(track.id)) {
        const node = this.audio.createMediaStreamSource(new MediaStream([track]));
        node.connect(this.mix);
        this.inputs.set(track.id, { track, node });
      }
    }
  }

  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const finish = (): void => {
        if (this.timer !== null) {
          clearInterval(this.timer);
          this.timer = null;
        }
        for (const input of this.inputs.values()) {
          input.node.disconnect();
        }
        this.inputs.clear();
        void this.audio.close().catch(() => undefined);
        resolve(new Blob(this.chunks, { type: this.recorder.mimeType || 'video/webm' }));
      };
      if (this.recorder.state === 'inactive') {
        finish();
        return;
      }
      this.recorder.onstop = finish;
      this.recorder.stop();
    });
  }

  private draw(): void {
    const context = this.context2d;
    context.fillStyle = STAGE;
    context.fillRect(0, 0, WIDTH, HEIGHT);
    this.drawTop(context);
    const tiles = this.scene.tiles();
    const rects = tileLayout(tiles.length, { x: 24, y: TOP, width: WIDTH - 48, height: HEIGHT - TOP - BOTTOM });
    tiles.forEach((tile, index) => this.drawTile(context, tile, rects[index]!));
    this.drawCaptions(context);
  }

  private drawTop(context: CanvasRenderingContext2D): void {
    const seconds = Math.floor((Date.now() - this.startedAt) / 1000);
    const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    context.fillStyle = RED;
    context.beginPath();
    context.arc(36, 28, 7, 0, Math.PI * 2);
    context.fill();
    context.font = `600 18px ${FONT}`;
    context.textBaseline = 'middle';
    context.fillStyle = INK;
    context.fillText(`REC ${time}`, 52, 29);
    context.fillStyle = DIM;
    context.textAlign = 'right';
    context.fillText(this.scene.title, WIDTH - 24, 29);
    context.textAlign = 'left';
  }

  private drawTile(context: CanvasRenderingContext2D, tile: RecordingTile, rect: Rect): void {
    context.save();
    rounded(context, rect, 14);
    context.fillStyle = TILE;
    context.fill();
    context.clip();
    const video = tile.video;
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      context.drawImage(video, ...cover(video, rect), rect.x, rect.y, rect.width, rect.height);
    } else {
      const radius = Math.min(rect.width, rect.height) * 0.16;
      context.fillStyle = '#2b3a58';
      context.beginPath();
      context.arc(rect.x + rect.width / 2, rect.y + rect.height / 2, radius, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = INK;
      context.font = `600 ${Math.round(radius * 0.8)}px ${FONT}`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(initials(tile.name), rect.x + rect.width / 2, rect.y + rect.height / 2 + 2);
      context.textAlign = 'left';
    }
    context.restore();
    context.font = `600 16px ${FONT}`;
    context.textBaseline = 'middle';
    const label = tile.muted ? `${tile.name} (muted)` : tile.name;
    const width = context.measureText(label).width + 20;
    context.fillStyle = 'rgb(14 23 38 / 72%)';
    rounded(context, { x: rect.x + 10, y: rect.y + rect.height - 40, width, height: 30 }, 8);
    context.fill();
    context.fillStyle = INK;
    context.fillText(label, rect.x + 20, rect.y + rect.height - 25);
    if (tile.speaking) {
      context.strokeStyle = SAFFRON;
      context.lineWidth = 4;
      rounded(context, { x: rect.x + 2, y: rect.y + 2, width: rect.width - 4, height: rect.height - 4 }, 13);
      context.stroke();
    }
  }

  private drawCaptions(context: CanvasRenderingContext2D): void {
    const captions = this.scene.captions().slice(-2);
    if (captions.length === 0) {
      return;
    }
    const box: Rect = { x: 120, y: HEIGHT - BOTTOM + 14, width: WIDTH - 240, height: BOTTOM - 28 };
    context.fillStyle = 'rgb(8 13 23 / 82%)';
    rounded(context, box, 14);
    context.fill();
    context.textBaseline = 'alphabetic';
    let y = box.y + 34;
    captions.forEach((caption, index) => {
      const newest = index === captions.length - 1;
      context.font = `700 17px ${FONT}`;
      context.fillStyle = SAFFRON;
      const name = `${caption.name}  `;
      context.fillText(name, box.x + 20, y);
      const indent = context.measureText(name).width;
      context.font = `500 21px ${FONT}`;
      context.fillStyle = newest ? INK : DIM;
      const room = box.width - 40 - indent;
      const lines = wrapLines(caption.text, room, (text) => context.measureText(text).width, newest ? 3 - index : 1);
      for (const line of lines) {
        context.fillText(line, box.x + 20 + indent, y);
        y += 34;
      }
    });
  }
}
