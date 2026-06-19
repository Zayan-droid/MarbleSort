// input.js — pointer/touch handling.
//   * Dragging anywhere on the loop spins the dial with 1:1, zero-latency tracking.
//   * On release the dial coasts (flywheel) and decays toward base speed via friction.
//   * Load (marble count) makes the dial feel heavier: longer coast, slightly laggier grab.
//   * Tapping a tray releases its next marble.

import { DIAL } from '../config.js';

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function lerp(a, b, t) { return a + (b - a) * t; }

// The flywheel dial. Owns the belt's angular velocity.
export class Dial {
  constructor() {
    this.angularVel = DIAL.baseSpeed * DIAL.baseDirection; // rad/s
    this.dragging = false;
    this._lastAngle = 0;
    this._lastT = 0;
    this._measured = 0;
    this.load = 0; // updated by the game each frame (marble count)
  }

  grab(angle, t) {
    this.dragging = true;
    this._lastAngle = angle;
    this._lastT = t;
    this._measured = 0;
  }

  move(angle, t) {
    if (!this.dragging) return;
    const dt = Math.max((t - this._lastT) / 1000, 1e-4);
    const dA = wrapAngle(angle - this._lastAngle);
    this._lastAngle = angle;
    this._lastT = t;
    const raw = clamp(dA / dt, -DIAL.maxSpeed, DIAL.maxSpeed);
    // light smoothing of the noisy sample; load reduces responsiveness slightly
    const resp = clamp(DIAL.dragResponsiveness - DIAL.dragLoadDrag * this.load, 0.4, 1);
    this._measured = lerp(this._measured, raw, resp);
    this.angularVel = this._measured; // 1:1 tracking while dragging
  }

  release() {
    this.dragging = false;
    // angularVel is preserved -> the flick coasts from here
  }

  // Free-spin integration: decelerate toward base speed via load-eased friction.
  update(dt) {
    if (this.dragging) return;
    const target = DIAL.baseSpeed * DIAL.baseDirection;
    const decay = DIAL.decayBase / (1 + DIAL.decayLoadRelief * this.load);
    const k = 1 - Math.exp(-decay * dt);
    this.angularVel += (target - this.angularVel) * k;
    this.angularVel = clamp(this.angularVel, -DIAL.maxSpeed, DIAL.maxSpeed);
  }
}

// Wire pointer events. `opts` provides geometry + callbacks.
//   opts.getLayout() -> { cx, cy, innerR, outerR, trays:[{x,y,r}] }
//   opts.onTrayTap(index)
//   opts.onFirstGesture()
export function setupInput(canvas, dial, opts) {
  let dialPointerId = null;
  let firstGesture = false;

  function toLocal(ev) {
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function trayHit(p) {
    const layout = opts.getLayout();
    for (let i = 0; i < layout.trays.length; i++) {
      const t = layout.trays[i];
      if (Math.hypot(p.x - t.x, p.y - t.y) <= t.r) return i;
    }
    return -1;
  }

  function onDown(ev) {
    if (!firstGesture) { firstGesture = true; opts.onFirstGesture(); }
    const p = toLocal(ev);

    const ti = trayHit(p);
    if (ti >= 0) {
      opts.onTrayTap(ti);
      return; // a tray tap is not a dial grab
    }

    if (dialPointerId !== null) return; // already dragging with another finger
    const layout = opts.getLayout();
    const angle = Math.atan2(p.y - layout.cy, p.x - layout.cx);
    dialPointerId = ev.pointerId;
    canvas.setPointerCapture?.(ev.pointerId);
    dial.grab(angle, performance.now());
  }

  function onMove(ev) {
    if (ev.pointerId !== dialPointerId) return;
    const p = toLocal(ev);
    const layout = opts.getLayout();
    const angle = Math.atan2(p.y - layout.cy, p.x - layout.cx);
    dial.move(angle, performance.now());
  }

  function onUp(ev) {
    if (ev.pointerId !== dialPointerId) return;
    dialPointerId = null;
    canvas.releasePointerCapture?.(ev.pointerId);
    dial.release();
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  // prevent the page from scrolling/zooming under the gesture
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
}
