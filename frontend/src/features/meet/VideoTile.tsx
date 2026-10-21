import { memo, useEffect, useRef, type CSSProperties } from 'react';

import { initials } from './captions';
import { playOn } from './devices';
import type { PeerState } from './mesh';
import MeetIcon from './MeetIcon';

interface VideoTileProps {
  name: string;
  you: boolean;
  video: MediaStreamTrack | null;
  showVideo: boolean;
  micOn: boolean;
  level: number;
  languageName: string;
  away: boolean;
  peerState: PeerState | null;
  onRetry?: () => void;
  onVideo?: (element: HTMLVideoElement | null) => void;
}

const SPEAKING = 0.2;

function VideoTile({ name, you, video, showVideo, micOn, level, languageName, away, peerState, onRetry, onVideo }: VideoTileProps) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    element.srcObject = video ? new MediaStream([video]) : null;
    if (video) {
      void element.play().catch(() => undefined);
    }
  }, [video]);

  useEffect(() => {
    onVideo?.(ref.current);
    return () => onVideo?.(null);
  }, [onVideo]);

  const visible = showVideo && video !== null && !away;
  let status = '';
  if (away) {
    status = 'Connection lost. Waiting for them to come back.';
  } else if (!you && peerState === 'connecting') {
    status = 'Connecting';
  } else if (!you && peerState === 'failed') {
    status = "Video and voice can't connect on this network. Captions and chat still work.";
  }
  const speaking = micOn && !away && level >= SPEAKING;

  return (
    <figure
      className="meet-tile"
      data-you={you}
      data-speaking={speaking}
      data-away={away}
      style={{ '--level': speaking ? level : 0 } as CSSProperties}
    >
      <video ref={ref} className="meet-video" data-mirror={you} data-shown={visible} autoPlay playsInline muted />
      {!visible && (
        <div className="meet-avatar" aria-hidden="true">
          <span>{initials(name)}</span>
        </div>
      )}
      {status && (
        <p className="meet-tile-status" role="status">
          {peerState === 'failed' && !away && <MeetIcon name="warning" />}
          <span>{status}</span>
          {peerState === 'failed' && !away && onRetry && (
            <button className="meet-text-button" type="button" onClick={onRetry}>Try again</button>
          )}
        </p>
      )}
      <figcaption className="meet-name">
        {!micOn && (
          <span className="meet-name-muted" title="Microphone off">
            <MeetIcon name="mic-off" />
            <span className="visually-hidden">Microphone off, </span>
          </span>
        )}
        <span dir="auto">{you ? `${name} (you)` : name}</span>
      </figcaption>
      {languageName && <span className="meet-tile-language">{languageName}</span>}
    </figure>
  );
}

export default memo(VideoTile);

export function RemoteAudio({ stream, speaker }: { stream: MediaStream | null; speaker: string }) {
  const ref = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const tracks = stream?.getAudioTracks() ?? [];
    element.srcObject = tracks.length > 0 ? new MediaStream(tracks) : null;
    if (tracks.length > 0) {
      void element.play().catch(() => undefined);
    }
  }, [stream]);

  useEffect(() => {
    if (ref.current) {
      void playOn(ref.current, speaker);
    }
  }, [speaker, stream]);

  return <audio ref={ref} autoPlay />;
}
