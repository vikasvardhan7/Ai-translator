export interface DeviceChoice {
  mic: string;
  camera: string;
  speaker: string;
}

export interface DeviceLists {
  mics: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
}

const CHOICE_KEY = 'voice-translator-meet-devices';
const EMPTY: DeviceChoice = { mic: '', camera: '', speaker: '' };

const VIDEO: MediaTrackConstraints = {
  width: { ideal: 960 },
  height: { ideal: 540 },
  frameRate: { ideal: 24, max: 30 },
};

const VOICE: MediaTrackConstraints = {
  channelCount: { ideal: 1 },
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export function savedDevices(): DeviceChoice {
  try {
    const saved = JSON.parse(window.localStorage.getItem(CHOICE_KEY) ?? '{}') as Partial<DeviceChoice>;
    return {
      mic: typeof saved.mic === 'string' ? saved.mic : '',
      camera: typeof saved.camera === 'string' ? saved.camera : '',
      speaker: typeof saved.speaker === 'string' ? saved.speaker : '',
    };
  } catch {
    return EMPTY;
  }
}

export function saveDevices(choice: DeviceChoice): void {
  try {
    window.localStorage.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    return;
  }
}

export function canChooseSpeaker(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

export async function listDevices(): Promise<DeviceLists> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return { mics: [], cameras: [], speakers: [] };
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  const named = all.filter((device) => device.deviceId);
  return {
    mics: named.filter((device) => device.kind === 'audioinput'),
    cameras: named.filter((device) => device.kind === 'videoinput'),
    speakers: named.filter((device) => device.kind === 'audiooutput'),
  };
}

export function deviceLabel(device: MediaDeviceInfo, index: number, kind: string): string {
  return device.label || `${kind} ${index + 1}`;
}

function pick(id: string): ConstrainDOMString | undefined {
  return id ? { exact: id } : undefined;
}

export function mediaProblem(error: unknown, what: 'microphone' | 'camera' | 'microphone and camera'): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `The browser blocked the ${what}. Click the lock or camera icon in the address bar, allow it, then try again.`;
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return `No ${what} was found. Plug one in or pick another in the settings.`;
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return `Another app is using the ${what}. Close it, then try again.`;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'This browser cannot open a microphone or camera here. Use Chrome or Edge on an https address.';
  }
  return error instanceof Error && error.message ? error.message : `The ${what} could not be opened.`;
}

export async function openBoth(micId: string, cameraId: string): Promise<[MediaStreamTrack, MediaStreamTrack]> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { ...VOICE, deviceId: pick(micId) },
    video: { ...VIDEO, deviceId: pick(cameraId) },
  });
  const [audio] = stream.getAudioTracks();
  const [video] = stream.getVideoTracks();
  if (!audio || !video) {
    stream.getTracks().forEach((track) => track.stop());
    throw new DOMException('No microphone or camera', 'NotFoundError');
  }
  return [audio, video];
}

export function isMissing(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'OverconstrainedError');
}

const ON_KEY = 'voice-translator-meet-on';

export function savedOn(): { mic: boolean; camera: boolean } {
  try {
    const saved = JSON.parse(window.localStorage.getItem(ON_KEY) ?? '{}') as { mic?: unknown; camera?: unknown };
    return { mic: saved.mic !== false, camera: saved.camera !== false };
  } catch {
    return { mic: true, camera: true };
  }
}

export function saveOn(on: { mic: boolean; camera: boolean }): void {
  try {
    window.localStorage.setItem(ON_KEY, JSON.stringify(on));
  } catch {
    return;
  }
}

export async function openMicrophone(micId: string): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...VOICE, deviceId: pick(micId) }, video: false });
  const [track] = stream.getAudioTracks();
  if (!track) {
    throw new DOMException('No microphone', 'NotFoundError');
  }
  return track;
}

export async function openCamera(cameraId: string): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...VIDEO, deviceId: pick(cameraId) } });
  const [track] = stream.getVideoTracks();
  if (!track) {
    throw new DOMException('No camera', 'NotFoundError');
  }
  return track;
}

export async function playOn(element: HTMLMediaElement, speakerId: string): Promise<void> {
  const sink = element as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
  if (speakerId && sink.setSinkId) {
    await sink.setSinkId(speakerId).catch(() => undefined);
  }
}
