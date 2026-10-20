import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import CallTiles, { type Tile } from '../call/CallTiles';
import CaptionStrip, { type LiveLine } from '../call/CaptionStrip';
import ControlBar from '../call/ControlBar';
import SettingsPanel, { type ListenerSettings } from '../call/SettingsPanel';
import InvitePanel, { InviteCard } from '../call/InvitePanel';
import TranscriptPanel from '../call/TranscriptPanel';
import { CallBridgeContext, type CallAction } from '../desktop/bridge';
import { leaveRoom } from '../../services/api';
import { liveWordsSupported, liveWordsWanted, saveLiveWordsWanted, startLiveWords, type LiveWords } from '../../services/liveWords';
import { languageLabel, languageName } from '../../services/languageNames';
import {
  MicrophoneNeedsTap,
  openMeetingCapture,
  openMicrophoneCapture,
  type AudioCapture,
} from '../../services/microphoneCapture';
import type { Conversation } from '../../services/conversations';
import { isSpeakerId, perSpeaker, SPEAKER_IDS, type Participant, type ServerMessage, type SpeakerId } from '../../services/protocol';
import { SessionSocket } from '../../services/sessionSocket';
import { abandonPending, applyServerMessage, fixVoice, MAX_TURNS, speakerName, speakerNames, turnSpeaker, type Turn } from './conversation';
import { downloadSubtitles, downloadText, downloadWord, printTranscript } from './download';
import { tagFrame } from './pcm';
import { assistantTranscript } from './transcript';
import { createBrowserVoicePlayer, unlockBrowserAudio } from './voicePlayer';
import { VoiceQueue } from './voiceQueue';

interface SessionScreenProps {
  conversation: Conversation;
  initialTurns: Turn[];
  onReturnToStart: () => void;
  onRestart: ((participants: Participant[], turns: Turn[]) => Promise<void>) | null;
  onAsk?: () => void;
}

type SessionPhase = 'connecting' | 'live' | 'reconnecting' | 'ending' | 'closed';
type MeetingSound = 'off' | 'connecting' | 'on';

const END_WAIT_MS = 45_000;
const RESUME_AFTER_VOICE_MS = 600;
const WIDE_SCREEN = '(min-width: 1100px)';
const WORDS_EVERY_MS = 300;
const WORDS_LINGER_MS = 6_000;
const MAX_LIVE_WORDS = 500;
const DROPPED = 'The connection dropped before this sentence was translated.';
const RESTARTED = 'The conversation was started again before this sentence was translated.';

const PHASE_LABELS: Record<SessionPhase, string> = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  ending: 'Finishing the last sentences',
  closed: 'Ended',
};

function closeIssue(code: number, remote: boolean): string {
  switch (code) {
    case 4401:
      return 'This invite link is no longer valid. Ask for a new link.';
    case 4410:
      return 'This conversation was opened in another tab or window, so it closed here.';
    case 4404:
      return remote
        ? 'This conversation has ended. Start a new one.'
        : 'This conversation has ended or expired. Start it again.';
    case 4403:
      return 'This page is not allowed to connect to the backend. Check FRONTEND_ORIGIN in backend/.env.';
    default:
      return 'The connection to the backend could not be restored. Check that it is running, then start again.';
  }
}

interface HeardWords {
  speaker: SpeakerId | null;
  text: string;
}

function liveWordsProblem(reason: string, language: string): string {
  if (reason === 'language-not-supported') {
    return `This browser cannot follow ${languageName(language)} while it is spoken, so words appear after each sentence.`;
  }
  if (reason === 'not-allowed' || reason === 'service-not-allowed') {
    return "The browser did not allow its speech recognition, so words appear after each sentence.";
  }
  return "The browser's speech recognition cannot be reached, so words appear after each sentence.";
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function elapsed(since: number | null, now: number): string {
  if (since === null) {
    return '00:00';
  }
  const seconds = Math.max(0, Math.floor((now - since) / 1_000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function badge(language: string): string {
  return language.slice(0, 3).toUpperCase();
}

const DEFAULT_SETTINGS: ListenerSettings = { mode: 'fast', naturalVoice: null, browserVoice: null, rate: 1 };

export default function SessionScreen({ conversation, initialTurns, onReturnToStart, onRestart, onAsk }: SessionScreenProps) {
  const { you } = conversation;
  const meeting = conversation.mode === 'call';
  const bridge = useContext(CallBridgeContext);
  const bridgeOwnerRef = useRef({});
  const socketRef = useRef<SessionSocket | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const meetingRef = useRef<AudioCapture | null>(null);
  const queueRef = useRef<VoiceQueue | null>(null);
  const speakingRef = useRef<SpeakerId | null>(null);
  const phaseRef = useRef<SessionPhase>('connecting');
  const mountedRef = useRef(true);
  const mutedRef = useRef(false);
  const readyOnceRef = useRef(false);
  const endTimerRef = useRef<number | null>(null);
  const resumeTimerRef = useRef<number | null>(null);
  const serverVoiceRef = useRef(false);
  const sentRef = useRef<Partial<Record<SpeakerId, string>>>({});
  const talkingRef = useRef(new Set<string>());
  const settingsRef = useRef<Record<SpeakerId, ListenerSettings>>(perSpeaker(DEFAULT_SETTINGS));
  const voiceOnRef = useRef(!meeting);
  const liveWordsRef = useRef<LiveWords | null>(null);
  const wordsSentRef = useRef(0);
  const wordsHandlerRef = useRef<(text: string, final: boolean) => void>(() => undefined);
  const [participants, setParticipants] = useState<Participant[]>(conversation.participants);
  const [phase, setPhaseState] = useState<SessionPhase>('connecting');
  const [issue, setIssue] = useState<string | null>(null);
  const [micIssue, setMicIssue] = useState<string | null>(null);
  const [micNeedsTap, setMicNeedsTap] = useState(false);
  const [meetingSound, setMeetingSound] = useState<MeetingSound>('off');
  const [meetingIssue, setMeetingIssue] = useState<string | null>(null);
  const [connected, setConnected] = useState<ReadonlySet<SpeakerId> | null>(null);
  const [everyone, setEveryone] = useState<Participant[]>(conversation.participants);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [notices, setNotices] = useState<string[]>([]);
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [level, setLevel] = useState(0);
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voiceOn, setVoiceOn] = useState(!meeting);
  const [hearing, setHearing] = useState<SpeakerId | null>(null);
  const [talking, setTalking] = useState<ReadonlySet<SpeakerId>>(new Set());
  const [roomTalking, setRoomTalking] = useState(false);
  const [serverVoice, setServerVoice] = useState(false);
  const [settings, setSettings] = useState<Record<SpeakerId, ListenerSettings>>(settingsRef.current);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(() => window.matchMedia?.(WIDE_SCREEN).matches ?? false);
  const [liveSince, setLiveSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [restarting, setRestarting] = useState(false);
  const [liveWordsOn, setLiveWordsOn] = useState(() => liveWordsSupported() && liveWordsWanted());
  const [liveWordsIssue, setLiveWordsIssue] = useState<string | null>(null);
  const [heardWords, setHeardWords] = useState<HeardWords | null>(null);
  const [nextSpeaker, setNextSpeaker] = useState<SpeakerId | null>(conversation.participants[0]?.id ?? null);

  const listenerIds = useMemo(
    () => conversation.participants.map((person) => person.id).filter((id) => !you || id === you),
    [conversation.participants, you],
  );
  const listeners = participants.filter((person) => listenerIds.includes(person.id));
  const names = useMemo(() => speakerNames(conversation.mode, everyone, you), [conversation.mode, everyone, you]);
  const documentTitle = conversation.title || (meeting ? 'Meeting captions' : conversation.mode === 'remote' ? 'Meeting' : 'Conversation');

  const meetPeople = useCallback((people: Participant[]) => {
    setParticipants(people);
    setEveryone((seen) => [...seen.filter((old) => !people.some((person) => person.id === old.id)), ...people]);
  }, []);

  const setPhase = useCallback((next: SessionPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const ownTurn = useCallback(
    (turn: Turn) => conversation.mode !== 'remote' || turn.speakerId === null || turn.speakerId === you,
    [conversation.mode, you],
  );

  const clearTalking = useCallback(() => {
    talkingRef.current.clear();
    setTalking(new Set());
    setRoomTalking(false);
  }, []);

  const stopListening = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    setListening(false);
    setLevel(0);
  }, []);

  const stopMeetingSound = useCallback(() => {
    meetingRef.current?.stop();
    meetingRef.current = null;
    setMeetingSound('off');
  }, []);

  const startListening = useCallback(async () => {
    if (captureRef.current || phaseRef.current !== 'live') {
      return;
    }
    setMicIssue(null);
    try {
      const capture = await openMicrophoneCapture();
      if (!mountedRef.current || phaseRef.current !== 'live' || captureRef.current) {
        capture.stop();
        return;
      }
      captureRef.current = capture;
      capture.start(
        (frame) => {
          socketRef.current?.sendAudio(meeting ? tagFrame('A', frame) : frame);
        },
        (value) => {
          if (mountedRef.current) {
            setLevel(value);
          }
        },
        () => {
          stopListening();
          setMicIssue('The microphone was disconnected. Plug it back in and select Try again.');
        },
      );
      if (speakingRef.current || mutedRef.current) {
        capture.pause();
      }
      capture.mute(mutedRef.current);
      setListening(true);
    } catch (error) {
      if (mountedRef.current) {
        setMicNeedsTap(error instanceof MicrophoneNeedsTap);
        setMicIssue(errorText(error, 'The microphone could not be opened.'));
      }
    }
  }, [meeting, stopListening]);

  const applyVoice = useCallback((id: SpeakerId) => {
    const queue = queueRef.current;
    const chosen = settingsRef.current[id];
    const natural = serverVoiceRef.current && chosen.mode === 'natural';
    queue?.setStyle(id, { rate: chosen.rate, browserVoice: chosen.browserVoice });
    queue?.setLocalVoice(id, !natural);
    if (!serverVoiceRef.current) {
      return;
    }
    const message = {
      type: 'voice.settings' as const,
      listener_id: id,
      server_voice: voiceOnRef.current && natural,
      voice: chosen.naturalVoice,
    };
    const signature = JSON.stringify(message);
    if (sentRef.current[id] !== signature && socketRef.current?.send(message)) {
      sentRef.current = { ...sentRef.current, [id]: signature };
    }
  }, []);

  const changeSettings = useCallback((id: SpeakerId, next: ListenerSettings) => {
    settingsRef.current = { ...settingsRef.current, [id]: next };
    setSettings(settingsRef.current);
    applyVoice(id);
  }, [applyVoice]);

  const handleMessage = useCallback((message: ServerMessage) => {
    const queue = queueRef.current;
    setTurns((current) => applyServerMessage(current, message, Date.now(), Number.POSITIVE_INFINITY));
    switch (message.type) {
      case 'utterance.received':
        setIssue(null);
        break;
      case 'transcript.final':
        setHeardWords((current) => (current && (current.speaker === null || current.speaker === message.speaker_id) ? null : current));
        if (conversation.mode === 'together' && message.speaker_id) {
          const other = conversation.participants.find((person) => person.id !== message.speaker_id);
          setNextSpeaker(other?.id ?? message.speaker_id);
        }
        break;
      case 'words.live':
        setHeardWords(message.text ? { speaker: message.speaker_id, text: message.text } : null);
        break;
      case 'session.ready': {
        serverVoiceRef.current = message.server_voice;
        setServerVoice(message.server_voice);
        meetPeople(message.participants);
        queue?.setServerVoice(message.server_voice);
        sentRef.current = {};
        if (!readyOnceRef.current) {
          readyOnceRef.current = true;
          const mode = message.server_voice ? 'natural' : 'fast';
          for (const id of listenerIds) {
            settingsRef.current = { ...settingsRef.current, [id]: { ...settingsRef.current[id], mode } };
          }
          setSettings(settingsRef.current);
          setLiveSince(Date.now());
        }
        for (const id of listenerIds) {
          applyVoice(id);
        }
        if (you && message.connected) {
          setConnected(new Set(message.connected));
        }
        clearTalking();
        setPhase('live');
        void startListening();
        break;
      }
      case 'participants.updated':
        meetPeople(message.participants);
        break;
      case 'speech.activity': {
        const who = message.speaker_id ?? 'room';
        const set = talkingRef.current;
        if (message.active) {
          set.add(who);
        } else {
          set.delete(who);
        }
        setTalking(new Set([...set].filter(isSpeakerId)));
        setRoomTalking(set.has('room'));
        queue?.setHeld(you ? set.has(you) : set.size > 0);
        break;
      }
      case 'peer.connected':
        setConnected((current) => new Set([...(current ?? []), message.participant_id]));
        break;
      case 'peer.disconnected':
      case 'peer.left':
        talkingRef.current.delete(message.participant_id);
        setTalking(new Set([...talkingRef.current].filter(isSpeakerId)));
        setConnected((current) => new Set([...(current ?? [])].filter((id) => id !== message.participant_id)));
        if (message.type === 'peer.left' && message.participant_id === 'A' && you !== 'A') {
          queue?.cancelAll();
          stopListening();
          socketRef.current?.close();
          setPhase('closed');
          setIssue('The host ended the call.');
        }
        break;
      case 'translation.final':
        if (phaseRef.current === 'live' && (!you || message.listener_id === you)) {
          queue?.expect(message.utterance_id, message.listener_id, message.text, message.target_language);
        }
        break;
      case 'tts.audio':
        queue?.audio(message.utterance_id, message.listener_id, message.audio_base64);
        break;
      case 'error':
        if (message.code === 'voice_unavailable' && message.utterance_id && message.listener_id) {
          queue?.unavailable(message.utterance_id, message.listener_id);
        } else if (message.utterance_id === null) {
          setIssue(message.message);
        }
        break;
      default:
        break;
    }
  }, [applyVoice, clearTalking, conversation.mode, conversation.participants, listenerIds, meetPeople, setPhase, startListening, stopListening, you]);

  const handleReconnecting = useCallback((reconnecting: boolean) => {
    if (!reconnecting || phaseRef.current === 'ending' || phaseRef.current === 'closed') {
      return;
    }
    queueRef.current?.cancelAll();
    clearTalking();
    setHearing(null);
    setTurns((current) => abandonPending(current, DROPPED, ownTurn));
    setPhase('reconnecting');
  }, [clearTalking, ownTurn, setPhase]);

  const handleClose = useCallback((code: number) => {
    queueRef.current?.cancelAll();
    stopListening();
    stopMeetingSound();
    if (code === 1000 || phaseRef.current === 'ending') {
      onReturnToStart();
      return;
    }
    setTurns((current) => abandonPending(current, DROPPED, ownTurn));
    setPhase('closed');
    setIssue(closeIssue(code, conversation.mode === 'remote'));
  }, [conversation.mode, onReturnToStart, ownTurn, setPhase, stopListening, stopMeetingSound]);

  useEffect(() => {
    mountedRef.current = true;
    talkingRef.current.clear();
    sentRef.current = {};
    const queue = new VoiceQueue(
      createBrowserVoicePlayer(),
      (listenerId) => {
        const wasSpeaking = speakingRef.current !== null;
        speakingRef.current = listenerId;
        setHearing(listenerId);
        if (resumeTimerRef.current !== null) {
          window.clearTimeout(resumeTimerRef.current);
          resumeTimerRef.current = null;
        }
        if (listenerId && !wasSpeaking) {
          captureRef.current?.pause();
          socketRef.current?.send({ type: 'audio.pause' });
        } else if (!listenerId && wasSpeaking) {
          resumeTimerRef.current = window.setTimeout(() => {
            resumeTimerRef.current = null;
            if (speakingRef.current === null && !mutedRef.current) {
              captureRef.current?.resume();
            }
          }, RESUME_AFTER_VOICE_MS);
        }
      },
      (language) => {
        setNotices((current) => [
          ...current,
          `No ${languageName(language)} voice in this browser. Switch to the Natural voice in Settings, or use Edge.`,
        ]);
      },
      (utteranceId, listenerId, seconds) => {
        socketRef.current?.send({ type: 'voice.played', utterance_id: utteranceId, listener_id: listenerId, seconds });
      },
    );
    if (!voiceOnRef.current) {
      for (const id of SPEAKER_IDS) {
        queue.setEnabled(id, false);
      }
    }
    const socket = new SessionSocket(handleMessage, handleClose, handleReconnecting);
    queueRef.current = queue;
    socketRef.current = socket;
    const connectTimer = window.setTimeout(() => socket.connect(conversation.streamPath), 0);
    const retryNow = (): void => socket.retryNow();
    window.addEventListener('online', retryNow);

    return () => {
      mountedRef.current = false;
      window.clearTimeout(connectTimer);
      window.removeEventListener('online', retryNow);
      if (endTimerRef.current !== null) {
        window.clearTimeout(endTimerRef.current);
      }
      if (resumeTimerRef.current !== null) {
        window.clearTimeout(resumeTimerRef.current);
      }
      queue.cancelAll();
      captureRef.current?.stop();
      captureRef.current = null;
      meetingRef.current?.stop();
      meetingRef.current = null;
      socket.close();
      queueRef.current = null;
      socketRef.current = null;
    };
  }, [handleClose, handleMessage, handleReconnecting, conversation.streamPath]);

  useEffect(() => {
    if (phase !== 'live' && phase !== 'reconnecting') {
      return undefined;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const wordsPerson = meeting
    ? participants[0]
    : participants.find((person) => person.id === (you ?? nextSpeaker)) ?? participants[0];
  const wordsLanguage = wordsPerson?.preferred_language ?? '';

  wordsHandlerRef.current = (text: string, final: boolean) => {
    setHeardWords(text ? { speaker: meeting ? 'A' : you, text } : null);
    if (conversation.mode !== 'remote') {
      return;
    }
    const at = Date.now();
    if (final || at - wordsSentRef.current >= WORDS_EVERY_MS) {
      wordsSentRef.current = at;
      socketRef.current?.send({ type: 'words.live', text: text.slice(-MAX_LIVE_WORDS) });
    }
  };

  useEffect(() => {
    if (!liveWordsOn || phase !== 'live' || !listening || !wordsLanguage) {
      liveWordsRef.current?.stop();
      liveWordsRef.current = null;
      return;
    }
    if (liveWordsRef.current) {
      liveWordsRef.current.setLanguage(wordsLanguage);
      return;
    }
    liveWordsRef.current = startLiveWords(
      wordsLanguage,
      (text, final) => wordsHandlerRef.current(text, final),
      (reason) => {
        liveWordsRef.current = null;
        setLiveWordsOn(false);
        setLiveWordsIssue(liveWordsProblem(reason, wordsLanguage));
      },
    );
  }, [listening, liveWordsOn, phase, wordsLanguage]);

  useEffect(() => {
    const words = liveWordsRef.current;
    if (muted || hearing !== null) {
      words?.pause();
    } else {
      words?.resume();
    }
  }, [hearing, listening, liveWordsOn, muted, phase]);

  useEffect(() => () => {
    liveWordsRef.current?.stop();
    liveWordsRef.current = null;
  }, []);

  useEffect(() => {
    if (!heardWords) {
      return undefined;
    }
    const timer = window.setTimeout(() => setHeardWords(null), WORDS_LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [heardWords]);

  function endSession(): void {
    const socket = socketRef.current;
    stopMeetingSound();
    if (phaseRef.current !== 'live' || !socket?.isOpen) {
      if (conversation.room && phaseRef.current !== 'closed') {
        void leaveRoom(conversation.room.roomId, conversation.room.token).catch(() => undefined);
      }
      onReturnToStart();
      return;
    }
    setPhase('ending');
    queueRef.current?.cancelAll();
    stopListening();
    socket.send({ type: 'session.stop' });
    endTimerRef.current = window.setTimeout(onReturnToStart, END_WAIT_MS);
  }

  async function restart(): Promise<void> {
    if (!onRestart) {
      return;
    }
    setRestarting(true);
    try {
      await onRestart(participants, abandonPending(turns, RESTARTED));
    } catch (error) {
      if (mountedRef.current) {
        setIssue(errorText(error, 'The conversation could not be started again.'));
        setRestarting(false);
      }
    }
  }

  function toggleMute(): void {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    captureRef.current?.mute(next);
    if (next) {
      captureRef.current?.pause();
      socketRef.current?.send(meeting ? { type: 'audio.pause', participant_id: 'A' } : { type: 'audio.pause' });
    } else if (speakingRef.current === null) {
      captureRef.current?.resume();
    }
  }

  async function toggleMeetingSound(): Promise<void> {
    if (meetingRef.current) {
      stopMeetingSound();
      socketRef.current?.send({ type: 'audio.pause', participant_id: 'B' });
      return;
    }
    setMeetingIssue(null);
    setMeetingSound('connecting');
    try {
      const capture = await openMeetingCapture();
      if (!mountedRef.current || phaseRef.current === 'ending' || phaseRef.current === 'closed') {
        capture.stop();
        return;
      }
      meetingRef.current = capture;
      capture.start(
        (frame) => {
          socketRef.current?.sendAudio(tagFrame('B', frame));
        },
        () => undefined,
        () => {
          stopMeetingSound();
          setMeetingIssue("The meeting's sound is no longer shared. Select Connect meeting to share it again.");
        },
      );
      setMeetingSound('on');
    } catch (error) {
      if (mountedRef.current) {
        setMeetingSound('off');
        setMeetingIssue(errorText(error, "The meeting's sound could not be shared."));
      }
    }
  }

  function toggleVoice(): void {
    const next = !voiceOnRef.current;
    voiceOnRef.current = next;
    setVoiceOn(next);
    for (const id of listenerIds) {
      queueRef.current?.setEnabled(id, next);
      applyVoice(id);
    }
  }

  function fixSpeaker(utteranceId: string, voice: string): void {
    setTurns((current) => fixVoice(current, utteranceId, voice));
    socketRef.current?.send({ type: 'voice.fix', utterance_id: utteranceId, voice });
  }

  function changeLiveWords(on: boolean): void {
    saveLiveWordsWanted(on);
    setLiveWordsIssue(null);
    setLiveWordsOn(on && liveWordsSupported());
    if (!on) {
      setHeardWords(null);
    }
  }

  function changeLanguage(id: SpeakerId, language: string): void {
    socketRef.current?.send({ type: 'language.set', participant_id: id, language });
    changeSettings(id, { ...settingsRef.current[id], browserVoice: null });
  }

  function runCommand(name: CallAction, args: Record<string, string>): void {
    const reader = listeners[0] ?? participants[0];
    switch (name) {
      case 'mute':
      case 'unmute':
        if (mutedRef.current !== (name === 'mute')) {
          toggleMute();
        }
        break;
      case 'voice_on':
      case 'captions_only':
        if (voiceOnRef.current !== (name === 'voice_on')) {
          toggleVoice();
        }
        break;
      case 'disconnect_meeting_sound':
        if (meetingRef.current) {
          void toggleMeetingSound();
        }
        break;
      case 'show_transcript':
      case 'hide_transcript':
        setTranscriptOpen(name === 'show_transcript');
        break;
      case 'open_settings':
        setPeopleOpen(false);
        setSettingsOpen(true);
        break;
      case 'show_people':
        setSettingsOpen(false);
        setPeopleOpen(true);
        break;
      case 'download_transcript':
        if ((args.format === 'subtitles' || args.format === 'vtt') && reader) {
          downloadSubtitles(turns, reader, names, args.format === 'vtt' ? 'vtt' : 'srt');
        } else if (args.format === 'word') {
          downloadWord(documentTitle, turns, participants, names);
        } else if (args.format === 'pdf') {
          printTranscript(documentTitle, turns, participants, names);
        } else {
          downloadText(turns, participants, names);
        }
        break;
      case 'set_my_language':
        if (listeners.length === 1 && args.language) {
          changeLanguage(listeners[0].id, args.language);
        }
        break;
      case 'end_conversation':
        endSession();
        break;
      case 'connect_meeting_sound':
        break;
    }
  }

  function commands(): CallAction[] {
    const ready: CallAction[] = [];
    if (phase === 'live' || phase === 'reconnecting' || phase === 'connecting') {
      if (listening) {
        ready.push(muted ? 'unmute' : 'mute');
      }
      if (meeting) {
        ready.push(meetingSound === 'on' ? 'disconnect_meeting_sound' : 'connect_meeting_sound');
      } else {
        ready.push(voiceOn ? 'captions_only' : 'voice_on');
      }
      ready.push('open_settings');
      if (conversation.mode === 'remote') {
        ready.push('show_people');
      }
      if (listeners.length === 1) {
        ready.push('set_my_language');
      }
    }
    ready.push(transcriptOpen ? 'hide_transcript' : 'show_transcript');
    if (turns.some((turn) => turn.original)) {
      ready.push('download_transcript');
    }
    ready.push('end_conversation');
    return ready;
  }

  useEffect(() => {
    bridge?.set(bridgeOwnerRef.current, {
      actions: commands(),
      run: runCommand,
      transcript: () => assistantTranscript(turns, names),
      language: (listeners[0] ?? participants[0])?.preferred_language ?? 'en',
      room: conversation.room ?? undefined,
    });
  });

  useEffect(() => {
    const owner = bridgeOwnerRef.current;
    return () => bridge?.clear(owner);
  }, [bridge]);

  const shownTurns = turns.length > MAX_TURNS ? turns.slice(-MAX_TURNS) : turns;
  const latest = [...shownTurns].reverse().find((turn) => turn.original);
  const announcement = latest?.original ? `${turnSpeaker(names, latest)}: ${latest.original.text}` : '';
  const liveLine: LiveLine | null = heardWords ? { name: speakerName(names, heardWords.speaker), text: heardWords.text } : null;
  const ended = phase === 'closed' || phase === 'ending';
  const meetingLanguage = [...turns].reverse().find((turn) => turn.speakerId === 'B' && turn.original)?.original?.language ?? null;
  const tiles: Tile[] = participants.map((person) => ({
    id: person.id,
    title: names[person.id],
    badge: badge(person.preferred_language),
    detail: languageLabel(person.preferred_language),
    away: you !== null && person.id !== you && connected !== null && !connected.has(person.id),
  }));
  const remote = conversation.mode === 'remote';
  const alone = remote && participants.length === 1;
  const waiting = remote && !alone && connected !== null && participants.every((person) => person.id === you || !connected.has(person.id));
  const languages = [...new Set(participants.map((person) => languageName(person.preferred_language)))];
  if (meeting) {
    tiles.push({
      id: 'B',
      title: names.B,
      badge: meetingLanguage ? badge(meetingLanguage) : '···',
      detail: meetingLanguage ? `Speaking ${languageName(meetingLanguage)}` : 'Any language',
      away: meetingSound !== 'on',
    });
  }
  let title = languages.join(' and ');
  if (meeting && participants[0]) {
    title = `Live captions in ${languageName(participants[0].preferred_language)}`;
  } else if (remote) {
    const count = `${participants.length} ${participants.length === 1 ? 'person' : 'people'}`;
    title = [conversation.title, count, languages.join(', ')].filter(Boolean).join(' · ');
  }

  return (
    <main className="call-page">
      <h1 className="visually-hidden" tabIndex={-1}>{meeting ? 'Meeting' : 'Conversation'}</h1>
      <header className="call-top">
        <p className="call-status" data-phase={phase} aria-live="polite">
          <span className="call-status-dot" aria-hidden="true" />
          {PHASE_LABELS[phase]}
        </p>
        <p className="call-title">{title}</p>
        <p className="call-timer">
          <span className="visually-hidden">Call length </span>
          {elapsed(liveSince, now)}
        </p>
      </header>

      {issue && (
        <div className="notice notice-danger call-notice" role="alert">
          <span>{issue}</span>
          {phase === 'closed' && onRestart && (
            <button className="button button-small button-primary" type="button" onClick={() => void restart()} disabled={restarting}>
              {restarting ? 'Starting again' : 'Start again'}
            </button>
          )}
        </div>
      )}
      {phase === 'reconnecting' && (
        <p className="notice call-notice" role="status">
          The connection dropped. Reconnecting by itself; your transcript is kept.
        </p>
      )}
      {phase === 'live' && waiting && (
        <p className="notice call-notice" role="status">
          Waiting for the others to connect. If their connection dropped, they will be back in a moment.
        </p>
      )}
      {micIssue && phase === 'live' && (
        <div className={`notice call-notice ${micNeedsTap ? 'notice-action' : 'notice-danger'}`} role="alert">
          <span>{micIssue}</span>
          <button
            className={`button button-small ${micNeedsTap ? 'button-primary' : 'button-secondary'}`}
            type="button"
            onClick={() => {
              unlockBrowserAudio();
              void startListening();
            }}
          >
            {micNeedsTap ? 'Turn on microphone' : 'Try again'}
          </button>
        </div>
      )}
      {meetingIssue && !ended && (
        <p className="notice notice-danger call-notice" role="alert">{meetingIssue}</p>
      )}
      {notices.map((notice) => (
        <p className="notice call-notice" role="status" key={notice}>
          {notice}
        </p>
      ))}
      <p className="visually-hidden" aria-live="polite">{announcement}</p>

      <div className="call-body" data-panel={transcriptOpen}>
        <section className="call-stage" aria-label={meeting ? 'Meeting' : 'Call'}>
          <CallTiles
            tiles={tiles}
            you={you}
            talking={talking}
            hearing={hearing}
            muted={muted}
            roomTalking={roomTalking}
          />
          {alone && !ended && (
            <div className="meeting-connect invite-stage">
              <h2>Invite people to your call</h2>
              <p>
                Send this link to up to {conversation.maxPeople - 1} people. When they open it and say hello, they join
                and everyone hears everyone else in their own language.
              </p>
              {conversation.invite ? (
                <InviteCard invite={conversation.invite} room={conversation.maxPeople - participants.length} />
              ) : (
                <p>Ask the host for the invite link.</p>
              )}
            </div>
          )}
          {meeting && meetingSound !== 'on' && !ended && (
            <div className="meeting-connect">
              <h2>Connect your meeting</h2>
              <p>
                Pick the meeting&apos;s browser tab and turn on <strong>Share tab audio</strong>. For the Teams or Zoom app,
                pick <strong>Entire screen</strong> and turn on <strong>Share system audio</strong>.
              </p>
              <p>Wear headphones so your microphone does not pick up the meeting, and let the others know captions are on.</p>
              <button
                className="button button-primary"
                type="button"
                onClick={() => void toggleMeetingSound()}
                disabled={meetingSound === 'connecting'}
              >
                {meetingSound === 'connecting' ? 'Waiting for your choice' : 'Connect meeting'}
              </button>
            </div>
          )}
          <CaptionStrip
            turns={shownTurns}
            names={names}
            readers={listeners}
            live={liveLine}
            emptyText={
              meeting
                ? 'Captions of the meeting appear here in your language after each sentence.'
                : 'Captions appear here in your language as soon as someone finishes a sentence.'
            }
          />
        </section>
        <TranscriptPanel
          open={transcriptOpen}
          title={documentTitle}
          turns={turns}
          participants={participants}
          names={names}
          you={you}
          onFixVoice={fixSpeaker}
          onClose={() => setTranscriptOpen(false)}
        />
      </div>

      <SettingsPanel
        open={settingsOpen}
        people={listeners}
        you={you}
        settings={settings}
        naturalAvailable={serverVoice}
        voiceShown={!meeting}
        room={conversation.room}
        liveWords={{ available: liveWordsSupported(), on: liveWordsOn, problem: liveWordsIssue, onChange: changeLiveWords }}
        onChange={changeSettings}
        onLanguage={changeLanguage}
        onClose={() => setSettingsOpen(false)}
      />

      {remote && (
        <InvitePanel
          open={peopleOpen}
          invite={conversation.invite}
          people={participants}
          you={you}
          connected={connected}
          maxPeople={conversation.maxPeople}
          onClose={() => setPeopleOpen(false)}
        />
      )}

      <ControlBar
        people={remote ? { count: participants.length, open: peopleOpen } : null}
        meeting={meeting ? { connected: meetingSound === 'on', busy: meetingSound === 'connecting' } : null}
        muted={muted}
        micReady={listening}
        level={level}
        voiceOn={voiceOn}
        settingsOpen={settingsOpen}
        transcriptOpen={transcriptOpen}
        ended={ended}
        onMute={toggleMute}
        onMeeting={() => void toggleMeetingSound()}
        onVoice={toggleVoice}
        onSettings={() => {
          setPeopleOpen(false);
          setSettingsOpen((open) => !open);
        }}
        onPeople={() => {
          setSettingsOpen(false);
          setPeopleOpen((open) => !open);
        }}
        onTranscript={() => setTranscriptOpen((open) => !open)}
        onAsk={onAsk}
        onEnd={endSession}
      />
    </main>
  );
}
