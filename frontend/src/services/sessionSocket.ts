import { getBackendUrl } from '../config';
import type { BrowserMessage, ServerMessage } from './protocol';
import { parseServerMessage } from './protocol';

export type SocketStatus = 'connecting' | 'open' | 'closed' | 'error';

function socketUrl(sessionId: string): string {
  const baseUrl = getBackendUrl();
  const socketBase = baseUrl.startsWith('https://')
    ? `wss://${baseUrl.slice('https://'.length)}`
    : `ws://${baseUrl.replace(/^http:\/\//, '')}`;
  return `${socketBase}/api/sessions/${encodeURIComponent(sessionId)}/stream`;
}

export function shouldAcceptSequence(sequence: number, lastSequence: number): boolean {
  return Number.isInteger(sequence) && sequence > lastSequence;
}

export class SessionSocket {
  private socket: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastSequence = 0;
  private closeCode: number | null = null;

  constructor(
    private readonly onMessage: (message: ServerMessage) => void,
    private readonly onStatus: (status: SocketStatus) => void,
    private readonly onCloseCode: (code: number) => void,
    private readonly createSocket: (url: string) => WebSocket = (url) => new WebSocket(url),
  ) {}

  get lastCloseCode(): number | null {
    return this.closeCode;
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect(sessionId: string): void {
    this.closeCurrentSocket();
    this.closeCode = null;
    this.lastSequence = 0;
    this.onStatus('connecting');

    const socket = this.createSocket(socketUrl(sessionId));
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (socket !== this.socket) {
        return;
      }

      this.onStatus('open');
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), 20_000);
    });

    socket.addEventListener('message', (event: MessageEvent) => {
      if (socket !== this.socket || typeof event.data !== 'string') {
        return;
      }

      const message = parseServerMessage(event.data);
      if (!message || !shouldAcceptSequence(message.seq, this.lastSequence)) {
        return;
      }

      this.lastSequence = message.seq;
      this.onMessage(message);
    });

    socket.addEventListener('error', () => {
      if (socket === this.socket) {
        this.onStatus('error');
      }
    });

    socket.addEventListener('close', (event: CloseEvent) => {
      if (socket !== this.socket) {
        return;
      }

      this.clearPingTimer();
      this.closeCode = event.code;
      this.onStatus('closed');
      this.onCloseCode(event.code);
    });
  }

  send(message: BrowserMessage): boolean {
    if (this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify(message));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  sendAudio(bytes: ArrayBuffer): boolean {
    if (this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(bytes);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  close(): void {
    this.closeCurrentSocket();
    this.onStatus('closed');
  }

  private clearPingTimer(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private closeCurrentSocket(): void {
    this.clearPingTimer();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close();
    }
  }
}
