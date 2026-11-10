import { clamp } from './utils.js';

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.volume = 0.75;
    this.hornOn = false;
    this._lastHorn = false;
    this.rainOn = false;
  }

  init() {
    if (this.started) {
      if (this.ctx?.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.started = true;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    // engine chain
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 320;
    this.engineFilter.Q.value = 1.2;
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc1.frequency.value = 48;
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    this.osc2.frequency.value = 96;
    this.osc2.detune.value = 7;
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.32;
    this.osc1.connect(this.engineFilter);
    this.osc2.connect(osc2Gain);
    osc2Gain.connect(this.engineFilter);
    this.osc1.start(); this.osc2.start();
    // engine clatter noise
    this.noiseBuf = this._makeNoise(2.0);
    this.clatter = ctx.createBufferSource();
    this.clatter.buffer = this.noiseBuf;
    this.clatter.loop = true;
    this.clatterFilter = ctx.createBiquadFilter();
    this.clatterFilter.type = 'bandpass';
    this.clatterFilter.frequency.value = 180;
    this.clatterFilter.Q.value = 0.8;
    this.clatterGain = ctx.createGain();
    this.clatterGain.gain.value = 0;
    this.clatter.connect(this.clatterFilter);
    this.clatterFilter.connect(this.clatterGain);
    this.clatterGain.connect(this.master);
    this.clatter.start();
    // road noise
    this.road = ctx.createBufferSource();
    this.road.buffer = this.noiseBuf;
    this.road.loop = true;
    this.roadFilter = ctx.createBiquadFilter();
    this.roadFilter.type = 'lowpass';
    this.roadFilter.frequency.value = 500;
    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    this.road.connect(this.roadFilter);
    this.roadFilter.connect(this.roadGain);
    this.roadGain.connect(this.master);
    this.road.start();
    // wind
    this.wind = ctx.createBufferSource();
    this.wind.buffer = this.noiseBuf;
    this.wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'highpass';
    this.windFilter.frequency.value = 1200;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.wind.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    this.wind.start();
    // rain
    this.rain = ctx.createBufferSource();
    this.rain.buffer = this.noiseBuf;
    this.rain.loop = true;
    this.rainFilter = ctx.createBiquadFilter();
    this.rainFilter.type = 'highpass';
    this.rainFilter.frequency.value = 1800;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.rain.connect(this.rainFilter);
    this.rainFilter.connect(this.rainGain);
    this.rainGain.connect(this.master);
    this.rain.start();
    // horn
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    this.hornFilter = ctx.createBiquadFilter();
    this.hornFilter.type = 'lowpass';
    this.hornFilter.frequency.value = 1600;
    this.hornGain.connect(this.hornFilter);
    this.hornFilter.connect(this.master);
    this.hornOscA = ctx.createOscillator();
    this.hornOscA.type = 'sawtooth';
    this.hornOscA.frequency.value = 355;
    this.hornOscB = ctx.createOscillator();
    this.hornOscB.type = 'square';
    this.hornOscB.frequency.value = 453;
    this.hornOscA.connect(this.hornGain);
    this.hornOscB.connect(this.hornGain);
    this.hornOscA.start(); this.hornOscB.start();
  }

  _makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 2.5;
    }
    return buf;
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.08);
  }

  update(state) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const { rpm = 620, throttle = 0, speed = 0, engineOn = true, rain = false } = state;
    const targetEngine = engineOn ? 0.105 + throttle * 0.14 : 0;
    this.engineGain.gain.setTargetAtTime(targetEngine, t, 0.09);
    const freq = 24 + rpm * 0.032;
    this.osc1.frequency.setTargetAtTime(freq, t, 0.05);
    this.osc2.frequency.setTargetAtTime(freq * 2.01, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(150 + rpm * 0.28 + throttle * 280, t, 0.08);
    this.clatterGain.gain.setTargetAtTime(engineOn ? 0.018 + throttle * 0.035 : 0, t, 0.1);
    this.clatterFilter.frequency.setTargetAtTime(140 + rpm * 0.22, t, 0.1);
    const kmh = Math.min(100, speed * 3.6);
    this.roadGain.gain.setTargetAtTime(engineOn ? kmh * 0.00075 : 0, t, 0.15);
    this.roadFilter.frequency.setTargetAtTime(280 + kmh * 8, t, 0.15);
    this.windGain.gain.setTargetAtTime(kmh * kmh * 0.000018, t, 0.2);
    this.rainGain.gain.setTargetAtTime(rain ? 0.045 : 0, t, 0.5);
    const hornTarget = this.hornOn ? 0.13 : 0;
    this.hornGain.gain.setTargetAtTime(hornTarget, t, 0.02);
    if (this.hornOn !== this._lastHorn) {
      this._lastHorn = this.hornOn;
    }
  }

  setHorn(on) { this.hornOn = on; }

  click() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(440, t + 0.06);
    g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.08);
  }

  tick() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square'; o.frequency.value = 1400;
    g.gain.setValueAtTime(0.028, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.05);
  }

  crash() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(120, t + 0.38);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + 0.5);
    const o = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(60, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.3);
    og.gain.setValueAtTime(0.5, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.42);
  }

  airBrake() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 1400;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + 0.55);
  }

  chime() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523, 659, 784].forEach((freq, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.09, t + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.5);
      o.connect(g); g.connect(this.master);
      o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.55);
    });
  }
}
