import {
  PcmFrameBuilder,
  rmsLevel,
  StreamingPcmResampler,
} from '../features/session/pcm';

export interface MicrophoneCapture {
  start(onAudioFrame: (frame: ArrayBuffer) => void, onLevel?: (level: number) => void): void;
  stop(flushPending?: boolean): void;
}

/** Opens a mono microphone stream and converts it to the backend's 16 kHz PCM format. */
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
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: AudioWorkletNode | null = null;
  let mutedOutput: GainNode | null = null;
  let active = false;
  let stopped = false;
  let connected = false;
  let onAudioFrame: ((frame: ArrayBuffer) => void) | null = null;
  let onLevel: ((level: number) => void) | undefined;
  let latestLevel = 0;
  let lastLevelUpdate = 0;

  const resampler = new StreamingPcmResampler(context.sampleRate);
  const frameBuilder = new PcmFrameBuilder();

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
    const resumePromise = context.resume();
    const [streamResult, resumeResult] = await Promise.allSettled([streamPromise, resumePromise]);

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

    await context.audioWorklet.addModule('/pcm-worklet.js');
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
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new Error('Microphone blocked. Click the lock icon in the address bar and allow the microphone.');
    }
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      throw new Error('No microphone found.');
    }
    if (error instanceof DOMException && error.name === 'NotReadableError') {
      throw new Error('The microphone is being used by another app.');
    }
    throw error instanceof Error ? error : new Error('The microphone could not be opened.');
  }

  const microphoneStream = stream;
  const audioSource = source;
  const audioProcessor = processor;
  const output = mutedOutput;

  audioProcessor.port.onmessage = (event: MessageEvent<Float32Array[]>) => {
    if (!active) {
      return;
    }

    const channels = event.data;
    const frameLength = channels[0]?.length ?? 0;
    if (frameLength === 0 || channels.length === 0) {
      return;
    }

    const mono = new Float32Array(frameLength);
    for (const channel of channels) {
      for (let index = 0; index < frameLength; index += 1) {
        mono[index] = (mono[index] ?? 0) + (channel[index] ?? 0) / channels.length;
      }
    }

    const samples = resampler.process(mono);
    latestLevel = Math.min(1, rmsLevel(samples) * 5);
    const now = performance.now();
    if (now - lastLevelUpdate >= 100) {
      onLevel?.(latestLevel);
      lastLevelUpdate = now;
    }

    for (const frame of frameBuilder.push(samples)) {
      onAudioFrame?.(frame);
    }
  };

  return {
    start(onFrame, onLevelChange) {
      if (stopped || active) {
        return;
      }

      active = true;
      onAudioFrame = onFrame;
      onLevel = onLevelChange;
      audioSource.connect(audioProcessor);
      audioProcessor.connect(output);
      output.connect(context.destination);
      connected = true;
    },

    stop(flushPending = true) {
      if (stopped) {
        return;
      }
      stopped = true;
      active = false;
      audioProcessor.port.onmessage = null;

      if (flushPending) {
        for (const frame of frameBuilder.push(resampler.flush())) {
          onAudioFrame?.(frame);
        }
        const finalFrame = frameBuilder.flush();
        if (finalFrame) {
          onAudioFrame?.(finalFrame);
        }
      }
      onLevel?.(0);
      onAudioFrame = null;
      onLevel = undefined;

      if (connected) {
        audioSource.disconnect();
        audioProcessor.disconnect();
        output.disconnect();
      }
      microphoneStream.getTracks().forEach((track) => track.stop());
      void context.close().catch(() => undefined);
    },
  };
}
