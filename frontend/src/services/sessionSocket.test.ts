import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServerMessage } from './protocol';
import { SessionSocket, shouldAcceptSequence } from './sessionSocket';

class FakeWebSocket extends EventTarget {
  static OPEN = 1;
  static CLOSING = 2;
  readyState = 0;
  sent: unknown[] = [];
  constructor(readonly url: string) {
    super();
  }
  send(data: unknown): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
  receive(data: string): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
  closeWith(code: number): void {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event('close'), { code }));
  }
}

describe('shouldAcceptSequence', () => {
  it('accepts only a higher whole sequence number', () => {
    expect(shouldAcceptSequence(2, 1)).toBe(true);
    expect(shouldAcceptSequence(2, 2)).toBe(false);
    expect(shouldAcceptSequence(1, 2)).toBe(false);
    expect(shouldAcceptSequence(1.5, 1)).toBe(false);
  });
});

describe('SessionSocket', () => {
  let created: FakeWebSocket[];
  let messages: ServerMessage[];
  let codes: number[];
  let socket: SessionSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    created = [];
    messages = [];
    codes = [];
    socket = new SessionSocket(
      (message) => messages.push(message),
      (code) => codes.push(code),
      (url) => {
        const fake = new FakeWebSocket(url);
        created.push(fake);
        return fake as unknown as WebSocket;
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('connects to the session stream and pings every 20 seconds', () => {
    socket.connect('s 1');
    const fake = created[0]!;
    fake.open();
    vi.advanceTimersByTime(20_000);

    expect(fake.url).toBe('ws://localhost:8000/api/sessions/s%201/stream');
    expect(fake.sent).toEqual([JSON.stringify({ type: 'ping' })]);
  });

  it('passes on new messages once and drops repeats and broken ones', () => {
    socket.connect('s1');
    const fake = created[0]!;
    fake.open();
    fake.receive('{"type":"pong","seq":1}');
    fake.receive('{"type":"pong","seq":1}');
    fake.receive('not json');
    fake.receive('{"type":"pong","seq":2}');

    expect(messages.map((message) => message.seq)).toEqual([1, 2]);
  });

  it('reports the close code and stops pinging', () => {
    socket.connect('s1');
    const fake = created[0]!;
    fake.open();
    fake.closeWith(4404);
    vi.advanceTimersByTime(60_000);

    expect(codes).toEqual([4404]);
    expect(fake.sent).toEqual([]);
  });

  it('sends audio only while open', () => {
    socket.connect('s1');
    const fake = created[0]!;
    const frame = new ArrayBuffer(3_200);

    expect(socket.sendAudio(frame)).toBe(false);
    fake.open();
    expect(socket.sendAudio(frame)).toBe(true);
    expect(fake.sent).toEqual([frame]);
  });

  it('ignores events from a socket it has closed', () => {
    socket.connect('s1');
    const old = created[0]!;
    socket.close();
    old.closeWith(1006);

    expect(codes).toEqual([]);
  });
});
