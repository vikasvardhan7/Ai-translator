import { useCallback, useEffect, useRef, useState } from 'react';

import { leaveRoom } from '../../services/api';
import type { Conversation } from '../../services/conversations';
import { liveWordsSupported, startLiveWords, type LiveWords } from '../../services/liveWords';
import { openTrackCapture, type AudioCapture } from '../../services/microphoneCapture';
import type { ChatLine, MediaState, Participant, ServerMessage, SpeakerId } from '../../services/protocol';
import { SessionSocket } from '../../services/sessionSocket';
import { abandonPending, applyServerMessage, type Turn } from '../session/conversation';
import { PeerMesh, type PeerState } from './mesh';

export type CallPhase = 'connecting' | 'live' | 'reconnecting' | 'leaving' | 'ended';
export type EndReason = 'left' | 'host-ended' | 'dropped' | 'closed';

export interface CallEnd {
  reason: EndReason;
  text: string;
}

export interface MeetingCall {
  phase: CallPhase;
  end: CallEnd | null;
  participants: Participant[];
  everyone: Participant[];
  connected: ReadonlySet<SpeakerId>;
  streams: Partial<Record<SpeakerId, MediaStream>>;
  peerStates: Partial<Record<SpeakerId, PeerState>>;
  media: Partial<Record<SpeakerId, MediaState>>;
  recording: ReadonlySet<SpeakerId>;
  chat: ChatLine[];
  turns: Turn[];
  liveWords: Partial<Record<SpeakerId, string>>;
  talking: ReadonlySet<SpeakerId>;
  notice: string | null;
  captionProblem: string | null;
  since: number | null;
  sendChat: (text: string) => void;
  setLanguage: (language: string) => void;
  announceRecording: (on: boolean) => void;
  tryVideo: (id: SpeakerId) => void;
  leave: () => void;
  clearNotice: () => void;
}

interface LocalSide {
  audio: MediaStreamTrack | null;
  video: MediaStreamTrack | null;
  micOn: boolean;
  cameraOn: boolean;
  liveWordsOn: boolean;
}

const LEAVE_WAIT_MS = 8_000;
const WORDS_LINGER_MS = 5_000;
const WORDS_EVERY_MS = 300;
const MAX_LIVE_WORDS = 500;
const MAX_CHAT = 200;
const MAX_TURNS = 200;
const DROPPED = 'The connection dropped before this sentence was captioned.';

export function closeText(code: number): string {
  switch (code) {
    case 4401:
      return 'Your place in this call has ended, for example after being away for a few minutes. Open the invite link again to join.';
    case 4404:
      return 'This meeting has ended.';
    case 4410:
      return 'You opened this meeting in another tab or window, so it closed here.';
    case 4403:
      return 'This page is not allowed to connect to the server. Check FRONTEND_ORIGIN in backend/.env.';
    default:
      return 'The connection to the server could not be restored. Check your internet, then join again.';
  }
}

function without<T>(record: Partial<Record<SpeakerId, T>>, id: SpeakerId): Partial<Record<SpeakerId, T>> {
  const next = { ...record };
  delete next[id];
  return next;
}

/** One person's side of a call: the live channel, the direct media connections, captions and chat. */
export function useMeetingCall(conversation: Conversation, local: LocalSide): MeetingCall {
  const you = conversation.you ?? 'A';
  const socketRef = useRef<SessionSocket | null>(null);
  const meshRef = useRef<PeerMesh | null>(null);
  const phaseRef = useRef<CallPhase>('connecting');
  const localRef = useRef(local);
  const recordingRef = useRef(false);
  const leaveTimerRef = useRef<number | null>(null);
  const wordsSentRef = useRef(0);
  const sinceRef = useRef<number | null>(null);
  const wordTimersRef = useRef(new Map<SpeakerId, number>());
  const speakersRef = useRef(new Map<string, SpeakerId | null>());
  const [phase, setPhaseState] = useState<CallPhase>('connecting');
  const [end, setEnd] = useState<CallEnd | null>(null);
  const [participants, setParticipants] = useState<Participant[]>(conversation.participants);
  const [everyone, setEveryone] = useState<Participant[]>(conversation.participants);
  const [connected, setConnected] = useState<ReadonlySet<SpeakerId>>(new Set());
  const [streams, setStreams] = useState<Partial<Record<SpeakerId, MediaStream>>>({});
  const [peerStates, setPeerStates] = useState<Partial<Record<SpeakerId, PeerState>>>({});
  const [media, setMedia] = useState<Partial<Record<SpeakerId, MediaState>>>({});
  const [recording, setRecording] = useState<ReadonlySet<SpeakerId>>(new Set());
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [liveWords, setLiveWords] = useState<Partial<Record<SpeakerId, string>>>({});
  const [talking, setTalking] = useState<ReadonlySet<SpeakerId>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [captionProblem, setCaptionProblem] = useState<string | null>(null);
  const [since, setSince] = useState<number | null>(null);
  localRef.current = local;

  const setPhase = useCallback((next: CallPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const showWords = useCallback((id: SpeakerId, text: string) => {
    const timers = wordTimersRef.current;
    const old = timers.get(id);
    if (old !== undefined) {
      window.clearTimeout(old);
      timers.delete(id);
    }
    setLiveWords((current) => (text ? { ...current, [id]: text } : without(current, id)));
    if (text) {
      timers.set(id, window.setTimeout(() => {
        timers.delete(id);
        setLiveWords((current) => without(current, id));
      }, WORDS_LINGER_MS));
    }
  }, []);

  const meet = useCallback((people: Participant[]) => {
    setParticipants(people);
    setEveryone((seen) => [...seen.filter((old) => !people.some((person) => person.id === old.id)), ...people]);
  }, []);

  const finish = useCallback((reason: EndReason, text: string) => {
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    meshRef.current?.close();
    socketRef.current?.close();
    setStreams({});
    setTurns((current) => abandonPending(current, DROPPED));
    setEnd((current) => current ?? { reason, text });
    setPhase('ended');
  }, [setPhase]);

  const sendMediaState = useCallback(() => {
    const { micOn, cameraOn, audio, video } = localRef.current;
    socketRef.current?.send({ type: 'media.state', mic: micOn && audio !== null, camera: cameraOn && video !== null });
  }, []);

  const handleMessage = useCallback((message: ServerMessage) => {
    const mesh = meshRef.current;
    setTurns((current) => applyServerMessage(current, message, Date.now(), MAX_TURNS));
    switch (message.type) {
      case 'session.ready': {
        meet(message.participants);
        const present = new Set(message.connected ?? []);
        setConnected(present);
        setChat(message.chat.slice(-MAX_CHAT));
        setRecording(new Set(message.recording));
        setMedia(message.media);
        if (sinceRef.current === null) {
          sinceRef.current = Date.now();
          setSince(sinceRef.current);
        }
        setPhase('live');
        socketRef.current?.send({ type: 'voice.settings', listener_id: you, server_voice: false, voice: null });
        sendMediaState();
        if (recordingRef.current) {
          socketRef.current?.send({ type: 'recording.set', on: true });
        }
        mesh?.keepOnly(message.participants.map((person) => person.id));
        mesh?.ready([...present]);
        break;
      }
      case 'utterance.received':
        speakersRef.current.set(message.utterance_id, message.speaker_id);
        if (speakersRef.current.size > MAX_TURNS) {
          speakersRef.current.delete(speakersRef.current.keys().next().value!);
        }
        break;
      case 'participants.updated':
        meet(message.participants);
        break;
      case 'peer.connected':
        setConnected((current) => new Set([...current, message.participant_id]));
        mesh?.arrived(message.participant_id);
        break;
      case 'peer.disconnected':
      case 'peer.left': {
        const id = message.participant_id;
        setConnected((current) => new Set([...current].filter((other) => other !== id)));
        setTalking((current) => new Set([...current].filter((other) => other !== id)));
        showWords(id, '');
        if (message.type === 'peer.left') {
          mesh?.gone(id);
          setMedia((current) => without(current, id));
          setRecording((current) => new Set([...current].filter((other) => other !== id)));
          if (id === 'A' && you !== 'A') {
            finish('host-ended', 'The host ended the meeting.');
          }
        } else {
          mesh?.leftForNow(id);
        }
        break;
      }
      case 'rtc.signal':
        void mesh?.receive(message.from, message.data);
        break;
      case 'chat.message': {
        const { id, from, name, text, sent_at } = message;
        setChat((current) => (current.some((line) => line.id === id) ? current : [...current, { id, from, name, text, sent_at }].slice(-MAX_CHAT)));
        break;
      }
      case 'media.state':
        setMedia((current) => ({ ...current, [message.participant_id]: { mic: message.mic, camera: message.camera } }));
        break;
      case 'recording.state':
        setRecording((current) => {
          const next = new Set(current);
          if (message.on) {
            next.add(message.participant_id);
          } else {
            next.delete(message.participant_id);
          }
          return next;
        });
        break;
      case 'words.live':
        showWords(message.speaker_id, message.text);
        break;
      case 'speech.activity': {
        const speaker = message.speaker_id;
        if (speaker) {
          setTalking((current) => {
            const next = new Set(current);
            if (message.active) {
              next.add(speaker);
            } else {
              next.delete(speaker);
            }
            return next;
          });
        }
        break;
      }
      case 'transcript.final':
        if (message.speaker_id) {
          showWords(message.speaker_id, '');
        }
        break;
      case 'error':
        if (message.code === 'voice_unavailable') {
          break;
        }
        if (message.utterance_id === null) {
          setNotice(message.message);
        } else if ((message.code === 'quota_exceeded' || !message.retryable) && speakersRef.current.get(message.utterance_id) === you) {
          setNotice(`Your last sentence has no caption: ${message.message}`);
        }
        break;
      default:
        break;
    }
  }, [finish, meet, sendMediaState, setPhase, showWords, you]);

  const handleClose = useCallback((code: number) => {
    if (code === 1000 || phaseRef.current === 'leaving') {
      finish('left', 'You left the meeting.');
      return;
    }
    finish(code === 4401 || code === 4404 || code === 4410 ? 'closed' : 'dropped', closeText(code));
  }, [finish]);

  const handleReconnecting = useCallback((reconnecting: boolean) => {
    if (reconnecting && (phaseRef.current === 'live' || phaseRef.current === 'connecting')) {
      setLiveWords({});
      setTalking(new Set());
      setTurns((current) => abandonPending(current, DROPPED, (turn) => turn.speakerId === you));
      setPhase('reconnecting');
    }
  }, [setPhase, you]);

  useEffect(() => {
    const socket = new SessionSocket(handleMessage, handleClose, handleReconnecting);
    const mesh = new PeerMesh(you, {
      signal: (to, data) => {
        socket.send({ type: 'rtc.signal', to, data });
      },
      tracks: (id, tracks) => {
        setStreams((current) => (tracks.length > 0 ? { ...current, [id]: new MediaStream(tracks) } : without(current, id)));
      },
      state: (id, state) => {
        setPeerStates((current) => (state ? { ...current, [id]: state } : without(current, id)));
      },
    });
    mesh.setTracks(localRef.current.audio, localRef.current.video);
    socketRef.current = socket;
    meshRef.current = mesh;
    const connectTimer = window.setTimeout(() => socket.connect(conversation.streamPath), 0);
    const retryNow = (): void => socket.retryNow();
    window.addEventListener('online', retryNow);
    return () => {
      window.clearTimeout(connectTimer);
      window.removeEventListener('online', retryNow);
      if (leaveTimerRef.current !== null) {
        window.clearTimeout(leaveTimerRef.current);
      }
      for (const timer of wordTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      wordTimersRef.current.clear();
      mesh.close();
      socket.close();
      socketRef.current = null;
      meshRef.current = null;
    };
  }, [conversation.streamPath, handleClose, handleMessage, handleReconnecting, you]);

  useEffect(() => {
    meshRef.current?.setTracks(local.audio, local.video);
  }, [local.audio, local.video]);

  useEffect(() => {
    if (phase === 'live') {
      sendMediaState();
    }
  }, [local.audio, local.cameraOn, local.micOn, local.video, phase, sendMediaState]);

  const listening = phase === 'live' && local.micOn && local.audio !== null;

  useEffect(() => {
    if (!listening || !local.audio) {
      return undefined;
    }
    let capture: AudioCapture | null = null;
    let cancelled = false;
    openTrackCapture(local.audio).then((opened) => {
      if (cancelled) {
        opened.stop();
        return;
      }
      capture = opened;
      setCaptionProblem(null);
      opened.start(
        (frame) => {
          socketRef.current?.sendAudio(frame);
        },
        () => undefined,
        () => setCaptionProblem('The microphone was disconnected. Pick another one in Settings.'),
      );
    }, (error: unknown) => {
      if (!cancelled) {
        setCaptionProblem(error instanceof Error ? error.message : 'Captions could not hear your microphone.');
      }
    });
    return () => {
      cancelled = true;
      capture?.stop();
      socketRef.current?.send({ type: 'audio.pause' });
    };
  }, [listening, local.audio]);

  const myLanguage = participants.find((person) => person.id === you)?.preferred_language ?? '';
  const wordsOn = listening && local.liveWordsOn && liveWordsSupported() && myLanguage !== '';

  useEffect(() => {
    if (!wordsOn) {
      return undefined;
    }
    let words: LiveWords | null = null;
    words = startLiveWords(
      myLanguage,
      (text, final) => {
        showWords(you, text);
        const at = Date.now();
        if (final || at - wordsSentRef.current >= WORDS_EVERY_MS) {
          wordsSentRef.current = at;
          socketRef.current?.send({ type: 'words.live', text: text.slice(-MAX_LIVE_WORDS) });
        }
      },
      () => {
        words = null;
      },
    );
    return () => {
      words?.stop();
      showWords(you, '');
      socketRef.current?.send({ type: 'words.live', text: '' });
    };
  }, [myLanguage, showWords, wordsOn, you]);

  const sendChat = useCallback((text: string) => {
    const words = text.trim();
    if (words) {
      socketRef.current?.send({ type: 'chat.send', text: words.slice(0, 1000) });
    }
  }, []);

  const setLanguage = useCallback((language: string) => {
    socketRef.current?.send({ type: 'language.set', participant_id: you, language });
  }, [you]);

  const announceRecording = useCallback((on: boolean) => {
    recordingRef.current = on;
    socketRef.current?.send({ type: 'recording.set', on });
  }, []);

  const tryVideo = useCallback((id: SpeakerId) => meshRef.current?.tryAgain(id), []);

  const leave = useCallback(() => {
    const socket = socketRef.current;
    if (phaseRef.current === 'ended' || phaseRef.current === 'leaving') {
      return;
    }
    meshRef.current?.close();
    setStreams({});
    if (phaseRef.current !== 'live' || !socket?.isOpen) {
      if (conversation.room) {
        void leaveRoom(conversation.room.roomId, conversation.room.token).catch(() => undefined);
      }
      finish('left', 'You left the meeting.');
      return;
    }
    setPhase('leaving');
    socket.send({ type: 'session.stop' });
    leaveTimerRef.current = window.setTimeout(() => finish('left', 'You left the meeting.'), LEAVE_WAIT_MS);
  }, [conversation.room, finish, setPhase]);

  const clearNotice = useCallback(() => setNotice(null), []);

  return {
    phase,
    end,
    participants,
    everyone,
    connected,
    streams,
    peerStates,
    media,
    recording,
    chat,
    turns,
    liveWords,
    talking,
    notice,
    captionProblem,
    since,
    sendChat,
    setLanguage,
    announceRecording,
    tryVideo,
    leave,
    clearNotice,
  };
}
