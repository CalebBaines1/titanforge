/**
 * Original ambient soundtrack, synthesised live with Web Audio so it ships no
 * audio files and carries no licensing questions. A slow alien pad, a sub
 * drone, desert wind and sparse pentatonic plucks; `setIntensity` adds a
 * low engine pulse while you ride in the cockpit.
 */

// D dorian-ish voicings that drift without resolving.
const CHORDS: number[][] = [
  [50, 57, 64, 69, 72],
  [48, 55, 62, 67, 74],
  [46, 53, 60, 65, 69],
  [45, 52, 59, 64, 71],
];
const PLUCK_SCALE = [62, 64, 67, 69, 72, 74, 76, 79, 81];
const CHORD_SECONDS = 9;

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class AmbientMusic {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private reverb!: ConvolverNode;
  private padBus!: GainNode;
  private pulseGain!: GainNode;
  private timer: number | null = null;
  private chordIndex = 0;
  private nextChordAt = 0;
  private nextPluckAt = 0;
  private intensity = 0;

  /** Create (or resume) the audio graph. Call from a user gesture where possible. */
  start(): void {
    if (this.ctx == null) this.build();
    void this.ctx!.resume();
    if (this.timer == null) this.timer = window.setInterval(() => this.schedule(), 250);
  }

  stop(): void {
    if (this.timer != null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    void this.ctx?.suspend();
  }

  /** 0 = exploring the table, 1 = riding in the cockpit. */
  setIntensity(value: number): void {
    this.intensity = value;
    if (this.ctx == null) return;
    this.pulseGain.gain.setTargetAtTime(value * 0.14, this.ctx.currentTime, 1.2);
  }

  private build(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.gain.setTargetAtTime(0.32, ctx.currentTime, 2.5);
    this.master.connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(4.5);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.master);

    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.5;
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 1100;
    padFilter.Q.value = 0.4;
    // Slowly breathing filter.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 500;
    lfo.connect(lfoDepth).connect(padFilter.frequency);
    lfo.start();
    this.padBus.connect(padFilter);
    padFilter.connect(this.master);
    padFilter.connect(this.reverb);

    // Sub drone on D.
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = midiToHz(38);
    const subGain = ctx.createGain();
    subGain.gain.value = 0.18;
    sub.connect(subGain).connect(this.master);
    sub.start();

    // Wind: filtered noise with a slow sweep.
    const noise = ctx.createBufferSource();
    noise.buffer = this.noise(4);
    noise.loop = true;
    const wind = ctx.createBiquadFilter();
    wind.type = 'bandpass';
    wind.frequency.value = 500;
    wind.Q.value = 0.8;
    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = 0.07;
    const windDepth = ctx.createGain();
    windDepth.gain.value = 300;
    windLfo.connect(windDepth).connect(wind.frequency);
    windLfo.start();
    const windGain = ctx.createGain();
    windGain.gain.value = 0.05;
    noise.connect(wind).connect(windGain).connect(this.master);
    noise.start();

    // Engine pulse for the cockpit, silent until setIntensity(1).
    const pulseOsc = ctx.createOscillator();
    pulseOsc.type = 'triangle';
    pulseOsc.frequency.value = midiToHz(26);
    const pulseAmp = ctx.createGain();
    pulseAmp.gain.value = 0.5;
    const pulseLfo = ctx.createOscillator();
    pulseLfo.type = 'square';
    pulseLfo.frequency.value = 2; // eighth notes at 120 bpm
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = 0.5;
    pulseLfo.connect(pulseDepth).connect(pulseAmp.gain);
    pulseLfo.start();
    this.pulseGain = ctx.createGain();
    this.pulseGain.gain.value = 0;
    const pulseFilter = ctx.createBiquadFilter();
    pulseFilter.type = 'lowpass';
    pulseFilter.frequency.value = 220;
    pulseOsc.connect(pulseAmp).connect(pulseFilter).connect(this.pulseGain).connect(this.master);
    pulseOsc.start();

    this.nextChordAt = ctx.currentTime + 0.1;
    this.nextPluckAt = ctx.currentTime + 4;
    this.setIntensity(this.intensity);
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (ctx == null || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now + 0.5 >= this.nextChordAt) {
      this.playChord(CHORDS[this.chordIndex % CHORDS.length], this.nextChordAt);
      this.chordIndex++;
      this.nextChordAt += CHORD_SECONDS;
    }
    if (now + 0.5 >= this.nextPluckAt) {
      const n = 2 + Math.floor(Math.random() * 3);
      let t = this.nextPluckAt;
      let idx = Math.floor(Math.random() * PLUCK_SCALE.length);
      for (let i = 0; i < n; i++) {
        this.playPluck(PLUCK_SCALE[idx], t);
        idx = Math.max(0, Math.min(PLUCK_SCALE.length - 1, idx + (Math.random() < 0.5 ? -2 : 1)));
        t += 0.35 + Math.random() * 0.25;
      }
      this.nextPluckAt = t + 3 + Math.random() * 5 - this.intensity * 2;
    }
  }

  private playChord(notes: number[], at: number): void {
    const ctx = this.ctx!;
    const len = CHORD_SECONDS + 3;
    for (const note of notes) {
      for (const detune of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToHz(note);
        osc.detune.value = detune;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(0.035, at + 3);
        g.gain.setValueAtTime(0.035, at + len - 4);
        g.gain.linearRampToValueAtTime(0, at + len);
        osc.connect(g).connect(this.padBus);
        osc.start(at);
        osc.stop(at + len + 0.1);
      }
    }
  }

  private playPluck(note: number, at: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToHz(note);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.09, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, at + 1.6);
    osc.connect(g);
    g.connect(this.reverb);
    g.connect(this.master);
    osc.start(at);
    osc.stop(at + 1.7);
  }

  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
    return buf;
  }

  private noise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      // Brown-ish noise: softer than white.
      last = (last + (Math.random() * 2 - 1) * 0.02) / 1.02;
      data[i] = last * 3.5;
    }
    return buf;
  }
}

export const music = new AmbientMusic();
