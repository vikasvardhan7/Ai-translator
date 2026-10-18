import { useCallback, useEffect, useRef, useState } from 'react';

import { languageName } from '../../services/languageNames';
import { openMicrophoneCapture, type MicrophoneCapture } from '../../services/microphoneCapture';
import type { CreateSessionResponse, ServerMessage, SpeakerId } from '../../services/protocol';
import { SessionSocket } from '../../services/sessionSocket';
import { applyServerMessage, type Turn } from './conversation';
import ConversationPanel from './ConversationPanel';
import ListeningOrb, { type OrbState } from './ListeningOrb';
import StatusBar, { type SessionPhase } from './StatusBar';
import { createBrowserVoicePlayer } from './voicePlayer';
import { VoiceQueue } from './voiceQueue';

interface SessionScreenProps {
  session: CreateSessionResponse;
  onReturnToStart: () => void;
  onRestart: () => Promise<void>;
}

const END_WAIT_MS = 45_000;

function closeIssue(code: number): string {
  switch (code) {
    case 4404:
      return 'This conversation has ended or was opened somewhere else. Start it again.';
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

export default function SessionScreen({ session, onReturnToStart, onRestart }: SessionScreenProps) {
  const socketRef = useRef<SessionSocket | null>(null);
  const captureRef = useRef<MicrophoneCapture | null>(null);
  const queueRef = useRef<VoiceQueue | null>(null);
  const speakingRef = useRef<SpeakerId | null>(null);
  const phaseRef = useRef<SessionPhase>('connecting');
  const mountedRef = useRef(true);
  const endTimerRef = useRef<number | null>(null);
  const [phase, setPhaseState] = useState<SessionPhase>('connecting');
  const [issue, setIssue] = useState<string | null>(null);
  const [micIssue, setMicIssue] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [level, setLevel] = useState(0);
  const [listening, setListening] = useState(false);
  const [speakingTo, setSpeakingTo] = useState<SpeakerId | null>(null);
  const [voiceOn, setVoiceOn] = useState<Record<SpeakerId, boolean>>({ A: true, B: true });
  const voiceOnRef = useRef<Record<SpeakerId, boolean>>({ A: true, B: true });
  const [restarting, setRestarting] = useState(false);

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
      if (speakingRef.current) {
        capture.pause();
      }
      setListening(true);
    } catch (error) {
      if (mountedRef.current) {
        setMicIssue(errorText(error, 'The microphone could not be opened.'));
      }
    }
  }, [stopListening]);

  const handleMessage = useCallback((message: ServerMessage) => {
    const queue = queueRef.current;
    setTurns((current) => applyServerMessage(current, message));
    switch (message.type) {
      case 'utterance.received':
        setIssue(null);
        break;
      case 'session.ready':
        queue?.setServerVoice(message.server_voice);
        setPhase('live');
        void startListening();
        break;
      case 'translation.final':
        if (phaseRef.current === 'live') {
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
  }, [setPhase, startListening]);

  const handleClose = useCallback((code: number) => {
    queueRef.current?.cancelAll();
    stopListening();
    if (code === 1000 || phaseRef.current === 'ending') {
      onReturnToStart();
      return;
    }
    setPhase('closed');
    setIssue(closeIssue(code));
  }, [onReturnToStart, setPhase, stopListening]);

  useEffect(() => {
    mountedRef.current = true;
    const queue = new VoiceQueue(
      createBrowserVoicePlayer(),
      (listenerId) => {
        const wasSpeaking = speakingRef.current !== null;
        speakingRef.current = listenerId;
        setSpeakingTo(listenerId);
        if (listenerId && !wasSpeaking) {
          captureRef.current?.pause();
          socketRef.current?.send({ type: 'audio.pause' });
        } else if (!listenerId && wasSpeaking) {
          captureRef.current?.resume();
        }
      },
      (language) => {
        setNotices((current) => [...current, `No ${languageName(language)} voice on this computer, captions only.`]);
      },
    );
    const socket = new SessionSocket(handleMessage, handleClose);
    queueRef.current = queue;
    socketRef.current = socket;
    const connectTimer = window.setTimeout(() => socket.connect(session.session_id), 0);

    return () => {
      mountedRef.current = false;
      window.clearTimeout(connectTimer);
      if (endTimerRef.current !== null) {
        window.clearTimeout(endTimerRef.current);
      }
      queue.cancelAll();
      captureRef.current?.stop();
      captureRef.current = null;
      socket.close();
      queueRef.current = null;
      socketRef.current = null;
    };
  }, [handleClose, handleMessage, session.session_id]);

  function endSession(): void {
    const socket = socketRef.current;
    if (!socket?.isOpen) {
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

  const toggleVoice = useCallback((id: SpeakerId) => {
    const next = { ...voiceOnRef.current, [id]: !voiceOnRef.current[id] };
    voiceOnRef.current = next;
    setVoiceOn(next);
    queueRef.current?.setEnabled(id, next[id]);
  }, []);

  const orbState: OrbState = phase === 'connecting'
    ? 'connecting'
    : phase !== 'live' || !listening
      ? 'stopped'
      : speakingTo
        ? 'speaking'
        : 'listening';
  const speakingName = session.participants.find((person) => person.id === speakingTo)?.name ?? null;
  const latest = [...turns].reverse().find((turn) => turn.original);
  const latestName = session.participants.find((person) => person.id === latest?.speakerId)?.name;
  const announcement = latest?.original ? `${latestName ?? 'Someone'}: ${latest.original.text}` : '';

  return (
    <main className="page-content session-page">
      <div className="page-heading-row">
        <p className="eyebrow">Conversation</p>
        <h1 tabIndex={-1}>Voice Translator</h1>
      </div>
      <StatusBar
        phase={phase}
        issue={issue}
        restarting={restarting}
        onEnd={endSession}
        onRestart={() => void restart()}
        onLeave={onReturnToStart}
      />
      <ListeningOrb state={orbState} level={level} speakingTo={speakingName} />
      {micIssue && phase === 'live' && (
        <div className="notice notice-danger" role="alert">
          <span>{micIssue}</span>
          <button className="button button-small button-secondary" type="button" onClick={() => void startListening()}>
            Try again
          </button>
        </div>
      )}
      {notices.map((notice) => (
        <p className="notice" role="status" key={notice}>
          {notice}
        </p>
      ))}
      <p className="visually-hidden" aria-live="polite">{announcement}</p>
      <div className="conversation-grid">
        {session.participants.map((person) => (
          <ConversationPanel
            key={person.id}
            person={person}
            participants={session.participants}
            turns={turns}
            voiceOn={voiceOn[person.id]}
            speaking={speakingTo === person.id}
            onToggleVoice={toggleVoice}
          />
        ))}
      </div>
    </main>
  );
}
