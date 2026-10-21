import { useEffect, useRef, useState } from 'react';

const EVERY_MS = 120;
const STEPS = 10;

interface Meter {
  track: MediaStreamTrack;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  buffer: Float32Array<ArrayBuffer>;
}

export function levelOf(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * 6);
}

export function sameLevels(one: Record<string, number>, two: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(one), ...Object.keys(two)]);
  return [...keys].every((key) => one[key] === two[key]);
}

/** How loud each person is right now (0 to 1, in tenths), measured in this browser. */
export function useAudioLevels(tracks: Readonly<Record<string, MediaStreamTrack | null | undefined>>): Record<string, number> {
  const [levels, setLevels] = useState<Record<string, number>>({});
  const contextRef = useRef<AudioContext | null>(null);
  const metersRef = useRef(new Map<string, Meter>());
  const levelsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (typeof AudioContext === 'undefined') {
      return;
    }
    const context = contextRef.current ?? new AudioContext();
    contextRef.current = context;
    void context.resume().catch(() => undefined);
    const meters = metersRef.current;
    for (const [id, meter] of meters) {
      if (tracks[id] !== meter.track) {
        meter.source.disconnect();
        meters.delete(id);
      }
    }
    for (const [id, track] of Object.entries(tracks)) {
      if (!track || track.readyState !== 'live' || meters.has(id)) {
        continue;
      }
      try {
        const source = context.createMediaStreamSource(new MediaStream([track]));
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        meters.set(id, { track, source, analyser, buffer: new Float32Array(analyser.fftSize) });
      } catch {
        continue;
      }
    }
  }, [tracks]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next: Record<string, number> = {};
      for (const [id, meter] of metersRef.current) {
        meter.analyser.getFloatTimeDomainData(meter.buffer);
        const heard = meter.track.enabled && !meter.track.muted ? levelOf(meter.buffer) : 0;
        next[id] = Math.round(heard * STEPS) / STEPS;
      }
      if (!sameLevels(next, levelsRef.current)) {
        levelsRef.current = next;
        setLevels(next);
      }
    }, EVERY_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    for (const meter of metersRef.current.values()) {
      meter.source.disconnect();
    }
    metersRef.current.clear();
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
  }, []);

  return levels;
}
