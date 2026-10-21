import { useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { CallBridgeContext, type CallAction } from '../desktop/bridge';
import type { LanguageOption } from '../consent/languageOptions';
import type { Conversation } from '../../services/conversations';
import { languageName } from '../../services/languageNames';
import { liveWordsSupported, liveWordsWanted, saveLiveWordsWanted } from '../../services/liveWords';
import type { SpeakerId } from '../../services/protocol';
import CaptionRibbon, { type PendingLine } from './CaptionRibbon';
import { captionLines, clock, joinNames, recentCaptions, sameLanguage, unreadCount, type CaptionLine } from './captions';
import { ChatPanel, InviteLink, PanelFrame, PeoplePanel, SettingsPanel } from './Panels';
import MeetIcon from './MeetIcon';
import { downloadBlob, MeetingRecorder, recordingName, recordingSupported, type RecordingTile } from './recorder';
import { useAudioLevels } from './useAudioLevels';
import type { LocalMedia } from './useLocalMedia';
import { useMeetingCall, type CallEnd } from './useMeetingCall';
import VideoTile, { RemoteAudio } from './VideoTile';

export interface CallSummary {
  end: CallEnd;
  seconds: number;
  recorded: boolean;
}

interface CallViewProps {
  conversation: Conversation;
  local: LocalMedia;
  languages: LanguageOption[];
  title: string;
  onLanguage: (code: string) => void;
  onEnded: (summary: CallSummary) => void;
}

type Panel = 'chat' | 'people' | 'settings';

const CAPTIONS_KEY = 'voice-translator-meet-captions';
const TOAST_MS = 5_000;

function captionsWanted(): boolean {
  try {
    return window.localStorage.getItem(CAPTIONS_KEY) !== 'off';
  } catch {
    return true;
  }
}

function saveCaptionsWanted(on: boolean): void {
  try {
    window.localStorage.setItem(CAPTIONS_KEY, on ? 'on' : 'off');
  } catch {
    return;
  }
}

export default function CallView({ conversation, local, languages, title, onLanguage, onEnded }: CallViewProps) {
  const you: SpeakerId = conversation.you ?? 'A';
  const host = you === 'A';
  const bridge = useContext(CallBridgeContext);
  const bridgeOwnerRef = useRef({});
  const [panel, setPanel] = useState<Panel | null>(null);
  const [captionsOn, setCaptionsOn] = useState(captionsWanted);
  const [liveWordsOn, setLiveWordsOn] = useState(() => liveWordsSupported() && liveWordsWanted());
  const [seenId, setSeenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [confirm, setConfirm] = useState<'record' | 'end' | null>(null);
  const [recordingHere, setRecordingHere] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const recorderRef = useRef<MeetingRecorder | null>(null);
  const recordedRef = useRef(false);
  const startedRecordingRef = useRef<Date | null>(null);
  const videosRef = useRef(new Map<SpeakerId, HTMLVideoElement>());
  const sceneRef = useRef<{ tiles: RecordingTile[]; captions: Array<{ name: string; text: string }> }>({ tiles: [], captions: [] });
  const endedRef = useRef(false);

  const call = useMeetingCall(conversation, {
    audio: local.audio,
    video: local.video,
    micOn: local.micOn,
    cameraOn: local.cameraOn,
    liveWordsOn,
  });
  const { participants, everyone, streams, media, connected, peerStates } = call;
  const me = participants.find((person) => person.id === you);
  const myLanguage = me?.preferred_language ?? conversation.participants.find((person) => person.id === you)?.preferred_language ?? 'en';
  const nameOf = useCallback(
    (id: SpeakerId | null) => (id === you ? 'You' : everyone.find((person) => person.id === id)?.name ?? 'Someone'),
    [everyone, you],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const lastChatId = call.chat[call.chat.length - 1]?.id ?? null;
  useEffect(() => {
    if (panel === 'chat') {
      setSeenId(lastChatId);
    }
  }, [lastChatId, panel]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!call.notice) {
      return undefined;
    }
    const timer = window.setTimeout(call.clearNotice, TOAST_MS + 2_000);
    return () => window.clearTimeout(timer);
  }, [call.clearNotice, call.notice]);

  const audioTracks = useMemo(() => {
    const tracks: Record<string, MediaStreamTrack | null> = { [you]: local.audio };
    for (const [id, stream] of Object.entries(streams)) {
      tracks[id] = stream?.getAudioTracks()[0] ?? null;
    }
    return tracks;
  }, [local.audio, streams, you]);
  const levels = useAudioLevels(audioTracks);

  const { announceRecording } = call;
  const stoppingRef = useRef<Promise<void> | null>(null);
  const stopRecording = useCallback((announce: boolean): Promise<void> => {
    const recorder = recorderRef.current;
    if (!recorder) {
      return stoppingRef.current ?? Promise.resolve();
    }
    recorderRef.current = null;
    setRecordingHere(false);
    if (announce) {
      announceRecording(false);
    }
    stoppingRef.current = recorder.stop().then((blob) => {
      if (blob.size > 0) {
        downloadBlob(recordingName(startedRecordingRef.current ?? new Date(), blob.type), blob);
        recordedRef.current = true;
      }
    });
    return stoppingRef.current;
  }, [announceRecording]);

  function startRecording(): void {
    setConfirm(null);
    try {
      startedRecordingRef.current = new Date();
      recorderRef.current = new MeetingRecorder(
        {
          title,
          tiles: () => sceneRef.current.tiles,
          captions: () => sceneRef.current.captions,
        },
        Object.values(audioTracks).filter((track): track is MediaStreamTrack => track !== null),
      );
      setRecordingHere(true);
      call.announceRecording(true);
      setToast('Recording. Everyone in the call can see the Recording sign.');
    } catch (error) {
      recorderRef.current = null;
      setToast(error instanceof Error ? error.message : 'Recording could not start in this browser.');
    }
  }

  useEffect(() => {
    recorderRef.current?.setAudio(Object.values(audioTracks).filter((track): track is MediaStreamTrack => track !== null));
  }, [audioTracks]);

  useEffect(() => () => {
    void stopRecording(false);
  }, [stopRecording]);

  useEffect(() => {
    if (call.phase !== 'ended' || !call.end || endedRef.current) {
      return;
    }
    endedRef.current = true;
    const end = call.end;
    const seconds = call.since === null ? 0 : Math.round((Date.now() - call.since) / 1000);
    void stopRecording(false).finally(() => onEnded({ end, seconds, recorded: recordedRef.current }));
  }, [call.end, call.phase, call.since, onEnded, stopRecording]);

  const lines = useMemo(() => captionLines(call.turns, you, myLanguage), [call.turns, myLanguage, you]);
  const shown = captionsOn ? recentCaptions(lines, now) : [];

  const pending: PendingLine[] = [];
  if (captionsOn) {
    const processing = new Set(call.turns.filter((turn) => turn.status === 'processing' && turn.speakerId).map((turn) => turn.speakerId!));
    for (const person of participants) {
      const words = call.liveWords[person.id];
      if (person.id === you) {
        if (words) {
          pending.push({ key: person.id, name: 'You', text: words, language: '' });
        }
        continue;
      }
      const same = sameLanguage(person.preferred_language, myLanguage);
      if (words && same) {
        pending.push({ key: person.id, name: person.name, text: words, language: '' });
      } else if (words || call.talking.has(person.id) || processing.has(person.id)) {
        pending.push({ key: person.id, name: person.name, text: '', language: same ? '' : languageName(person.preferred_language) });
      }
    }
  }

  const ordered = [...participants.filter((person) => person.id !== you), ...participants.filter((person) => person.id === you)];
  const tiles = ordered.map((person) => {
    const mine = person.id === you;
    const stream = streams[person.id] ?? null;
    const state = media[person.id];
    const video = mine ? local.video : stream?.getVideoTracks()[0] ?? null;
    return {
      person,
      mine,
      video,
      showVideo: mine ? local.cameraOn && local.video !== null : state?.camera !== false,
      micOn: mine ? local.micOn && local.audio !== null : state?.mic !== false,
      away: !mine && !connected.has(person.id) && peerStates[person.id] !== 'connected',
      level: levels[person.id] ?? 0,
    };
  });

  sceneRef.current = {
    tiles: tiles.map((tile) => ({
      name: tile.mine ? `${tile.person.name} (you)` : tile.person.name,
      video: tile.showVideo && !tile.away ? videosRef.current.get(tile.person.id) ?? null : null,
      speaking: tile.micOn && tile.level >= 0.2,
      muted: !tile.micOn,
    })),
    captions: recentCaptions(lines, Date.now(), 2).map((line: CaptionLine) => ({ name: nameOf(line.speakerId), text: line.text })),
  };

  const { tryVideo } = call;
  const retryCallbacks = useMemo(() => {
    const callbacks = new Map<SpeakerId, () => void>();
    for (const id of ['A', 'B', 'C', 'D', 'E', 'F'] as SpeakerId[]) {
      callbacks.set(id, () => tryVideo(id));
    }
    return callbacks;
  }, [tryVideo]);

  const videoCallbacks = useMemo(() => {
    const callbacks = new Map<SpeakerId, (element: HTMLVideoElement | null) => void>();
    for (const id of ['A', 'B', 'C', 'D', 'E', 'F'] as SpeakerId[]) {
      callbacks.set(id, (element) => {
        if (element) {
          videosRef.current.set(id, element);
        } else {
          videosRef.current.delete(id);
        }
      });
    }
    return callbacks;
  }, []);

  const recorders = [...call.recording].filter((id) => participants.some((person) => person.id === id) || id === you);
  const recordingWho = joinNames(recorders.map((id) => (id === you ? 'you' : nameOf(id))));
  const unread = panel === 'chat' ? 0 : unreadCount(call.chat, seenId, you);
  const alone = participants.length === 1;
  const live = call.phase === 'live';
  const inviteLink = conversation.invite?.link ?? null;

  function togglePanel(next: Panel): void {
    setPanel((current) => (current === next ? null : next));
  }

  function toggleCaptions(): void {
    setCaptionsOn((current) => {
      saveCaptionsWanted(!current);
      return !current;
    });
  }

  function changeLiveWords(on: boolean): void {
    saveLiveWordsWanted(on);
    setLiveWordsOn(on && liveWordsSupported());
  }

  function changeLanguage(code: string): void {
    call.setLanguage(code);
    onLanguage(code);
  }

  function leave(): void {
    if (host && participants.length > 1 && confirm !== 'end') {
      setConfirm('end');
      return;
    }
    setConfirm(null);
    void stopRecording(true);
    call.leave();
  }

  function keys(event: KeyboardEvent<HTMLDivElement>): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'd') {
      event.preventDefault();
      local.toggleMic();
    } else if (key === 'e') {
      event.preventDefault();
      void local.toggleCamera();
    }
  }

  function runCommand(name: CallAction, args: Record<string, string>): void {
    switch (name) {
      case 'mute':
      case 'unmute':
        if (local.micOn !== (name === 'unmute')) {
          local.toggleMic();
        }
        break;
      case 'show_people':
        setPanel('people');
        break;
      case 'open_settings':
        setPanel('settings');
        break;
      case 'set_my_language':
        if (args.language) {
          changeLanguage(args.language);
        }
        break;
      case 'end_conversation':
        if (args.from === 'window') {
          leave();
        } else {
          void stopRecording(true);
          call.leave();
        }
        break;
      default:
        break;
    }
  }

  useEffect(() => {
    bridge?.set(bridgeOwnerRef.current, {
      actions: [local.micOn ? 'mute' : 'unmute', 'show_people', 'open_settings', 'set_my_language', 'end_conversation'],
      run: runCommand,
      transcript: () => lines.slice(-200).map((line) => ({ speaker: nameOf(line.speakerId), text: line.text.slice(0, 500) })),
      language: myLanguage,
    });
  });

  useEffect(() => {
    const owner = bridgeOwnerRef.current;
    return () => bridge?.clear(owner);
  }, [bridge]);

  const micOn = local.micOn && local.audio !== null;
  const cameraOn = local.cameraOn && local.video !== null;

  return (
    <div className="meet-call" data-panel={panel ?? 'none'} onKeyDown={keys}>
      <header className="meet-top">
        <p className="meet-title" dir="auto">{title}</p>
        <p className="meet-clock">
          <span className="visually-hidden">Call length </span>
          {clock(call.since, now)}
        </p>
        {recorders.length > 0 && (
          <p className="meet-rec" role="status">
            <span className="meet-rec-dot" aria-hidden="true" />
            Recording{recordingWho ? `: ${recordingWho}` : ''}
          </p>
        )}
        <p className="meet-lang" title="Captions language">
          <MeetIcon name="translate" />
          {languageName(myLanguage)}
        </p>
      </header>

      {(call.phase === 'connecting' || call.phase === 'reconnecting') && (
        <p className="meet-banner" role="status">
          <span className="meet-spinner" aria-hidden="true" />
          {call.phase === 'connecting' ? 'Joining the call' : 'Connection dropped. Reconnecting by itself.'}
        </p>
      )}
      {call.phase === 'leaving' && (
        <p className="meet-banner" role="status">
          <span className="meet-spinner" aria-hidden="true" />
          Leaving the call
        </p>
      )}
      {(toast || call.notice || call.captionProblem || local.micProblem) && (
        <div className="meet-toasts">
          {toast && <p className="meet-toast" role="status">{toast}</p>}
          {call.notice && <p className="meet-toast" role="alert">{call.notice}</p>}
          {call.captionProblem && <p className="meet-toast meet-toast-bad" role="alert">{call.captionProblem}</p>}
          {local.micProblem && <p className="meet-toast meet-toast-bad" role="alert">{local.micProblem}</p>}
        </div>
      )}

      <div className="meet-body">
        <section className="meet-stage" aria-label="People in the call" data-count={tiles.length} data-alone={alone}>
          {tiles.map((tile) => (
            <div className="meet-cell" key={tile.person.id}>
              <VideoTile
                name={tile.person.name}
                you={tile.mine}
                video={tile.video}
                showVideo={tile.showVideo}
                micOn={tile.micOn}
                level={tile.level}
                languageName={tile.mine ? '' : languageName(tile.person.preferred_language)}
                away={tile.away}
                peerState={tile.mine ? null : peerStates[tile.person.id] ?? null}
                onRetry={retryCallbacks.get(tile.person.id)}
                onVideo={videoCallbacks.get(tile.person.id)}
              />
            </div>
          ))}
          {alone && live && (
            <div className="meet-alone">
              <h2>You&apos;re the only one here</h2>
              {inviteLink ? (
                <InviteLink link={inviteLink} problem={conversation.invite?.problem ?? null} room={conversation.maxPeople - 1} />
              ) : (
                <p>The others will appear here as soon as they join.</p>
              )}
            </div>
          )}
        </section>

        {panel === 'chat' && (
          <PanelFrame id="meet-chat" title="Chat" onClose={() => setPanel(null)}>
            <ChatPanel chat={call.chat} you={you} live={live} onSend={call.sendChat} />
          </PanelFrame>
        )}
        {panel === 'people' && (
          <PanelFrame id="meet-people" title="People" onClose={() => setPanel(null)}>
            <PeoplePanel
              participants={participants}
              you={you}
              connected={connected}
              media={media}
              peerStates={peerStates}
              recording={call.recording}
              maxPeople={conversation.maxPeople}
              inviteLink={inviteLink}
              inviteProblem={conversation.invite?.problem ?? null}
            />
          </PanelFrame>
        )}
        {panel === 'settings' && (
          <PanelFrame id="meet-settings" title="Settings" onClose={() => setPanel(null)}>
            <SettingsPanel
              devices={local.devices}
              lists={local.lists}
              language={myLanguage}
              languages={languages}
              liveWords={{ available: liveWordsSupported(), on: liveWordsOn }}
              onDevice={(kind, id) => void local.choose(kind, id)}
              onLanguage={changeLanguage}
              onLiveWords={changeLiveWords}
            />
          </PanelFrame>
        )}
      </div>

      {captionsOn && (
        <CaptionRibbon
          lines={shown}
          pending={pending}
          nameOf={(line) => nameOf(line.speakerId)}
          emptyText={`Captions in ${languageName(myLanguage)} appear here when someone speaks.`}
        />
      )}

      {confirm === 'record' && (
        <div className="meet-confirm" role="dialog" aria-label="Record this call?">
          <p><strong>Record this call?</strong> Everyone sees a Recording sign. The video, with everyone&apos;s voices and the captions, is saved to this device when you stop.</p>
          <div>
            <button className="meet-pill meet-pill-strong" type="button" onClick={startRecording}>Start recording</button>
            <button className="meet-pill" type="button" onClick={() => setConfirm(null)}>Cancel</button>
          </div>
        </div>
      )}
      {confirm === 'end' && (
        <div className="meet-confirm" role="dialog" aria-label="End the call?">
          <p><strong>End the call for everyone?</strong> You started it, so it closes for everyone when you leave.</p>
          <div>
            <button className="meet-pill meet-pill-danger" type="button" onClick={leave}>End for everyone</button>
            <button className="meet-pill" type="button" onClick={() => setConfirm(null)}>Stay</button>
          </div>
        </div>
      )}

      <nav className="meet-controls" aria-label="Call controls">
        <div className="meet-controls-main">
          <button className="meet-round" type="button" data-off={!micOn} aria-pressed={!micOn} onClick={local.toggleMic} disabled={!local.audio} title="Microphone (Ctrl+D)">
            <MeetIcon name={micOn ? 'mic' : 'mic-off'} />
            <span className="visually-hidden">{micOn ? 'Turn off microphone' : 'Turn on microphone'}</span>
          </button>
          <button className="meet-round" type="button" data-off={!cameraOn} aria-pressed={!cameraOn} onClick={() => void local.toggleCamera()} title="Camera (Ctrl+E)">
            <MeetIcon name={cameraOn ? 'camera' : 'camera-off'} />
            <span className="visually-hidden">{cameraOn ? 'Turn off camera' : 'Turn on camera'}</span>
          </button>
          <button className="meet-round" type="button" data-on={captionsOn} aria-pressed={captionsOn} onClick={toggleCaptions} title="Captions">
            <MeetIcon name={captionsOn ? 'captions' : 'captions-off'} />
            <span className="visually-hidden">Captions</span>
          </button>
          {recordingSupported() && (
            <button
              className="meet-round"
              type="button"
              data-recording={recordingHere}
              aria-pressed={recordingHere}
              onClick={() => (recordingHere ? void stopRecording(true).then(() => setToast('Recording saved to your Downloads folder.')) : setConfirm('record'))}
              disabled={!live && !recordingHere}
              title={recordingHere ? 'Stop recording' : 'Record'}
            >
              <MeetIcon name={recordingHere ? 'stop' : 'record'} />
              <span className="visually-hidden">{recordingHere ? 'Stop recording and save it' : 'Record the call'}</span>
            </button>
          )}
          <button className="meet-leave" type="button" onClick={leave} disabled={call.phase === 'leaving'}>
            <MeetIcon name="leave" />
            <span>{host && participants.length > 1 ? 'End call' : 'Leave'}</span>
          </button>
        </div>
        <div className="meet-controls-side">
          <button
            className="meet-round meet-round-quiet"
            type="button"
            aria-expanded={panel === 'chat'}
            aria-controls="meet-chat"
            aria-label={unread > 0 ? `Chat, ${unread} new` : 'Chat'}
            onClick={() => togglePanel('chat')}
            title="Chat"
          >
            <MeetIcon name="chat" />
            {unread > 0 && <span className="meet-badge" aria-hidden="true">{unread}</span>}
          </button>
          <button
            className="meet-round meet-round-quiet"
            type="button"
            aria-expanded={panel === 'people'}
            aria-controls="meet-people"
            aria-label={`People, ${participants.length} in the call`}
            onClick={() => togglePanel('people')}
            title="People"
          >
            <MeetIcon name="people" />
            <span className="meet-badge meet-badge-quiet" aria-hidden="true">{participants.length}</span>
          </button>
          <button
            className="meet-round meet-round-quiet"
            type="button"
            aria-expanded={panel === 'settings'}
            aria-controls="meet-settings"
            aria-label="Settings"
            onClick={() => togglePanel('settings')}
            title="Settings"
          >
            <MeetIcon name="settings" />
          </button>
        </div>
      </nav>

      {ordered.filter((person) => person.id !== you).map((person) => (
        <RemoteAudio key={person.id} stream={streams[person.id] ?? null} speaker={local.devices.speaker} />
      ))}
    </div>
  );
}
