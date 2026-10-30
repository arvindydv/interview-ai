// Runs on the audio thread: downsamples the microphone to 16 kHz mono and posts 80 ms frames of
// 16-bit PCM (AUDIO_FORMAT), plus a loudness level for the meter.
export const PCM16_WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = sampleRate / options.processorOptions.rate;
    this.frame = new Int16Array(options.processorOptions.frame);
    this.n = 0;
    this.pos = 0;
    this.sq = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (; this.pos < input.length; this.pos += this.ratio) {
      const i = Math.floor(this.pos);
      const f = this.pos - i;
      const s = Math.max(-1, Math.min(1, input[i] * (1 - f) + (i + 1 < input.length ? input[i + 1] : input[i]) * f));
      this.sq += s * s;
      this.frame[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.frame.length) {
        this.port.postMessage({ pcm: this.frame.buffer, level: Math.sqrt(this.sq / this.n) }, [this.frame.buffer]);
        this.frame = new Int16Array(this.frame.length);
        this.n = 0;
        this.sq = 0;
      }
    }
    this.pos -= input.length;
    return true;
  }
}
registerProcessor('pcm16', Pcm16);
`;
