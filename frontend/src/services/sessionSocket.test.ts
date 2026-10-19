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
  let reconnecting: boolean[];
  let socket: SessionSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    created = [];
    messages = [];
    codes = [];
    reconnecting = [];
    socket = new SessionSocket(
      (message) => messages.push(message),
      (code) => codes.push(code),
      (state) => reconnecting.push(state),
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

  it('connects to the session stream and pings every 5 seconds', () => {
    socket.connect('/api/sessions/s%201/stream');
    const fake = created[0]!;
    fake.open();
    vi.advanceTimersByTime(5_000);

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

  it.each([1000, 4401, 4403, 4404, 4409, 4410])('reports a final close %i without trying again', (code) => {
    socket.connect('s1');
    const fake = created[0]!;
    fake.open();
    fake.closeWith(code);
    vi.advanceTimersByTime(60_000);

    expect(codes).toEqual([code]);
    expect(created).toHaveLength(1);
    expect(fake.sent).toEqual([]);
  });

  it('reconnects after a drop and says so until the conversation is ready again', () => {
    socket.connect('s1');
    created[0]!.open();
    created[0]!.receive('{"type":"pong","seq":5}');
    created[0]!.closeWith(1006);

    vi.advanceTimersByTime(1_000);
    const second = created[1]!;
    second.open();
    second.receive('{"type":"session.ready","seq":1,"session_id":"s1","participants":[],"server_voice":false,"mode":"together"}');

    expect(reconnecting).toEqual([true, false]);
    expect(codes).toEqual([]);
    expect(messages.map((message) => message.type)).toEqual(['pong', 'session.ready']);
  });

  it('waits longer between attempts and gives up after five minutes', () => {
    socket.connect('s1');
    created[0]!.closeWith(1006);
    for (let attempt = 1; created.length < 30 && codes.length === 0; attempt += 1) {
      vi.advanceTimersByTime(15_000);
      created.at(-1)!.closeWith(1006);
    }

    expect(reconnecting).toEqual([true]);
    expect(codes).toEqual([1006]);
    expect(created.length).toBeLessThan(30);
  });

  it('treats a connection that has gone quiet as dropped', () => {
    socket.connect('s1');
    created[0]!.open();
    vi.advanceTimersByTime(35_000);

    expect(reconnecting).toEqual([true]);
    vi.advanceTimersByTime(1_000);
    expect(created).toHaveLength(2);
  });

  it('tries again at once when asked while waiting', () => {
    socket.connect('s1');
    created[0]!.closeWith(1006);
    socket.retryNow();

    expect(created).toHaveLength(2);
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
