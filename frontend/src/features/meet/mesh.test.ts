import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SignalData, SpeakerId } from '../../services/protocol';
import { CONNECT_LIMIT_MS, HELLO_GRACE_MS, MAX_ATTEMPTS, offers, PeerMesh, RETRY_MS, type PeerState } from './mesh';

type Kind = 'audio' | 'video';

class FakeSender {
  constructor(public track: { kind: Kind } | null) {}
  replaceTrack(track: { kind: Kind } | null): Promise<void> {
    this.track = track;
    return Promise.resolve();
  }
  getParameters() {
    return { encodings: [{}] as Array<{ maxBitrate?: number }> };
  }
  setParameters(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeTransceiver {
  sender: FakeSender;
  receiver: { track: { kind: Kind } };
  constructor(kind: Kind, track: { kind: Kind } | null, public direction: string) {
    this.sender = new FakeSender(track);
    this.receiver = { track: { kind } };
  }
}

const everyPeer: FakePeer[] = [];

class FakePeer {
  connectionState: RTCPeerConnectionState = 'new';
  signalingState: RTCSignalingState = 'stable';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  transceivers: FakeTransceiver[] = [];
  candidates: RTCIceCandidateInit[] = [];
  onicecandidate: ((event: { candidate: { toJSON: () => RTCIceCandidateInit } | null }) => void) | null = null;
  ontrack: ((event: { track: { kind: Kind } }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  closed = false;

  constructor() {
    everyPeer.push(this);
  }

  addTransceiver(trackOrKind: { kind: Kind } | Kind, init: { direction: string }) {
    const kind = typeof trackOrKind === 'string' ? trackOrKind : trackOrKind.kind;
    const transceiver = new FakeTransceiver(kind, typeof trackOrKind === 'string' ? null : trackOrKind, init.direction);
    this.transceivers.push(transceiver);
    return transceiver;
  }

  getTransceivers() {
    return this.transceivers;
  }

  async createOffer() {
    return { type: 'offer' as const, sdp: this.transceivers.map((item) => item.receiver.track.kind).join(',') };
  }

  async createAnswer() {
    return { type: 'answer' as const, sdp: 'answer' };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
    queueMicrotask(() => this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: `c-${everyPeer.indexOf(this)}` }) } }));
    this.maybeConnect();
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description;
    if (description.type === 'offer') {
      for (const kind of (description.sdp ?? '').split(',') as Kind[]) {
        this.transceivers.push(new FakeTransceiver(kind, null, 'recvonly'));
      }
      this.signalingState = 'have-remote-offer';
    } else {
      this.signalingState = 'stable';
    }
    this.maybeConnect();
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    this.candidates.push(candidate);
  }

  close() {
    this.closed = true;
    this.connectionState = 'closed';
  }

  fail() {
    this.connectionState = 'failed';
    this.onconnectionstatechange?.();
  }

  private maybeConnect() {
    if (this.localDescription && this.remoteDescription && this.signalingState === 'stable' && !this.closed) {
      queueMicrotask(() => {
        if (this.closed) {
          return;
        }
        this.connectionState = 'connected';
        this.onconnectionstatechange?.();
        for (const transceiver of this.transceivers) {
          this.ontrack?.({ track: { kind: transceiver.receiver.track.kind } });
        }
      });
    }
  }
}

interface Person {
  mesh: PeerMesh;
  states: Array<[SpeakerId, PeerState | null]>;
  tracks: Map<SpeakerId, string[]>;
  sent: Array<[SpeakerId, SignalData]>;
  peers: FakePeer[];
}

let network: Array<() => Promise<void>> = [];
const people = new Map<SpeakerId, Person>();
const connectedIds = new Set<SpeakerId>();

function person(id: SpeakerId): Person {
  const peers: FakePeer[] = [];
  const someone: Person = {
    states: [],
    tracks: new Map(),
    sent: [],
    peers,
    mesh: new PeerMesh(
      id,
      {
        signal: (to, data) => {
          someone.sent.push([to, data]);
          network.push(async () => {
            if (connectedIds.has(to)) {
              await people.get(to)?.mesh.receive(id, data);
            }
          });
        },
        tracks: (from, tracks) => someone.tracks.set(from, tracks.map((track) => track.kind)),
        state: (from, state) => someone.states.push([from, state]),
      },
      () => {
        const peer = new FakePeer();
        peers.push(peer);
        return peer as unknown as RTCPeerConnection;
      },
    ),
  };
  people.set(id, someone);
  connectedIds.add(id);
  return someone;
}

async function settle(): Promise<void> {
  for (let round = 0; round < 50; round += 1) {
    await Promise.resolve();
    const pending = network;
    network = [];
    for (const deliver of pending) {
      await deliver();
    }
    await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
    if (network.length === 0) {
      await Promise.resolve();
      if (network.length === 0) {
        return;
      }
    }
  }
}

function lastState(someone: Person, id: SpeakerId): PeerState | null | undefined {
  return [...someone.states].reverse().find(([from]) => from === id)?.[1];
}

function livePeers(someone: Person): FakePeer[] {
  return someone.peers.filter((peer) => !peer.closed);
}

const AUDIO = { kind: 'audio' } as unknown as MediaStreamTrack;
const VIDEO = { kind: 'video' } as unknown as MediaStreamTrack;

beforeEach(() => {
  network = [];
  people.clear();
  connectedIds.clear();
  everyPeer.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('who starts each connection', () => {
  it('is always the person whose id comes first', () => {
    expect([offers('A', 'B'), offers('B', 'A'), offers('B', 'D'), offers('D', 'C')]).toEqual([true, false, true, false]);
  });
});

describe('the call mesh', () => {
  it('connects a newcomer: they say hello and the earlier id sends the offer', async () => {
    const a = person('A');
    const b = person('B');
    a.mesh.setTracks(AUDIO, VIDEO);
    b.mesh.setTracks(AUDIO, null);

    b.mesh.ready(['A', 'B']);
    await settle();

    expect(b.sent[0]).toEqual(['A', { kind: 'hello' }]);
    expect(b.sent.map(([to, data]) => `${to}:${String(data.kind)}`).sort()).toEqual(['A:answer', 'A:hello', 'A:ice']);
    expect(a.sent.map(([, data]) => data.kind)).toEqual(['offer', 'ice']);
    expect([a.mesh.isLive('B'), b.mesh.isLive('A')]).toEqual([true, true]);
    expect([lastState(a, 'B'), lastState(b, 'A')]).toEqual(['connected', 'connected']);
    expect(a.tracks.get('B')).toEqual(['audio', 'video']);
    expect(b.tracks.get('A')).toEqual(['audio', 'video']);
    const answerer = livePeers(b)[0]!;
    expect(answerer.transceivers.map((item) => [item.direction, item.sender.track?.kind ?? null])).toEqual([
      ['sendrecv', 'audio'],
      ['sendrecv', null],
    ]);
    expect(answerer.candidates).toEqual([{ candidate: 'c-0' }]);
  });

  it('never ends up with two connections when both sides start at once', async () => {
    const a = person('A');
    const b = person('B');
    const c = person('C');

    a.mesh.ready(['A', 'B', 'C']);
    b.mesh.ready(['A', 'B', 'C']);
    c.mesh.ready(['A', 'B', 'C']);
    await settle();

    for (const [someone, others] of [[a, ['B', 'C']], [b, ['A', 'C']], [c, ['A', 'B']]] as const) {
      expect(livePeers(someone)).toHaveLength(2);
      expect(others.map((id) => someone.mesh.isLive(id))).toEqual([true, true]);
    }
  });

  it('leaves live connections alone when its own channel reconnects', async () => {
    const a = person('A');
    const b = person('B');
    b.mesh.ready(['A', 'B']);
    await settle();
    const made = a.peers.length + b.peers.length;

    a.mesh.ready(['A', 'B']);
    b.mesh.ready(['A', 'B']);
    await settle();

    expect(a.peers.length + b.peers.length).toBe(made);
  });

  it('switches devices on every connection without starting over', async () => {
    const a = person('A');
    const b = person('B');
    b.mesh.ready(['A', 'B']);
    await settle();
    const other = { kind: 'video' } as unknown as MediaStreamTrack;

    a.mesh.setTracks(AUDIO, other);
    await settle();

    const peer = livePeers(a)[0]!;
    expect(peer.transceivers.map((item) => item.sender.track)).toEqual([AUDIO, other]);
    expect(livePeers(a)).toHaveLength(1);
  });

  it('ignores answers and candidates from an older attempt', async () => {
    const a = person('A');
    person('B');
    connectedIds.delete('B');
    a.mesh.ready(['A', 'B']);
    await settle();
    const peer = livePeers(a)[0]!;

    await a.mesh.receive('B', { kind: 'answer', pc: 'old', sdp: 'answer' });
    await a.mesh.receive('B', { kind: 'ice', pc: 'old', candidate: { candidate: 'x' } });
    await a.mesh.receive('B', { kind: 'offer', pc: 'k', sdp: 'audio,video' });

    expect(peer.signalingState).toBe('have-local-offer');
    expect(peer.candidates).toEqual([]);
    expect(a.peers).toHaveLength(1);
  });

  it('tries again after a failure, then gives up and can be asked to try again', async () => {
    vi.useFakeTimers();
    const a = person('A');
    person('B');
    connectedIds.delete('B');
    a.mesh.ready(['A', 'B']);
    await settle();

    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      livePeers(a)[0]!.fail();
      expect(lastState(a, 'B')).toBe('connecting');
      await vi.advanceTimersByTimeAsync(RETRY_MS * attempt);
      expect(livePeers(a)).toHaveLength(1);
    }
    await vi.advanceTimersByTimeAsync(CONNECT_LIMIT_MS);

    expect(lastState(a, 'B')).toBe('failed');
    expect(livePeers(a)).toHaveLength(0);
    expect(a.peers).toHaveLength(MAX_ATTEMPTS);

    a.mesh.tryAgain('B');
    await vi.advanceTimersByTimeAsync(0);
    expect(livePeers(a)).toHaveLength(1);
  });

  it('calls again when someone whose connection failed while away comes back', async () => {
    const a = person('A');
    const b = person('B');
    b.mesh.ready(['A', 'B']);
    await settle();

    a.mesh.leftForNow('B');
    livePeers(a)[0]!.fail();
    expect(lastState(a, 'B')).toBe('failed');
    a.mesh.arrived('B');
    await settle();

    expect([a.mesh.isLive('B'), b.mesh.isLive('A')]).toEqual([true, true]);
  });

  it('asks for a new call when its own side of the connection fails', async () => {
    vi.useFakeTimers();
    const a = person('A');
    const b = person('B');
    b.mesh.ready(['A', 'B']);
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    const before = a.peers.length;

    livePeers(b)[0]!.fail();
    expect(lastState(b, 'A')).toBe('connecting');
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    await settle();

    expect(b.sent.filter(([, data]) => data.kind === 'hello')).toHaveLength(2);
    expect(a.peers.length).toBe(before + 1);
    expect(b.mesh.isLive('A')).toBe(true);
  });

  it('does not start over when asked while its own new call is still on the way', async () => {
    const a = person('A');
    person('B');
    connectedIds.delete('B');
    a.mesh.arrived('B');
    await settle();

    await a.mesh.receive('B', { kind: 'hello' });

    expect(a.peers).toHaveLength(1);
    expect(HELLO_GRACE_MS).toBeGreaterThan(0);
  });

  it('forgets people who left while it was away', async () => {
    const a = person('A');
    const b = person('B');
    b.mesh.ready(['A', 'B']);
    await settle();

    a.mesh.keepOnly(['A', 'C']);

    expect(livePeers(a)).toHaveLength(0);
    expect(lastState(a, 'B')).toBeNull();
  });

  it('closes the connection when someone leaves', async () => {
    const a = person('A');
    const b = person('B');
    b.mesh.ready(['A', 'B']);
    await settle();

    a.mesh.gone('B');

    expect(livePeers(a)).toHaveLength(0);
    expect(a.tracks.get('B')).toEqual([]);
    expect(lastState(a, 'B')).toBeNull();
  });

  it('stops everything when the call ends', async () => {
    const a = person('A');
    const b = person('B');
    b.mesh.ready(['A', 'B']);
    await settle();

    a.mesh.close();
    await a.mesh.receive('B', { kind: 'hello' });

    expect(livePeers(a)).toHaveLength(0);
  });
});
