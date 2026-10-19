import {
  PcmFrameBuilder,
  rmsLevel,
  StreamingPcmResampler,
} from '../features/session/pcm';

export interface AudioCapture {
  start(onAudioFrame: (frame: ArrayBuffer) => void, onLevel: (level: number) => void, onLost: () => void): void;
  pause(): void;
  resume(): void;
  mute(muted: boolean): void;
  stop(): void;
}

const LEVEL_INTERVAL_MS = 100;
const RESUME_WAIT_MS = 1_500;

export class MicrophoneNeedsTap extends Error {
  constructor() {
    super('This browser needs a tap to turn on the microphone. Tap Turn on microphone.');
    this.name = 'MicrophoneNeedsTap';
  }
}

function resumeOrGiveUp(context: AudioContext): Promise<void> {
  return Promise.race([
    context.resume(),
    new Promise<void>((resolve) => {
      setTimeout(resolve, RESUME_WAIT_MS);
    }),
  ]);
}

function meetingError(error: unknown): Error {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return new Error("Sharing was cancelled. Select Connect meeting and choose the meeting's tab or screen.");
  }
  return error instanceof Error ? error : new Error("The meeting's sound could not be shared.");
}

function microphoneError(error: unknown): Error {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return new Error('Microphone blocked. Click the lock icon in the address bar and allow the microphone.');
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return new Error('No microphone found.');
  }
  if (error instanceof DOMException && error.name === 'NotReadableError') {
    return new Error('The microphone is being used by another app.');
  }
  return error instanceof Error ? error : new Error('The microphone could not be opened.');
}

export async function openMicrophoneCapture(): Promise<AudioCapture> {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
    throw new Error('Microphone capture requires Chrome or Edge on a secure page or localhost.');
  }

  const context = newContext();
  let stream: MediaStream | null = null;
  try {
    const streamPromise = navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: { ideal: 1 },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    const [streamResult, resumeResult] = await Promise.allSettled([streamPromise, resumeOrGiveUp(context)]);
    if (streamResult.status === 'rejected') {
      throw streamResult.reason;
    }
    stream = streamResult.value;
    if (resumeResult.status === 'rejected') {
      throw new Error('Audio capture could not start. Check the browser audio settings.');
    }
    return await captureFrom(stream, context);
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    await context.close().catch(() => undefined);
    throw error instanceof MicrophoneNeedsTap ? error : microphoneError(error);
  }
}

export async function openMeetingCapture(): Promise<AudioCapture> {
  if (!navigator.mediaDevices?.getDisplayMedia || typeof AudioContext === 'undefined') {
    throw new Error("This browser cannot share a meeting's sound. Use Chrome or Edge on a computer.");
  }

  const context = newContext();
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
    } as DisplayMediaStreamOptions);
    if (stream.getAudioTracks().length === 0) {
      throw new Error(
        "No sound was shared. Choose the meeting's tab and turn on Share tab audio, or for the Teams or Zoom app choose Entire screen and turn on Share system audio.",
      );
    }
    for (const track of stream.getVideoTracks()) {
      track.enabled = false;
    }
    await resumeOrGiveUp(context);
    return await captureFrom(stream, context);
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    await context.close().catch(() => undefined);
    throw error instanceof MicrophoneNeedsTap ? error : meetingError(error);
  }
}

function newContext(): AudioContext {
  try {
    return new AudioContext();
  } catch {
    throw new Error('This browser could not open audio capture. Try the latest version of Chrome or Edge.');
  }
}

async function captureFrom(stream: MediaStream, context: AudioContext): Promise<AudioCapture> {
  if (context.state !== 'running') {
    await resumeOrGiveUp(context);
  }
  if (context.state !== 'running') {
    throw new MicrophoneNeedsTap();
  }
  if (!context.audioWorklet) {
    throw new Error('This browser does not support the audio capture worklet. Use the latest Chrome or Edge.');
  }
  await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}pcm-worklet.js`);
  const source = context.createMediaStreamSource(stream);
  const processor = new AudioWorkletNode(context, 'pcm-capture', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
  });
  const mutedOutput = context.createGain();
  mutedOutput.gain.value = 0;

  let resampler = new StreamingPcmResampler(context.sampleRate);
  let frameBuilder = new PcmFrameBuilder();
  let listening = false;
  let stopped = false;
  let connected = false;
  let sendFrame: ((frame: ArrayBuffer) => void) | null = null;
  let reportLevel: ((level: number) => void) | null = null;
  let lastLevelUpdate = 0;

  function resetBuffers(): void {
    resampler = new StreamingPcmResampler(context.sampleRate);
    frameBuilder = new PcmFrameBuilder();
  }

  processor.port.onmessage = (event: MessageEvent<Float32Array[]>) => {
    const channels = event.data;
    const frameLength = channels[0]?.length ?? 0;
    if (!listening || frameLength === 0) {
      return;
    }
    const mono = new Float32Array(frameLength);
    for (const channel of channels) {
      for (let index = 0; index < frameLength; index += 1) {
        mono[index] = (mono[index] ?? 0) + (channel[index] ?? 0) / channels.length;
      }
    }
    const samples = resampler.process(mono);
    const now = performance.now();
    if (now - lastLevelUpdate >= LEVEL_INTERVAL_MS) {
      reportLevel?.(Math.min(1, rmsLevel(samples) * 5));
      lastLevelUpdate = now;
    }
    for (const frame of frameBuilder.push(samples)) {
      sendFrame?.(frame);
    }
  };

  return {
    start(onAudioFrame, onLevel, onLost) {
      if (stopped || connected) {
        return;
      }
      sendFrame = onAudioFrame;
      reportLevel = onLevel;
      for (const track of stream.getAudioTracks()) {
        track.onended = () => {
          if (!stopped) {
            onLost();
          }
        };
      }
      source.connect(processor);
      processor.connect(mutedOutput);
      mutedOutput.connect(context.destination);
      connected = true;
      listening = true;
    },

    pause() {
      if (!listening) {
        return;
      }
      listening = false;
      resetBuffers();
      reportLevel?.(0);
    },

    resume() {
      if (stopped || !connected) {
        return;
      }
      listening = true;
    },

    mute(muted) {
      for (const track of stream.getAudioTracks()) {
        track.enabled = !muted;
      }
    },

    stop() {
      if (stopped) {
        return;
      }
      if (listening) {
        for (const frame of frameBuilder.push(resampler.flush())) {
          sendFrame?.(frame);
        }
        const finalFrame = frameBuilder.flush();
        if (finalFrame) {
          sendFrame?.(finalFrame);
        }
      }
      stopped = true;
      listening = false;
      processor.port.onmessage = null;
      reportLevel?.(0);
      sendFrame = null;
      reportLevel = null;
      if (connected) {
        source.disconnect();
        processor.disconnect();
        mutedOutput.disconnect();
      }
      stream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      void context.close().catch(() => undefined);
    },
  };
}
