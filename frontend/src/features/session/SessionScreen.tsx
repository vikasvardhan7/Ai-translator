import { useCallback, useEffect, useRef, useState } from 'react';

import type { CreateSessionResponse, Participant, ServerMessage, SpeakerId } from '../../services/protocol';
import { openMicrophoneCapture, type MicrophoneCapture } from '../../services/microphoneCapture';
import { SessionSocket, type SocketStatus } from '../../services/sessionSocket';
import LevelMeter from './LevelMeter';
import StatusBar from './StatusBar';

interface SessionScreenProps {
  session: CreateSessionResponse;
  onReturnToStart: () => void;
}

type UtteranceStatus = 'recording' | 'transcribing' | 'translating' | 'complete' | 'failed';

interface ConversationTurn {
  id: string;
  speakerId: SpeakerId;
  listenerId: SpeakerId;
  status: UtteranceStatus;
  transcript?: string;
  detectedLanguage?: string;
  detectedLanguageName?: string;
  translation?: string;
  targetLanguage?: string;
  translated?: boolean;
  durationMs?: number;
  error?: string;
}

interface ActiveUtterance {
  id: string;
  speakerId: SpeakerId;
}

const MAX_RECORDING_MS = 29_000;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'The microphone could not be opened.';
}

function pendingText(turn: ConversationTurn, isSpeaker: boolean): string {
  if (turn.status === 'failed') {
    return 'This sentence could not be processed.';
  }
  if (turn.status === 'recording') {
    return isSpeaker ? 'Listening…' : 'Waiting for the transcript…';
  }
  if (turn.status === 'transcribing') {
    return isSpeaker ? 'Transcribing…' : 'Preparing the translation…';
  }
  if (turn.status === 'translating') {
    return isSpeaker ? 'Transcript received.' : 'Translating…';
  }
  return '';
}

export default function SessionScreen({ session, onReturnToStart }: SessionScreenProps) {
  const socketRef = useRef<SessionSocket | null>(null);
  const captureRef = useRef<MicrophoneCapture | null>(null);
  const activeUtteranceRef = useRef<ActiveUtterance | null>(null);
  const microphoneRequestRef = useRef(0);
  const pendingSpeakerRef = useRef<SpeakerId | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const utteranceListRefs = useRef<Record<SpeakerId, HTMLDivElement | null>>({ A: null, B: null });
  const autoScrollEnabledRef = useRef<Record<SpeakerId, boolean>>({ A: true, B: true });
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('connecting');
  const [channelReady, setChannelReady] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const [closeCode, setCloseCode] = useState<number | null>(null);
  const [pendingSpeaker, setPendingSpeaker] = useState<SpeakerId | null>(null);
  const [activeSpeaker, setActiveSpeaker] = useState<SpeakerId | null>(null);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const isProcessing = turns.some((turn) => turn.status === 'transcribing' || turn.status === 'translating');

  const stopActiveUtterance = useCallback((sendEnd: boolean, failure?: string) => {
    const active = activeUtteranceRef.current;
    if (!active) {
      return;
    }

    if (recordingTimerRef.current !== null) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    activeUtteranceRef.current = null;
    setActiveSpeaker(null);
    setMicrophoneLevel(0);
    captureRef.current?.stop(sendEnd && Boolean(socketRef.current?.isOpen));
    captureRef.current = null;

    const sent = sendEnd && (socketRef.current?.send({
      type: 'utterance.end',
      utterance_id: active.id,
    }) ?? false);
    const finalFailure = failure ?? (!sent ? 'The live channel closed before this recording could be sent.' : undefined);

    setTurns((current) => current.map((turn) => turn.id === active.id
      ? {
          ...turn,
          status: finalFailure ? 'failed' : 'transcribing',
          ...(finalFailure ? { error: finalFailure } : {}),
        }
      : turn));

    if (finalFailure) {
      setIssue(finalFailure);
    }
  }, []);

  useEffect(() => {
    const latestTurn = turns[turns.length - 1];
    if (!latestTurn) {
      return;
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const speakerId of [latestTurn.speakerId, latestTurn.listenerId]) {
      const list = utteranceListRefs.current[speakerId];
      if (list && autoScrollEnabledRef.current[speakerId]) {
        list.scrollTo({
          top: list.scrollHeight,
          behavior: reduceMotion ? 'instant' : 'smooth',
        });
      }
    }
  }, [turns.length]);

  useEffect(() => {
    const socket = new SessionSocket(
      (message: ServerMessage) => {
        if (message.type === 'session.ready') {
          setChannelReady(true);
          setIssue(null);
          setCloseCode(null);
          return;
        }

        if (message.type === 'utterance.received') {
          setTurns((current) => current.map((turn) => turn.id === message.utterance_id
            ? { ...turn, status: 'transcribing', durationMs: message.duration_ms }
            : turn));
          return;
        }

        if (message.type === 'transcript.final') {
          setTurns((current) => current.map((turn) => turn.id === message.utterance_id
            ? {
                ...turn,
                status: 'translating',
                transcript: message.text,
                detectedLanguage: message.language,
                detectedLanguageName: message.language_name,
              }
            : turn));
          return;
        }

        if (message.type === 'translation.final') {
          setTurns((current) => current.map((turn) => turn.id === message.utterance_id
            ? {
                ...turn,
                status: 'complete',
                translation: message.text,
                targetLanguage: message.target_language,
                translated: message.translated,
              }
            : turn));
          return;
        }

        if (message.type === 'error') {
          setIssue(message.message);
          if (message.utterance_id) {
            setTurns((current) => current.map((turn) => turn.id === message.utterance_id
              ? { ...turn, status: 'failed', error: message.message }
              : turn));
          }
        }
      },
      (status) => {
        setSocketStatus(status);
        if (status === 'connecting') {
          setChannelReady(false);
        }
        if (status === 'closed' && activeUtteranceRef.current) {
          stopActiveUtterance(false, 'The live channel closed while recording. Reconnect and try again.');
        }
      },
      (code) => {
        setCloseCode(code);
        if (code === 1000) {
          onReturnToStart();
          return;
        }
        setChannelReady(false);
        stopActiveUtterance(false, 'The live channel closed while recording. Reconnect and try again.');
        if (code === 4403) {
          setIssue('This page is not allowed to connect. Check FRONTEND_ORIGIN.');
        } else if (code === 4404) {
          setIssue((current) => current ?? 'This session has ended. Start a new one.');
        } else if (code === 1011) {
          setIssue((current) => current ?? 'Connection lost');
        } else {
          setIssue((current) => current ?? 'Connection lost');
        }
      },
    );

    socketRef.current = socket;
    socket.connect(session.session_id);
    return () => {
      microphoneRequestRef.current += 1;
      pendingSpeakerRef.current = null;
      stopActiveUtterance(true);
      socket.close();
      socketRef.current = null;
    };
  }, [onReturnToStart, session.session_id, stopActiveUtterance]);

  async function startRecording(participant: Participant): Promise<void> {
    const socket = socketRef.current;
    if (
      !channelReady ||
      !socket?.isOpen ||
      activeUtteranceRef.current ||
      pendingSpeakerRef.current
    ) {
      return;
    }

    const listener = session.participants.find((candidate) => candidate.id !== participant.id);
    if (!listener) {
      setIssue('The other speaker could not be found in this session.');
      return;
    }

    const requestId = microphoneRequestRef.current + 1;
    microphoneRequestRef.current = requestId;
    pendingSpeakerRef.current = participant.id;
    setPendingSpeaker(participant.id);
    setIssue(null);

    let capture: MicrophoneCapture | null = null;
    try {
      capture = await openMicrophoneCapture();
      if (requestId !== microphoneRequestRef.current) {
        capture.stop();
        return;
      }

      const currentSocket = socketRef.current;
      if (!currentSocket?.isOpen) {
        capture.stop();
        throw new Error('The live channel is closed. Reconnect before recording.');
      }

      const utteranceId = crypto.randomUUID();
      const turn: ConversationTurn = {
        id: utteranceId,
        speakerId: participant.id,
        listenerId: listener.id,
        status: 'recording',
      };

      if (!currentSocket.send({
        type: 'utterance.start',
        utterance_id: utteranceId,
        speaker_id: participant.id,
        spoken_language: participant.preferred_language,
      })) {
        capture.stop();
        throw new Error('The live channel closed before recording could start.');
      }

      activeUtteranceRef.current = { id: utteranceId, speakerId: participant.id };
      captureRef.current = capture;
      setActiveSpeaker(participant.id);
      setTurns((current) => [...current, turn].slice(-50));
      capture.start((frame) => {
        if (!socketRef.current?.sendAudio(frame)) {
          stopActiveUtterance(false, 'The live channel closed while recording. Reconnect and try again.');
        }
      }, setMicrophoneLevel);

      recordingTimerRef.current = window.setTimeout(() => {
        setIssue('Recording stopped at the 30 second limit. Sending the captured speech for translation.');
        stopActiveUtterance(true);
      }, MAX_RECORDING_MS);
    } catch (error) {
      capture?.stop();
      if (activeUtteranceRef.current) {
        stopActiveUtterance(true, errorText(error));
      } else {
        setIssue(errorText(error));
      }
    } finally {
      if (requestId === microphoneRequestRef.current) {
        pendingSpeakerRef.current = null;
        setPendingSpeaker(null);
      }
    }
  }

  function toggleRecording(participant: Participant): void {
    if (activeUtteranceRef.current?.speakerId === participant.id) {
      stopActiveUtterance(true);
      return;
    }
    void startRecording(participant);
  }

  function reconnect(): void {
    microphoneRequestRef.current += 1;
    pendingSpeakerRef.current = null;
    setPendingSpeaker(null);
    stopActiveUtterance(false, 'Recording stopped because the live channel is reconnecting.');
    setIssue(null);
    setCloseCode(null);
    setChannelReady(false);
    socketRef.current?.connect(session.session_id);
  }

  function endSession(): void {
    microphoneRequestRef.current += 1;
    pendingSpeakerRef.current = null;
    stopActiveUtterance(true);
    socketRef.current?.send({ type: 'session.stop' });
    onReturnToStart();
  }

  return (
    <main className="page-content session-page">
      <div className="page-heading-row">
        <div>
          <p className="eyebrow">Conversation</p>
          <h1 tabIndex={-1}>Voice Translator</h1>
        </div>
      </div>
      <StatusBar
        socketStatus={socketStatus}
        channelReady={channelReady}
        issue={issue}
        closeCode={closeCode}
        onReconnect={reconnect}
        onEnd={endSession}
        onNewSession={onReturnToStart}
      />
      <div className="conversation-grid">
        {session.participants.map((participant) => {
          const isRecording = activeSpeaker === participant.id;
          const isRequestingMicrophone = pendingSpeaker === participant.id;
          const otherSpeakerIsBusy = Boolean(
            (activeSpeaker && activeSpeaker !== participant.id) ||
            (pendingSpeaker && pendingSpeaker !== participant.id),
          );
          const visibleTurns = turns.filter((turn) => (
            turn.speakerId === participant.id || turn.listenerId === participant.id
          ));

          return (
            <section className="conversation-panel" key={participant.id} aria-labelledby={`person-${participant.id}-title`}>
              <header className="conversation-panel-header">
                <div>
                  <p className="eyebrow">Person {participant.id}</p>
                  <h2 id={`person-${participant.id}-title`}>{participant.name}</h2>
                </div>
                <span className="language-label" lang={participant.preferred_language} dir="auto">
                  {participant.preferred_language}
                </span>
              </header>
              <div className="conversation-controls">
                <button
                  className={`button talk-button ${isRecording ? 'button-recording' : 'button-primary'}`}
                  type="button"
                  disabled={!channelReady || otherSpeakerIsBusy || isRequestingMicrophone || isProcessing}
                  aria-pressed={isRecording}
                  aria-busy={isRequestingMicrophone || isProcessing}
                  aria-label={`${participant.name}: ${isRecording
                    ? 'Stop and translate'
                    : isRequestingMicrophone
                      ? 'Opening microphone'
                      : isProcessing
                        ? 'Processing translation'
                        : 'Start speaking'}`}
                  onClick={() => toggleRecording(participant)}
                >
                  {isRequestingMicrophone
                    ? 'Opening microphone…'
                    : isRecording
                      ? 'Stop & translate'
                      : isProcessing
                        ? <><span className="spinner" aria-hidden="true" />Processing</>
                      : 'Start speaking'}
                </button>
                {isRecording && <LevelMeter personName={participant.name} level={microphoneLevel} />}
                <p className="speaker-hint" aria-live="polite">
                  {isRequestingMicrophone
                    ? 'Allow microphone access in your browser if prompted.'
                    : isRecording
                      ? 'Recording. Select Stop & translate when finished, up to 30 seconds.'
                      : isProcessing
                        ? 'The transcript and translation are being processed.'
                      : channelReady
                        ? 'Your microphone is used only while recording.'
                        : 'Waiting for the live channel to open.'}
                </p>
              </div>
              <div
                className="utterance-list"
                aria-live="polite"
                aria-relevant="additions text"
                ref={(element) => { utteranceListRefs.current[participant.id] = element; }}
                onScroll={(event) => {
                  const list = event.currentTarget;
                  autoScrollEnabledRef.current[participant.id] = (
                    list.scrollHeight - list.scrollTop - list.clientHeight <= 36
                  );
                }}
              >
                {visibleTurns.length === 0 ? (
                  <p className="conversation-empty">
                    {participant.id === 'A'
                      ? 'This person’s transcript will appear here.'
                      : 'Translations for this person will appear here.'}
                  </p>
                ) : (
                  visibleTurns.map((turn) => {
                    const isSpeaker = turn.speakerId === participant.id;
                    const speaker = session.participants.find((candidate) => candidate.id === turn.speakerId);
                    const detectedLanguage = turn.detectedLanguageName ?? turn.detectedLanguage;
                    const label = isSpeaker
                      ? `Transcript${detectedLanguage ? ` · ${detectedLanguage}` : ''}`
                      : `Translation from ${speaker?.name ?? `Person ${turn.speakerId}`}${turn.targetLanguage ? ` · ${turn.targetLanguage}` : ''}`;
                    const alreadyInLanguage = !isSpeaker && turn.translated === false;
                    const text = isSpeaker
                      ? turn.transcript ?? pendingText(turn, true)
                      : alreadyInLanguage
                        ? turn.transcript ?? turn.translation ?? pendingText(turn, false)
                        : turn.translation ?? pendingText(turn, false);
                    const isProcessing = turn.status === 'transcribing' || turn.status === 'translating';

                    return (
                      <article className={`utterance-card utterance-${turn.status}`} key={turn.id}>
                        <p className="utterance-label">{label}</p>
                        {isProcessing && (
                          <p className="utterance-status">
                            <span className="spinner status-spinner" aria-hidden="true" />
                            <span>{turn.status === 'transcribing' ? 'Transcribing' : 'Translating'}</span>
                          </p>
                        )}
                        <p className={isSpeaker ? 'utterance-transcript' : 'utterance-translation'} dir="auto">
                          {text}
                        </p>
                        {!isSpeaker && turn.translated === true && turn.transcript && (
                          <p className="utterance-original" dir="auto">{turn.transcript}</p>
                        )}
                        {alreadyInLanguage && (
                          <p className="utterance-note">Already in your language</p>
                        )}
                        {turn.durationMs !== undefined && turn.status !== 'complete' && (
                          <p className="utterance-duration">Received {(turn.durationMs / 1000).toFixed(1)} s</p>
                        )}
                        {turn.error && <p className="utterance-error">{turn.error}</p>}
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
