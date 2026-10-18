class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0];
    if (channels && channels.length > 0) {
      const copies = channels.map((channel) => channel.slice());
      this.port.postMessage(copies, copies.map((channel) => channel.buffer));
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
