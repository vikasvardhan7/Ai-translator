import { useEffect, useMemo, useRef, type CSSProperties, type FormEvent } from 'react';

import LanguageSelect from '../consent/LanguageSelect';
import type { LanguageOption } from '../consent/languageOptions';
import { initials } from './captions';
import MeetIcon from './MeetIcon';
import { DeviceFields } from './Panels';
import { useAudioLevels } from './useAudioLevels';
import type { LocalMedia } from './useLocalMedia';

interface LobbyProps {
  local: LocalMedia;
  heading: string;
  details: string | null;
  name: string;
  language: string;
  languages: LanguageOption[];
  action: string;
  busy: string | null;
  waiting: string | null;
  problem: string | null;
  closed: boolean;
  onName: (name: string) => void;
  onLanguage: (code: string) => void;
  onJoin: () => void;
  onStopWaiting: () => void;
  onStartOwn: () => void;
  other?: { label: string; run: () => void } | null;
}

const BARS = 5;

export default function Lobby({
  local,
  heading,
  details,
  name,
  language,
  languages,
  action,
  busy,
  waiting,
  problem,
  closed,
  onName,
  onLanguage,
  onJoin,
  onStopWaiting,
  onStartOwn,
  other = null,
}: LobbyProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const tracks = useMemo(() => ({ me: local.audio }), [local.audio]);
  const level = useAudioLevels(tracks).me ?? 0;
  const micOn = local.micOn && local.audio !== null;
  const cameraOn = local.cameraOn && local.video !== null;

  useEffect(() => {
    const element = videoRef.current;
    if (!element) {
      return;
    }
    element.srcObject = local.video ? new MediaStream([local.video]) : null;
    if (local.video) {
      void element.play().catch(() => undefined);
    }
  }, [local.video]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!busy && !waiting && !closed && language) {
      onJoin();
    }
  }

  const lit = micOn ? Math.round(level * BARS * 1.4) : 0;

  return (
    <div className="meet-lobby">
      <section className="meet-preview" aria-label="Your camera and microphone">
        <div className="meet-preview-frame" data-camera={cameraOn}>
          <video ref={videoRef} className="meet-video" data-mirror="true" data-shown={cameraOn} autoPlay playsInline muted />
          {!cameraOn && (
            <div className="meet-avatar meet-avatar-big" aria-hidden="true">
              <span>{initials(name || 'You')}</span>
            </div>
          )}
          {local.opening && <p className="meet-preview-note" role="status">Opening your camera and microphone</p>}
          {!local.opening && !cameraOn && local.cameraOn === false && !local.cameraProblem && (
            <p className="meet-preview-note">Camera is off</p>
          )}
          <div className="meet-preview-controls">
            <button className="meet-round" type="button" data-off={!micOn} aria-pressed={!micOn} onClick={local.toggleMic} disabled={!local.audio}>
              <MeetIcon name={micOn ? 'mic' : 'mic-off'} />
              <span className="visually-hidden">{micOn ? 'Turn off microphone' : 'Turn on microphone'}</span>
            </button>
            <button className="meet-round" type="button" data-off={!cameraOn} aria-pressed={!cameraOn} onClick={() => void local.toggleCamera()}>
              <MeetIcon name={cameraOn ? 'camera' : 'camera-off'} />
              <span className="visually-hidden">{cameraOn ? 'Turn off camera' : 'Turn on camera'}</span>
            </button>
          </div>
          <div className="meet-meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={BARS} aria-valuenow={Math.min(BARS, lit)}>
            {Array.from({ length: BARS }, (_, index) => (
              <i key={index} data-lit={index < lit} style={{ '--bar': index } as CSSProperties} />
            ))}
          </div>
        </div>
        {(local.micProblem || local.cameraProblem) && (
          <div className="meet-preview-problem" role="alert">
            {local.micProblem && <p>{local.micProblem}</p>}
            {local.cameraProblem && <p>{local.cameraProblem}</p>}
            <button className="meet-pill" type="button" onClick={() => void local.retry()}>Try again</button>
          </div>
        )}
      </section>

      <form className="meet-join" onSubmit={submit}>
        <h1 tabIndex={-1}>{heading}</h1>
        {details && <p className="meet-join-details" dir="auto">{details}</p>}
        {closed ? (
          <>
            {problem && <p className="meet-join-problem" role="alert">{problem}</p>}
            <button className="meet-join-button" type="button" onClick={onStartOwn}>Start my own meeting</button>
          </>
        ) : (
          <>
            <div className="meet-field">
              <label htmlFor="meet-name">Your name</label>
              <input
                id="meet-name"
                type="text"
                value={name}
                maxLength={40}
                autoComplete="name"
                placeholder="Your name"
                onChange={(event) => onName(event.target.value)}
              />
            </div>
            <LanguageSelect label="Your language (you speak it and read captions in it)" value={language} languages={languages} onChange={onLanguage} />
            <details className="meet-devices">
              <summary>Microphone, camera and speaker</summary>
              <DeviceFields devices={local.devices} lists={local.lists} onDevice={(kind, id) => void local.choose(kind, id)} />
            </details>
            {problem && <p className="meet-join-problem" role="alert">{problem}</p>}
            {waiting ? (
              <div className="meet-waiting" role="status">
                <span className="meet-waiting-pulse" aria-hidden="true" />
                <span>{waiting}</span>
                <button className="meet-text-button" type="button" onClick={onStopWaiting}>Stop waiting</button>
              </div>
            ) : (
              <button className="meet-join-button" type="submit" disabled={busy !== null || !language} aria-busy={busy !== null}>
                {busy && <span className="meet-spinner" aria-hidden="true" />}
                {busy ?? action}
              </button>
            )}
            {other && !busy && (
              <button className="meet-text-button meet-join-other" type="button" onClick={other.run}>{other.label}</button>
            )}
            <p className="meet-join-note">
              Others hear your real voice and see your camera directly. For captions, what you say is sent to Google&apos;s Gemini to be written down and translated; on Google&apos;s free tier it may be used to improve Google&apos;s products. Joining means you agree.
            </p>
          </>
        )}
      </form>
    </div>
  );
}
