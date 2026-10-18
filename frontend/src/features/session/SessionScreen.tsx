import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import CallTiles from '../call/CallTiles';
import CaptionStrip from '../call/CaptionStrip';
import ControlBar from '../call/ControlBar';
import SettingsPanel, { type ListenerSettings } from '../call/SettingsPanel';
import TranscriptPanel from '../call/TranscriptPanel';
import { languageName } from '../../services/languageNames';
import { MicrophoneNeedsTap, openMicrophoneCapture, type MicrophoneCapture } from '../../services/microphoneCapture';
import type { Conversation } from '../../services/conversations';
import type { Participant, ServerMessage, SpeakerId } from '../../services/protocol';
import { SessionSocket } from '../../services/sessionSocket';
import { applyServerMessage, MAX_TURNS, type Turn } from './conversation';
import { createBrowserVoicePlayer, unlockBrowserAudio } from './voicePlayer';
import { VoiceQueue } from './voiceQueue';

interface SessionScreenProps {
  conversation: Conversation;
  onReturnToStart: () => void;
  onRestart: (() => Promise<void>) | null;
}

type SessionPhase = 'connecting' | 'live' | 'ending' | 'closed';

const END_WAIT_MS = 45_000;
const RESUME_AFTER_VOICE_MS = 600;
const WIDE_SCREEN = '(min-width: 1100px)';

const PHASE_LABELS: Record<SessionPhase, string> = {
  connecting: 'Connecting',
  live: 'Live',
  ending: 'Finishing the last sentences',
  closed: 'Ended',
};

function closeIssue(code: number, remote: boolean): string {
  switch (code) {
    case 4401:
      return 'This invite link is no longer valid. Ask for a new link.';
    case 4409:
      return 'The other person has not joined yet.';
    case 4404:
      return remote
        ? 'This conversation has ended or is open on another device. Start a new one.'
        : 'This conversation has ended or was opened somewhere else. Start it again.';
    case 4403:
      return 'This page is not allowed to connect to the backend. Check FRONTEND_ORIGIN in backend/.env.';
    case 1011:
      return 'The server had a problem with this conversation. Start it again.';
    default:
      return 'The connection to the backend was lost. Check that it is running, then start again.';
  }
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

const DEFAULT_SETTINGS: ListenerSettings = { mode: 'fast', naturalVoice: null, browserVoice: null, rate: 1 };

export default function SessionScreen({ conversation, onReturnToStart, onRestart }: SessionScreenProps) {
  const { you } = conversation;
  const socketRef = useRef<SessionSocket | null>(null);
  const captureRef = useRef<MicrophoneCapture | null>(null);
  const queueRef = useRef<VoiceQueue | null>(null);
  const speakingRef = useRef<SpeakerId | null>(null);
  const phaseRef = useRef<SessionPhase>('connecting');
  const mountedRef = useRef(true);
  const mutedRef = useRef(false);
  const endTimerRef = useRef<number | null>(null);
  const resumeTimerRef = useRef<number | null>(null);
  const serverVoiceRef = useRef(false);
  const sentRef = useRef<Partial<Record<SpeakerId, string>>>({});
  const talkingRef = useRef(new Set<string>());
  const settingsRef = useRef<Record<SpeakerId, ListenerSettings>>({ A: DEFAULT_SETTINGS, B: DEFAULT_SETTINGS });
  const voiceOnRef = useRef(true);
  const [participants, setParticipants] = useState<Participant[]>(conversation.participants);
  const [phase, setPhaseState] = useState<SessionPhase>('connecting');
  const [issue, setIssue] = useState<string | null>(null);
  const [micIssue, setMicIssue] = useState<string | null>(null);
  const [micNeedsTap, setMicNeedsTap] = useState(false);
  const [notices, setNotices] = useState<string[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [level, setLevel] = useState(0);
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
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

  const listenerIds = useMemo(
    () => conversation.participants.map((person) => person.id).filter((id) => !you || id === you),
    [conversation.participants, you],
  );
  const listeners = participants.filter((person) => listenerIds.includes(person.id));

  const setPhase = useCallback((next: SessionPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const stopListening = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    setListening(false);
    setLevel(0);
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
          socketRef.current?.sendAudio(frame);
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
  }, [stopListening]);

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
      case 'session.ready': {
        serverVoiceRef.current = message.server_voice;
        setServerVoice(message.server_voice);
        setParticipants(message.participants);
        queue?.setServerVoice(message.server_voice);
        const mode = message.server_voice ? 'natural' : 'fast';
        for (const id of listenerIds) {
          settingsRef.current = { ...settingsRef.current, [id]: { ...settingsRef.current[id], mode } };
          applyVoice(id);
        }
        setSettings(settingsRef.current);
        setPhase('live');
        setLiveSince(Date.now());
        void startListening();
        break;
      }
      case 'participants.updated':
        setParticipants(message.participants);
        break;
      case 'speech.activity': {
        const who = message.speaker_id ?? 'room';
        const set = talkingRef.current;
        if (message.active) {
          set.add(who);
        } else {
          set.delete(who);
        }
        setTalking(new Set([...set].filter((id): id is SpeakerId => id === 'A' || id === 'B')));
        setRoomTalking(set.has('room'));
        queue?.setHeld(you ? set.has(you) : set.size > 0);
        break;
      }
      case 'peer.left':
        queue?.cancelAll();
        stopListening();
        socketRef.current?.close();
        setPhase('closed');
        setIssue('The other person left, so the conversation has ended.');
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
  }, [applyVoice, listenerIds, setPhase, startListening, stopListening, you]);

  const handleClose = useCallback((code: number) => {
    queueRef.current?.cancelAll();
    stopListening();
    if (code === 1000 || phaseRef.current === 'ending') {
      onReturnToStart();
      return;
    }
    setPhase('closed');
    setIssue(closeIssue(code, conversation.mode === 'remote'));
  }, [conversation.mode, onReturnToStart, setPhase, stopListening]);

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
    );
    const socket = new SessionSocket(handleMessage, handleClose);
    queueRef.current = queue;
    socketRef.current = socket;
    const connectTimer = window.setTimeout(() => socket.connect(conversation.streamPath), 0);

    return () => {
      mountedRef.current = false;
      window.clearTimeout(connectTimer);
      if (endTimerRef.current !== null) {
        window.clearTimeout(endTimerRef.current);
      }
      if (resumeTimerRef.current !== null) {
        window.clearTimeout(resumeTimerRef.current);
      }
      queue.cancelAll();
      captureRef.current?.stop();
      captureRef.current = null;
      socket.close();
      queueRef.current = null;
      socketRef.current = null;
    };
  }, [handleClose, handleMessage, conversation.streamPath]);

  useEffect(() => {
    if (phase !== 'live') {
      return undefined;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [phase]);

  function endSession(): void {
    const socket = socketRef.current;
    if (phaseRef.current !== 'live' || !socket?.isOpen) {
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
      await onRestart();
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
      socketRef.current?.send({ type: 'audio.pause' });
    } else if (speakingRef.current === null) {
      captureRef.current?.resume();
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

  function changeLanguage(id: SpeakerId, language: string): void {
    socketRef.current?.send({ type: 'language.set', participant_id: id, language });
    changeSettings(id, { ...settingsRef.current[id], browserVoice: null });
  }

  const shownTurns = turns.length > MAX_TURNS ? turns.slice(-MAX_TURNS) : turns;
  const latest = [...shownTurns].reverse().find((turn) => turn.original);
  const latestName = you && latest?.speakerId === you
    ? 'You'
    : participants.find((person) => person.id === latest?.speakerId)?.name;
  const announcement = latest?.original ? `${latestName ?? 'Someone'}: ${latest.original.text}` : '';
  const ended = phase === 'closed' || phase === 'ending';
  const others = participants.filter((person) => !listenerIds.includes(person.id));

  return (
    <main className="call-page">
      <h1 className="visually-hidden" tabIndex={-1}>Conversation</h1>
      <header className="call-top">
        <p className="call-status" data-phase={phase} aria-live="polite">
          <span className="call-status-dot" aria-hidden="true" />
          {PHASE_LABELS[phase]}
        </p>
        <p className="call-title">
          {participants.map((person) => languageName(person.preferred_language)).join(' and ')}
        </p>
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
      {notices.map((notice) => (
        <p className="notice call-notice" role="status" key={notice}>
          {notice}
        </p>
      ))}
      <p className="visually-hidden" aria-live="polite">{announcement}</p>

      <div className="call-body" data-panel={transcriptOpen}>
        <section className="call-stage" aria-label="Call">
          <CallTiles
            participants={participants}
            you={you}
            talking={talking}
            hearing={hearing}
            muted={muted}
            roomTalking={roomTalking}
          />
          <CaptionStrip turns={shownTurns} participants={participants} readers={listenerIds} you={you} />
        </section>
        <TranscriptPanel
          open={transcriptOpen}
          turns={turns}
          participants={participants}
          you={you}
          onClose={() => setTranscriptOpen(false)}
        />
      </div>

      <SettingsPanel
        open={settingsOpen}
        people={listeners}
        others={others}
        you={you}
        settings={settings}
        naturalAvailable={serverVoice}
        onChange={changeSettings}
        onLanguage={changeLanguage}
        onClose={() => setSettingsOpen(false)}
      />

      <ControlBar
        muted={muted}
        micReady={listening}
        level={level}
        voiceOn={voiceOn}
        settingsOpen={settingsOpen}
        transcriptOpen={transcriptOpen}
        ended={ended}
        onMute={toggleMute}
        onVoice={toggleVoice}
        onSettings={() => setSettingsOpen((open) => !open)}
        onTranscript={() => setTranscriptOpen((open) => !open)}
        onEnd={endSession}
      />
    </main>
  );
}
