// haptics.js — vibration abstraction.
//
// navigator.vibrate is coarse on Android Chrome and ABSENT on iOS Safari, so this
// is a clean, feature-detected facade: every game event is a single named call.
// Game code never touches navigator.vibrate directly, so this can later be
// remapped to native rich haptics (Capacitor Haptics / Core Haptics) WITHOUT
// touching any game code — just swap the implementations below.

import { HAPTICS, SCORING } from '../config.js';

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

class Haptics {
  constructor() {
    this.supported =
      typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    this.enabled = HAPTICS.enabled && this.supported;
    this._lastRumble = 0;
    this._now = () => (typeof performance !== 'undefined' ? performance.now() : 0);
  }

  setEnabled(on) {
    this.enabled = on && this.supported;
    if (!this.enabled) this._safeVibrate(0); // cancel any ongoing pattern
  }

  _safeVibrate(pattern) {
    if (!this.enabled) return;
    try {
      navigator.vibrate(pattern);
    } catch {
      /* some browsers throw if called without a user gesture — ignore */
    }
  }

  // --- Named events ---------------------------------------------------------

  // Continuous spin "rumble" approximated by rapid short pulses whose rate and
  // length scale with spin speed. Self-throttles so we never spam the motor.
  spinRumble(speed) {
    if (!this.enabled) return;
    const t = clamp01(Math.abs(speed) / HAPTICS.rumbleSpeedRef);
    if (t < 0.06) return; // essentially still — stay silent
    const interval = lerp(HAPTICS.rumbleMaxIntervalMs, HAPTICS.rumbleMinIntervalMs, t);
    const now = this._now();
    if (now - this._lastRumble < interval) return;
    this._lastRumble = now;
    const pulse = Math.round(lerp(HAPTICS.rumbleMinPulse, HAPTICS.rumbleMaxPulse, t));
    this._safeVibrate(pulse);
  }

  // Crisp single pulse per detent / per marble passing a marker.
  tick() {
    this._safeVibrate(HAPTICS.tickMs);
  }

  // Strong single pulse when the player releases a candy (tap or stream).
  release() {
    this._safeVibrate(HAPTICS.candyRelease);
  }

  // Firm short thump when a marble seats into a box.
  seat() {
    this._safeVibrate(HAPTICS.seatMs);
  }

  // Celebratory triple-pulse when a box clears. The feel-layer deepens it with the combo link and
  // clutch — navigator.vibrate has no amplitude, so we scale the pulse DURATIONS (clamped).
  // opts: { comboIndex, clutch, multiplier }.
  clear(opts = {}) {
    const { comboIndex = 1, clutch = false } = opts;
    const intensity = 1
      + (comboIndex - 1) * SCORING.combo.hapticStep
      + (clutch ? SCORING.clutch.hapticBoost : 0);
    const k = Math.min(intensity, 2.5); // cap so a long cascade doesn't buzz forever
    this._safeVibrate(HAPTICS.clearPattern.map((ms) => Math.round(ms * k)));
  }

  // Soft pulse when a jam is imminent.
  warning() {
    this._safeVibrate(HAPTICS.warningMs);
  }
}

export const haptics = new Haptics();
