import { useEffect, useRef, useState } from 'react';

interface CameraCaptureProps {
  title: string;
  facing?: 'environment' | 'user';
  onPhoto: (photo: File) => void;
  onClose: () => void;
}

const QUALITY = 0.9;

export function cameraProblem(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The camera is blocked for this site. Allow it in the browser settings (the camera or lock icon next to the address), or choose a photo instead.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found on this device. Choose a photo instead.';
  }
  if (name === 'NotReadableError') {
    return 'The camera is busy in another app. Close that app, or choose a photo instead.';
  }
  return 'The camera could not start here. Choose a photo instead.';
}

export default function CameraCapture({ title, facing = 'environment', onPhoto, onClose }: CameraCaptureProps) {
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const [front, setFront] = useState(facing === 'user');
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let current = true;
    setReady(false);
    setProblem('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setProblem('This browser cannot open the camera here. Choose a photo instead.');
      return undefined;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: front ? 'user' : 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(
        (opened) => {
          if (!current) {
            opened.getTracks().forEach((track) => track.stop());
            return;
          }
          stream.current = opened;
          if (video.current) {
            video.current.srcObject = opened;
            void video.current.play().catch(() => undefined);
          }
        },
        (error: unknown) => {
          if (current) {
            setProblem(cameraProblem(error));
          }
        },
      );
    return () => {
      current = false;
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
    };
  }, [front]);

  function take(): void {
    const shown = video.current;
    if (!shown || !shown.videoWidth) {
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = shown.videoWidth;
    canvas.height = shown.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setProblem('This browser cannot take photos here. Choose a photo instead.');
      return;
    }
    context.drawImage(shown, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          onPhoto(new File([blob], 'camera.jpg', { type: 'image/jpeg' }));
        } else {
          setProblem('The photo could not be saved. Try again.');
        }
      },
      'image/jpeg',
      QUALITY,
    );
  }

  return (
    <div className="camera" role="group" aria-label={title}>
      <div className="camera-view" data-ready={ready}>
        <video ref={video} playsInline muted onLoadedData={() => setReady(true)} aria-label="Camera view" />
        {!ready && !problem && <p className="camera-wait" role="status">Opening the camera</p>}
      </div>
      {problem && <p className="notice notice-danger" role="alert">{problem}</p>}
      <div className="camera-actions">
        <button className="button button-primary camera-shutter" type="button" disabled={!ready} onClick={take}>
          Take photo
        </button>
        <button className="button button-secondary button-small" type="button" onClick={() => setFront((value) => !value)}>
          Switch camera
        </button>
        <button className="button button-link" type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
