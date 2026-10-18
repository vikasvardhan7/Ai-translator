import {
  PcmFrameBuilder,
  rmsLevel,
  StreamingPcmResampler,
} from '../features/session/pcm';

export interface MicrophoneCapture {
  start(onAudioFrame: (frame: ArrayBuffer) => void, onLevel: (level: number) => void, onLost: () => void): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

const LEVEL_INTERVAL_MS = 100;

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

export async function openMicrophoneCapture(): Promise<MicrophoneCapture> {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
    throw new Error('Microphone capture requires Chrome or Edge on a secure page or localhost.');
  }

  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch {
    throw new Error('This browser could not open audio capture. Try the latest version of Chrome or Edge.');
  }

  let stream: MediaStream | null = null;
  let source: MediaStreamAudioSourceNode;
  let processor: AudioWorkletNode;
  let mutedOutput: GainNode;

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
    const [streamResult, resumeResult] = await Promise.allSettled([streamPromise, context.resume()]);
    if (streamResult.status === 'rejected') {
      throw streamResult.reason;
    }
    stream = streamResult.value;
    if (resumeResult.status === 'rejected') {
      throw new Error('Audio capture could not start. Check the browser audio settings.');
    }
    if (!context.audioWorklet) {
      throw new Error('This browser does not support the audio capture worklet. Use the latest Chrome or Edge.');
    }
    await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}pcm-worklet.js`);
    source = context.createMediaStreamSource(stream);
    processor = new AudioWorkletNode(context, 'pcm-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    });
    mutedOutput = context.createGain();
    mutedOutput.gain.value = 0;
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop());
    await context.close().catch(() => undefined);
    throw microphoneError(error);
  }

  const microphoneStream = stream;
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
      for (const track of microphoneStream.getAudioTracks()) {
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
      microphoneStream.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      void context.close().catch(() => undefined);
    },
  };
}
