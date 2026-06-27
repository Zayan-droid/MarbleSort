// audio.js — fully procedural Web Audio. No audio files.
//
// Signal graph:
//   voices ─┐
//   rumble ─┤
//   whir  ─┼─> busLowpass ─┬─> dryGain ───────────┐
//   pad   ─┘               └─> convolver ─> wetGain┴─> compressor ─> master ─> out
//
// Every synth voice is a small factory function, so a real sample could later
// replace any single voice without touching the rest of the graph.

import { AUDIO } from '../config.js';

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function clamp01(x) { return clamp(x, 0, 1); }
function lerp(a, b, t) { return a + (b - a) * t; }

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this._clinkTimes = [];      // recent clink timestamps (throttle)
    this._lastClink = 0;
    this._smoothSpeed = 0;
    this._smoothActivity = 0;
  }

  // Must be called from a user gesture (button / first pointer).
  async ensureStarted() {
    if (!this.ctx) this._build();
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch { /* ignore */ }
    }
    this.ready = this.ctx.state === 'running';
    return this.ready;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) {
      const g = m ? 0 : AUDIO.master;
      this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.05);
    }
  }

  _build() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    // --- master chain ---
    this.master = ctx.createGain();
    this.master.gain.value = AUDIO.master;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 26;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;

    this.busLowpass = ctx.createBiquadFilter();
    this.busLowpass.type = 'lowpass';
    this.busLowpass.frequency.value = AUDIO.masterLowpassHz;
    this.busLowpass.Q.value = 0.5;

    const dry = ctx.createGain();
    dry.gain.value = 1 - AUDIO.reverbWet * 0.5;
    const wet = ctx.createGain();
    wet.gain.value = AUDIO.reverbWet;
    const conv = ctx.createConvolver();
    conv.buffer = this._makeImpulse(AUDIO.reverbSeconds, AUDIO.reverbDecay);

    // busLowpass -> dry -> comp ; busLowpass -> conv -> wet -> comp
    this.busLowpass.connect(dry);
    dry.connect(comp);
    this.busLowpass.connect(conv);
    conv.connect(wet);
    wet.connect(comp);
    comp.connect(this.master);
    this.master.connect(ctx.destination);

    // shared noise buffer for rumble
    this._noise = this._makeNoise(2.0);

    this._buildRumble();
    this._buildWhir();
    this._buildPad();
  }

  // --- buffers --------------------------------------------------------------

  _makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Short synthetic impulse response: white noise with exponential decay -> warm reverb.
  _makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  // --- continuous beds ------------------------------------------------------

  _buildRumble() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = AUDIO.rumbleCutoffMin;
    lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(lp); lp.connect(g); g.connect(this.busLowpass);
    src.start();
    this._rumble = { lp, g };
  }

  _buildWhir() {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = AUDIO.whirBaseHz;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = AUDIO.whirBaseHz * 3;
    hp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = 0;
    osc.connect(hp); hp.connect(g); g.connect(this.busLowpass);
    osc.start();
    this._whir = { osc, hp, g };
  }

  _buildPad() {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = AUDIO.padGain;
    g.connect(this.busLowpass);
    const oscs = [];
    for (const f of AUDIO.padNotes) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const od = ctx.createOscillator();
      od.type = 'sine';
      od.frequency.value = f * 1.005; // gentle detune chorus
      const og = ctx.createGain();
      og.gain.value = 0.5 / AUDIO.padNotes.length;
      o.connect(og); od.connect(og); og.connect(g);
      o.start(); od.start();
      oscs.push(o, od);
    }
    // slow swell LFO
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = AUDIO.padGain * 0.4;
    lfo.connect(lfoGain); lfoGain.connect(g.gain);
    lfo.start();
    this._pad = { g, oscs };
  }

  // Per-frame update of continuous beds from spin speed and overall activity (0..1).
  update(dt, speed, activity) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = clamp01(Math.abs(speed) / AUDIO.rumbleSpeedRef);
    this._smoothSpeed = lerp(this._smoothSpeed, s, clamp01(dt * 8));
    this._smoothActivity = lerp(this._smoothActivity, clamp01(activity), clamp01(dt * 4));
    const ss = this._smoothSpeed;

    // rumble: volume + cutoff rise with speed
    this._rumble.g.gain.setTargetAtTime(AUDIO.rumbleGain * (0.12 + 0.88 * ss), t, 0.08);
    this._rumble.lp.frequency.setTargetAtTime(
      lerp(AUDIO.rumbleCutoffMin, AUDIO.rumbleCutoffMax, ss), t, 0.08);

    // whir: airy tone on fast spins only
    const wt = clamp01((Math.abs(speed) - AUDIO.whirThreshold) / (AUDIO.rumbleSpeedRef - AUDIO.whirThreshold));
    this._whir.g.gain.setTargetAtTime(AUDIO.whirGain * wt, t, 0.1);
    this._whir.osc.frequency.setTargetAtTime(AUDIO.whirBaseHz * (1 + 0.5 * ss), t, 0.1);

    // pad: swells slightly with activity
    this._pad.g.gain.setTargetAtTime(
      AUDIO.padGain + AUDIO.padSwell * this._smoothActivity, t, 0.3);
  }

  // --- one-shot voices ------------------------------------------------------

  // Bright, slightly inharmonic glass ping. pan in [-1,1] places it around the loop.
  clink(pan = 0, intensity = 1) {
    if (!this.ready) return;
    const now = performance.now();
    // global throttle so dense collisions don't machine-gun
    this._clinkTimes = this._clinkTimes.filter((x) => now - x < 60);
    if (now - this._lastClink < AUDIO.clinkThrottleMs) return;
    if (this._clinkTimes.length >= AUDIO.clinkMaxPerFrame * 3) return;
    this._lastClink = now;
    this._clinkTimes.push(now);

    const ctx = this.ctx;
    const t = ctx.currentTime;
    const jitter = 1 + (Math.random() * 2 - 1) * AUDIO.clinkPitchJitter;
    const f = AUDIO.clinkBaseHz * jitter;
    const gain = ctx.createGain();
    const vol = AUDIO.clinkGain * clamp(intensity, 0.25, 1.4);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + AUDIO.clinkDecay);

    // FM-ish: carrier + slightly inharmonic partial
    const c = ctx.createOscillator();
    c.type = 'sine';
    c.frequency.value = f;
    const p = ctx.createOscillator();
    p.type = 'sine';
    p.frequency.value = f * 2.76; // inharmonic ratio -> "glassy"
    const pg = ctx.createGain();
    pg.gain.value = vol * 0.35;

    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);

    c.connect(gain);
    p.connect(pg); pg.connect(gain);
    gain.connect(panner); panner.connect(this.busLowpass);
    c.start(t); p.start(t);
    c.stop(t + AUDIO.clinkDecay + 0.02);
    p.stop(t + AUDIO.clinkDecay + 0.02);
  }

  // Punchy candy "pop" on release: a short bandpassed noise burst + a quick tonal
  // blip that drops in pitch. pan in [-1,1] places it around the loop.
  pop(pan = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dec = AUDIO.popDecay;
    const pan2 = ctx.createStereoPanner();
    pan2.pan.value = clamp(pan, -1, 1);
    pan2.connect(this.busLowpass);

    // noise burst through a resonant bandpass -> the crisp "tick" of the pop
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = AUDIO.popHz;
    bp.Q.value = AUDIO.popQ;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(AUDIO.popGain, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    src.connect(bp); bp.connect(ng); ng.connect(pan2);
    src.start(t); src.stop(t + dec + 0.02);

    // tonal blip for body, pitch dropping fast -> the rounded "boop"
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(AUDIO.popHz * 1.2, t);
    o.frequency.exponentialRampToValueAtTime(AUDIO.popHz * 0.6, t + dec);
    const og = ctx.createGain();
    og.gain.setValueAtTime(AUDIO.popGain * 0.6, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    o.connect(og); og.connect(pan2);
    o.start(t); o.stop(t + dec + 0.02);
  }

  // Rounded woody "plunk" when a marble seats.
  seat(pan = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(AUDIO.seatGain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + AUDIO.seatDecay);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(AUDIO.seatHz * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(AUDIO.seatHz, t + 0.05);
    const sine = ctx.createOscillator();
    sine.type = 'sine';
    sine.frequency.value = AUDIO.seatHz * 0.5;
    const sg = ctx.createGain();
    sg.gain.value = AUDIO.seatGain * 0.5;
    const pan2 = ctx.createStereoPanner();
    pan2.pan.value = clamp(pan, -1, 1);
    o.connect(g); sine.connect(sg); sg.connect(g);
    g.connect(pan2); pan2.connect(this.busLowpass);
    o.start(t); sine.start(t);
    o.stop(t + AUDIO.seatDecay + 0.02);
    sine.stop(t + AUDIO.seatDecay + 0.02);
  }

  // Soft ascending chime when a box clears.
  clear() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    AUDIO.clearNotes.forEach((f, i) => {
      const t = t0 + (i * AUDIO.clearStepMs) / 1000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(AUDIO.clearGain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = f * 2;
      const o2g = ctx.createGain();
      o2g.gain.value = AUDIO.clearGain * 0.25;
      o.connect(g); o2.connect(o2g); o2g.connect(g);
      g.connect(this.busLowpass);
      o.start(t); o2.start(t);
      o.stop(t + 0.4); o2.stop(t + 0.4);
    });
  }

  // Soft low pulse when a jam is imminent.
  warning() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(AUDIO.warnGain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(AUDIO.warnHz, t);
    o.frequency.exponentialRampToValueAtTime(AUDIO.warnHz * 0.6, t + 0.3);
    o.connect(g); g.connect(this.busLowpass);
    o.start(t); o.stop(t + 0.32);
  }
}

export const audio = new AudioEngine();
