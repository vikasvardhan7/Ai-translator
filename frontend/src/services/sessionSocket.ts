import { getBackendUrl } from '../config';
import type { BrowserMessage, ServerMessage } from './protocol';
import { parseServerMessage } from './protocol';

const PING_MS = 5_000;
const SILENCE_LIMIT_MS = 30_000;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000];
const GIVE_UP_AFTER_MS = 5 * 60_000;
const FINAL_CODES = new Set([1000, 4401, 4403, 4404, 4410]);
const LOST_CODE = 1006;

function socketUrl(streamPath: string): string {
  const baseUrl = getBackendUrl();
  const socketBase = baseUrl.startsWith('https://')
    ? `wss://${baseUrl.slice('https://'.length)}`
    : `ws://${baseUrl.replace(/^http:\/\//, '')}`;
  return `${socketBase}${streamPath}`;
}

export function shouldAcceptSequence(sequence: number, lastSequence: number): boolean {
  return Number.isInteger(sequence) && sequence > lastSequence;
}

export class SessionSocket {
  private socket: WebSocket | null = null;
  private streamPath = '';
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSequence = 0;
  private lastHeard = 0;
  private attempt = 0;
  private droppedAt: number | null = null;
  private stopped = false;

  constructor(
    private readonly onMessage: (message: ServerMessage) => void,
    private readonly onCloseCode: (code: number) => void,
    private readonly onReconnecting: (reconnecting: boolean) => void = () => undefined,
    private readonly createSocket: (url: string) => WebSocket = (url) => new WebSocket(url),
  ) {}

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect(streamPath: string): void {
    this.streamPath = streamPath;
    this.stopped = false;
    this.attempt = 0;
    this.droppedAt = null;
    this.open();
  }

  retryNow(): void {
    if (this.droppedAt !== null && this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.open();
    }
  }

  send(message: BrowserMessage): boolean {
    return this.transmit(JSON.stringify(message));
  }

  sendAudio(bytes: ArrayBuffer): boolean {
    return this.transmit(bytes);
  }

  close(): void {
    this.stopped = true;
    this.clearRetry();
    this.closeCurrentSocket();
  }

  private open(): void {
    this.retryTimer = null;
    this.closeCurrentSocket();
    this.lastSequence = 0;

    const socket = this.createSocket(socketUrl(this.streamPath));
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (socket !== this.socket) {
        return;
      }
      this.lastHeard = Date.now();
      this.pingTimer = setInterval(() => this.checkAlive(), PING_MS);
    });

    socket.addEventListener('message', (event: MessageEvent) => {
      if (socket !== this.socket || typeof event.data !== 'string') {
        return;
      }
      this.lastHeard = Date.now();
      const message = parseServerMessage(event.data);
      if (!message || !shouldAcceptSequence(message.seq, this.lastSequence)) {
        return;
      }
      this.lastSequence = message.seq;
      if (message.type === 'session.ready' && this.droppedAt !== null) {
        this.attempt = 0;
        this.droppedAt = null;
        this.onReconnecting(false);
      }
      this.onMessage(message);
    });

    socket.addEventListener('close', (event: CloseEvent) => {
      if (socket !== this.socket) {
        return;
      }
      this.clearPing();
      this.socket = null;
      this.dropped(event.code);
    });
  }

  private checkAlive(): void {
    if (Date.now() - this.lastHeard > SILENCE_LIMIT_MS) {
      this.closeCurrentSocket();
      this.dropped(LOST_CODE);
      return;
    }
    this.send({ type: 'ping' });
  }

  private dropped(code: number): void {
    if (this.stopped) {
      return;
    }
    const now = Date.now();
    this.droppedAt ??= now;
    if (FINAL_CODES.has(code) || now - this.droppedAt >= GIVE_UP_AFTER_MS) {
      this.stopped = true;
      this.onCloseCode(code);
      return;
    }
    if (this.attempt === 0) {
      this.onReconnecting(true);
    }
    const delay = RETRY_DELAYS_MS[Math.min(this.attempt, RETRY_DELAYS_MS.length - 1)]!;
    this.attempt += 1;
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private transmit(data: string | ArrayBuffer): boolean {
    if (this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(data);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  private clearPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private closeCurrentSocket(): void {
    this.clearPing();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close();
    }
  }
}
