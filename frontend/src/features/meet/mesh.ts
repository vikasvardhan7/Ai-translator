import type { SignalData, SpeakerId } from '../../services/protocol';

export type PeerState = 'connecting' | 'connected' | 'failed';

export interface MeshEvents {
  signal: (to: SpeakerId, data: SignalData) => void;
  tracks: (id: SpeakerId, tracks: MediaStreamTrack[]) => void;
  state: (id: SpeakerId, state: PeerState | null) => void;
}

export type PeerFactory = (config: RTCConfiguration) => RTCPeerConnection;

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];
export const CONNECT_LIMIT_MS = 20_000;
export const MAX_ATTEMPTS = 3;
export const RETRY_MS = 2_000;
export const HELLO_GRACE_MS = 3_000;
const VIDEO_BITRATE = 600_000;

interface Peer {
  id: SpeakerId;
  key: string;
  pc: RTCPeerConnection;
  remoteSet: boolean;
  waiting: RTCIceCandidateInit[];
  outgoing: RTCIceCandidateInit[] | null;
  tracks: MediaStreamTrack[];
  timer: ReturnType<typeof setTimeout> | null;
  startedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function randomKey(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** The person whose id comes first starts each connection, so two people never call each other at once. */
export function offers(me: SpeakerId, other: SpeakerId): boolean {
  return me < other;
}

/**
 * Direct audio and video connections to everyone else in the call (a mesh), set up through
 * messages the server passes along. Each pair has exactly one side that sends offers.
 */
export class PeerMesh {
  private readonly peers = new Map<SpeakerId, Peer>();
  private readonly attempts = new Map<SpeakerId, number>();
  private readonly retries = new Map<SpeakerId, ReturnType<typeof setTimeout>>();
  private readonly away = new Set<SpeakerId>();
  private audio: MediaStreamTrack | null = null;
  private video: MediaStreamTrack | null = null;
  private closed = false;

  constructor(
    private readonly me: SpeakerId,
    private readonly events: MeshEvents,
    private readonly createPeer: PeerFactory = (config) => new RTCPeerConnection(config),
    private readonly newKey: () => string = randomKey,
    private readonly now: () => number = Date.now,
  ) {}

  setTracks(audio: MediaStreamTrack | null, video: MediaStreamTrack | null): void {
    this.audio = audio;
    this.video = video;
    for (const peer of this.peers.values()) {
      this.attach(peer);
    }
  }

  /** This device's live channel opened: connect to everyone connected who is not connected yet. */
  ready(connected: readonly SpeakerId[]): void {
    for (const id of connected) {
      this.away.delete(id);
      if (id !== this.me && !this.isLive(id)) {
        this.attempts.set(id, 0);
        this.reach(id);
      }
    }
  }

  /** Their live channel is back. If our media connection did not survive, the offering side calls again. */
  arrived(id: SpeakerId): void {
    this.away.delete(id);
    if (offers(this.me, id) && !this.isLive(id) && !this.closed) {
      this.clearRetry(id);
      this.attempts.set(id, 0);
      void this.call(id);
    }
  }

  /** Forget everyone who is no longer in the call (they may have left while this channel was down). */
  keepOnly(ids: readonly SpeakerId[]): void {
    const known = new Set([...this.peers.keys(), ...this.attempts.keys(), ...this.retries.keys()]);
    for (const id of known) {
      if (!ids.includes(id)) {
        this.gone(id);
      }
    }
  }

  /** Their live channel dropped; the media may still flow, so keep it until it fails by itself. */
  leftForNow(id: SpeakerId): void {
    this.away.add(id);
    this.clearRetry(id);
  }

  gone(id: SpeakerId): void {
    this.clearRetry(id);
    this.attempts.delete(id);
    this.away.delete(id);
    this.drop(id);
    this.events.state(id, null);
  }

  tryAgain(id: SpeakerId): void {
    if (this.closed || id === this.me) {
      return;
    }
    this.clearRetry(id);
    this.attempts.set(id, 0);
    this.events.state(id, 'connecting');
    this.reach(id);
  }

  isLive(id: SpeakerId): boolean {
    return this.peers.get(id)?.pc.connectionState === 'connected';
  }

  async receive(from: SpeakerId, data: SignalData): Promise<void> {
    if (this.closed || from === this.me) {
      return;
    }
    switch (data.kind) {
      case 'hello': {
        if (!offers(this.me, from)) {
          return;
        }
        const peer = this.peers.get(from);
        if (peer && !this.isLive(from) && this.now() - peer.startedAt < HELLO_GRACE_MS) {
          return;
        }
        this.clearRetry(from);
        this.attempts.set(from, 0);
        await this.call(from);
        return;
      }
      case 'offer':
        if (offers(from, this.me) && typeof data.pc === 'string' && typeof data.sdp === 'string') {
          this.away.delete(from);
          await this.answer(from, data.pc, data.sdp);
        }
        return;
      case 'answer':
        await this.answered(from, data);
        return;
      case 'ice':
        await this.candidate(from, data);
        return;
      default:
        return;
    }
  }

  close(): void {
    this.closed = true;
    for (const id of [...this.retries.keys()]) {
      this.clearRetry(id);
    }
    for (const id of [...this.peers.keys()]) {
      this.drop(id);
    }
  }

  private reach(id: SpeakerId): void {
    if (this.closed) {
      return;
    }
    if (offers(this.me, id)) {
      void this.call(id);
    } else {
      this.events.signal(id, { kind: 'hello' });
    }
  }

  private async call(id: SpeakerId): Promise<void> {
    if (this.closed) {
      return;
    }
    const peer = this.open(id, this.newKey());
    peer.pc.addTransceiver(this.audio ?? 'audio', { direction: 'sendrecv' });
    peer.pc.addTransceiver(this.video ?? 'video', { direction: 'sendrecv' });
    try {
      const offer = await peer.pc.createOffer();
      if (!this.current(peer)) {
        return;
      }
      await peer.pc.setLocalDescription(offer);
      if (!this.current(peer)) {
        return;
      }
      this.events.signal(id, { kind: 'offer', pc: peer.key, sdp: peer.pc.localDescription?.sdp ?? offer.sdp ?? '' });
      this.described(peer);
    } catch {
      this.failed(peer);
    }
  }

  private async answer(id: SpeakerId, key: string, sdp: string): Promise<void> {
    const peer = this.open(id, key);
    try {
      await peer.pc.setRemoteDescription({ type: 'offer', sdp });
      if (!this.current(peer)) {
        return;
      }
      peer.remoteSet = true;
      for (const transceiver of peer.pc.getTransceivers()) {
        transceiver.direction = 'sendrecv';
      }
      this.attach(peer);
      const answer = await peer.pc.createAnswer();
      if (!this.current(peer)) {
        return;
      }
      await peer.pc.setLocalDescription(answer);
      if (!this.current(peer)) {
        return;
      }
      this.events.signal(id, { kind: 'answer', pc: key, sdp: peer.pc.localDescription?.sdp ?? answer.sdp ?? '' });
      this.described(peer);
      await this.flush(peer);
    } catch {
      this.failed(peer);
    }
  }

  private async answered(id: SpeakerId, data: SignalData): Promise<void> {
    const peer = this.peers.get(id);
    if (!peer || peer.key !== data.pc || typeof data.sdp !== 'string' || peer.pc.signalingState !== 'have-local-offer') {
      return;
    }
    try {
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      if (!this.current(peer)) {
        return;
      }
      peer.remoteSet = true;
      await this.flush(peer);
    } catch {
      this.failed(peer);
    }
  }

  private async candidate(id: SpeakerId, data: SignalData): Promise<void> {
    const peer = this.peers.get(id);
    if (!peer || peer.key !== data.pc || !isRecord(data.candidate)) {
      return;
    }
    const candidate = data.candidate as RTCIceCandidateInit;
    if (!peer.remoteSet) {
      peer.waiting.push(candidate);
      return;
    }
    await peer.pc.addIceCandidate(candidate).catch(() => undefined);
  }

  /** Candidates go out only after the offer or answer, so the other side knows which attempt they belong to. */
  private described(peer: Peer): void {
    const outgoing = peer.outgoing ?? [];
    peer.outgoing = null;
    for (const candidate of outgoing) {
      this.events.signal(peer.id, { kind: 'ice', pc: peer.key, candidate });
    }
  }

  private async flush(peer: Peer): Promise<void> {
    const waiting = peer.waiting.splice(0);
    for (const candidate of waiting) {
      if (!this.current(peer)) {
        return;
      }
      await peer.pc.addIceCandidate(candidate).catch(() => undefined);
    }
  }

  private open(id: SpeakerId, key: string): Peer {
    this.clearRetry(id);
    this.drop(id);
    const pc = this.createPeer({ iceServers: ICE_SERVERS });
    const peer: Peer = { id, key, pc, remoteSet: false, waiting: [], outgoing: [], tracks: [], timer: null, startedAt: this.now() };
    this.peers.set(id, peer);
    pc.onicecandidate = (event) => {
      if (!event.candidate || !this.current(peer)) {
        return;
      }
      const candidate = event.candidate.toJSON();
      if (peer.outgoing) {
        peer.outgoing.push(candidate);
      } else {
        this.events.signal(id, { kind: 'ice', pc: key, candidate });
      }
    };
    pc.ontrack = (event) => {
      if (!this.current(peer) || peer.tracks.includes(event.track)) {
        return;
      }
      peer.tracks = [...peer.tracks.filter((track) => track.kind !== event.track.kind), event.track];
      this.events.tracks(id, peer.tracks);
    };
    pc.onconnectionstatechange = () => this.changed(peer);
    peer.timer = setTimeout(() => {
      if (this.current(peer) && pc.connectionState !== 'connected') {
        this.failed(peer);
      }
    }, CONNECT_LIMIT_MS);
    this.events.state(id, 'connecting');
    return peer;
  }

  private changed(peer: Peer): void {
    if (!this.current(peer)) {
      return;
    }
    const state = peer.pc.connectionState;
    if (state === 'connected') {
      this.stopTimer(peer);
      this.attempts.set(peer.id, 0);
      this.limitVideo(peer);
      this.events.state(peer.id, 'connected');
    } else if (state === 'failed') {
      this.failed(peer);
    } else if (state === 'disconnected') {
      this.events.state(peer.id, 'connecting');
    }
  }

  private failed(peer: Peer): void {
    if (!this.current(peer)) {
      return;
    }
    const tries = (this.attempts.get(peer.id) ?? 0) + 1;
    this.attempts.set(peer.id, tries);
    this.drop(peer.id);
    if (this.closed || this.away.has(peer.id) || tries >= MAX_ATTEMPTS) {
      this.events.state(peer.id, 'failed');
      return;
    }
    this.events.state(peer.id, 'connecting');
    this.retries.set(peer.id, setTimeout(() => {
      this.retries.delete(peer.id);
      this.reach(peer.id);
    }, RETRY_MS * tries));
  }

  private attach(peer: Peer): void {
    for (const transceiver of peer.pc.getTransceivers()) {
      const kind = transceiver.receiver.track?.kind;
      const track = kind === 'audio' ? this.audio : kind === 'video' ? this.video : null;
      if (kind && transceiver.sender.track !== track) {
        void transceiver.sender.replaceTrack(track).catch(() => undefined);
      }
    }
  }

  private limitVideo(peer: Peer): void {
    for (const transceiver of peer.pc.getTransceivers()) {
      if (transceiver.receiver.track?.kind !== 'video') {
        continue;
      }
      try {
        const parameters = transceiver.sender.getParameters();
        const [first] = parameters.encodings ?? [];
        if (first) {
          first.maxBitrate = VIDEO_BITRATE;
          void transceiver.sender.setParameters(parameters).catch(() => undefined);
        }
      } catch {
        continue;
      }
    }
  }

  private current(peer: Peer): boolean {
    return !this.closed && this.peers.get(peer.id) === peer;
  }

  private stopTimer(peer: Peer): void {
    if (peer.timer !== null) {
      clearTimeout(peer.timer);
      peer.timer = null;
    }
  }

  private clearRetry(id: SpeakerId): void {
    const timer = this.retries.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.retries.delete(id);
    }
  }

  private drop(id: SpeakerId): void {
    const peer = this.peers.get(id);
    if (!peer) {
      return;
    }
    this.peers.delete(id);
    this.stopTimer(peer);
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    if (peer.tracks.length > 0) {
      this.events.tracks(id, []);
    }
  }
}
