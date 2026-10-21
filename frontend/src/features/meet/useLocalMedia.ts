import { useCallback, useEffect, useRef, useState } from 'react';

import {
  isMissing,
  listDevices,
  mediaProblem,
  openBoth,
  openCamera,
  openMicrophone,
  saveDevices,
  savedDevices,
  savedOn,
  saveOn,
  type DeviceChoice,
  type DeviceLists,
} from './devices';

export interface LocalMedia {
  audio: MediaStreamTrack | null;
  video: MediaStreamTrack | null;
  micOn: boolean;
  cameraOn: boolean;
  devices: DeviceChoice;
  lists: DeviceLists;
  micProblem: string;
  cameraProblem: string;
  opening: boolean;
  toggleMic: () => void;
  toggleCamera: () => Promise<void>;
  choose: (kind: keyof DeviceChoice, id: string) => Promise<void>;
  retry: () => Promise<void>;
  stop: () => void;
}

const NO_LISTS: DeviceLists = { mics: [], cameras: [], speakers: [] };

async function withFallback<T>(id: string, open: (id: string) => Promise<T>): Promise<T> {
  try {
    return await open(id);
  } catch (error) {
    if (id && isMissing(error)) {
      return open('');
    }
    throw error;
  }
}

/** The microphone and camera for a call, opened once in the lobby and carried into the call. */
export function useLocalMedia(): LocalMedia {
  const [audio, setAudio] = useState<MediaStreamTrack | null>(null);
  const [video, setVideo] = useState<MediaStreamTrack | null>(null);
  const [micOn, setMicOn] = useState(() => savedOn().mic);
  const [cameraOn, setCameraOn] = useState(() => savedOn().camera);
  const [devices, setDevices] = useState<DeviceChoice>(savedDevices);
  const [lists, setLists] = useState<DeviceLists>(NO_LISTS);
  const [micProblem, setMicProblem] = useState('');
  const [cameraProblem, setCameraProblem] = useState('');
  const [opening, setOpening] = useState(true);
  const audioRef = useRef<MediaStreamTrack | null>(null);
  const videoRef = useRef<MediaStreamTrack | null>(null);
  const devicesRef = useRef(devices);
  const micOnRef = useRef(micOn);
  const cameraOnRef = useRef(cameraOn);
  const stoppedRef = useRef(false);

  const refreshLists = useCallback(async () => {
    try {
      const found = await listDevices();
      if (!stoppedRef.current) {
        setLists(found);
      }
    } catch {
      setLists(NO_LISTS);
    }
  }, []);

  const putAudio = useCallback((track: MediaStreamTrack | null) => {
    if (audioRef.current && audioRef.current !== track) {
      audioRef.current.stop();
    }
    if (track) {
      track.enabled = micOnRef.current;
    }
    audioRef.current = track;
    setAudio(track);
  }, []);

  const putVideo = useCallback((track: MediaStreamTrack | null) => {
    if (videoRef.current && videoRef.current !== track) {
      videoRef.current.stop();
    }
    videoRef.current = track;
    setVideo(track);
  }, []);

  const keep = useCallback((tracks: Array<MediaStreamTrack | null>): boolean => {
    if (stoppedRef.current) {
      tracks.forEach((track) => track?.stop());
      return false;
    }
    return true;
  }, []);

  const openMic = useCallback(async () => {
    try {
      const track = await withFallback(devicesRef.current.mic, openMicrophone);
      if (keep([track])) {
        putAudio(track);
        setMicProblem('');
      }
    } catch (error) {
      setMicProblem(mediaProblem(error, 'microphone'));
    }
  }, [keep, putAudio]);

  const openCam = useCallback(async () => {
    try {
      const track = await withFallback(devicesRef.current.camera, openCamera);
      if (keep([track]) && cameraOnRef.current) {
        putVideo(track);
        setCameraProblem('');
      } else {
        track.stop();
      }
    } catch (error) {
      setCameraProblem(mediaProblem(error, 'camera'));
      if (!videoRef.current) {
        cameraOnRef.current = false;
        setCameraOn(false);
      }
    }
  }, [keep, putVideo]);

  const start = useCallback(async () => {
    setOpening(true);
    const { mic, camera } = devicesRef.current;
    let opened = false;
    if (cameraOnRef.current && !audioRef.current && !videoRef.current) {
      try {
        const [voice, picture] = await openBoth(mic, camera);
        if (keep([voice, picture])) {
          putAudio(voice);
          putVideo(picture);
          setMicProblem('');
          setCameraProblem('');
        }
        opened = true;
      } catch {
        opened = false;
      }
    }
    if (!opened) {
      if (!audioRef.current) {
        await openMic();
      }
      if (cameraOnRef.current && !videoRef.current) {
        await openCam();
      }
    }
    await refreshLists();
    if (!stoppedRef.current) {
      setOpening(false);
    }
  }, [keep, openCam, openMic, putAudio, putVideo, refreshLists]);

  useEffect(() => {
    stoppedRef.current = false;
    void start();
    const changed = (): void => void refreshLists();
    navigator.mediaDevices?.addEventListener?.('devicechange', changed);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', changed);
    };
  }, [refreshLists, start]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    audioRef.current?.stop();
    videoRef.current?.stop();
    audioRef.current = null;
    videoRef.current = null;
    setAudio(null);
    setVideo(null);
  }, []);

  useEffect(() => () => {
    stoppedRef.current = true;
    audioRef.current?.stop();
    videoRef.current?.stop();
  }, []);

  const toggleMic = useCallback(() => {
    const next = !micOnRef.current;
    micOnRef.current = next;
    setMicOn(next);
    saveOn({ mic: next, camera: cameraOnRef.current });
    if (audioRef.current) {
      audioRef.current.enabled = next;
    }
  }, []);

  const toggleCamera = useCallback(async () => {
    const next = !cameraOnRef.current;
    cameraOnRef.current = next;
    setCameraOn(next);
    saveOn({ mic: micOnRef.current, camera: next });
    if (!next) {
      putVideo(null);
      return;
    }
    await openCam();
  }, [openCam, putVideo]);

  const choose = useCallback(async (kind: keyof DeviceChoice, id: string) => {
    const next = { ...devicesRef.current, [kind]: id };
    devicesRef.current = next;
    setDevices(next);
    saveDevices(next);
    if (kind === 'mic') {
      await openMic();
    } else if (kind === 'camera' && cameraOnRef.current) {
      await openCam();
    }
  }, [openCam, openMic]);

  const retry = useCallback(async () => {
    stoppedRef.current = false;
    if (!cameraOnRef.current && cameraProblem) {
      cameraOnRef.current = true;
      setCameraOn(true);
    }
    await start();
  }, [cameraProblem, start]);

  return {
    audio,
    video,
    micOn,
    cameraOn,
    devices,
    lists,
    micProblem,
    cameraProblem,
    opening,
    toggleMic,
    toggleCamera,
    choose,
    retry,
    stop,
  };
}
