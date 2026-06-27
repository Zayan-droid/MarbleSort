// input.js — pointer/touch handling.
//
// ACTIVE: setupTapInput() — pure tap routing for the packet puzzle (no dragging). A tap on a
// top rack candy drops it, a tap on a bottom (active) jar sends matching candies there.
//
// DORMANT: the Dial flywheel + setupInput() below belong to the retired conveyor (state.js).
// They are kept in place but no longer wired up.

import { DIAL } from '../config.js';

// ---- ACTIVE: tap router for the packet → center → jars puzzle -----------
// `opts` provides geometry + intent callbacks:
//   opts.getLayout() -> { packets:[{x,y,r}], jars:[{id,x,y,w,h}] }
//   opts.onPacketTap(index), opts.onJarTap(jarId)
//   opts.onFirstGesture()
export function setupTapInput(canvas, opts) {
  let firstGesture = false;

  function toLocal(ev) {
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function inBox(p, b, margin = 1) {
    return Math.abs(p.x - b.x) <= b.w / 2 * margin && Math.abs(p.y - b.y) <= b.h / 2 * margin;
  }

  function onDown(ev) {
    if (!firstGesture) { firstGesture = true; opts.onFirstGesture && opts.onFirstGesture(); }
    const p = toLocal(ev);
    const L = opts.getLayout();
    if (!L) return;

    // top packets (square tiles), with a small forgiving margin
    const packets = L.packets || [];
    for (let i = 0; i < packets.length; i++) {
      const t = packets[i];
      const r = t.r * 1.05;
      if (Math.abs(p.x - t.x) <= r && Math.abs(p.y - t.y) <= r) { opts.onPacketTap(i); return; }
    }
    // bottom jar queues — only the ACTIVE (front) jar of each lane is tappable; L.jars holds
    // those hit-boxes (each carrying its jar id).
    const jars = L.jars || [];
    for (let i = 0; i < jars.length; i++) {
      if (inBox(p, jars[i], 1.04)) { opts.onJarTap(jars[i].id); return; }
    }
  }

  canvas.addEventListener('pointerdown', onDown);
  // prevent the page from scrolling/zooming under the gesture
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
}

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
//   opts.getLayout() -> { cx, cy, innerR, outerR, packets:[{x,y,r}] }
//   opts.onPacketTap(index) -> boolean  (true if a release started)
//   opts.onFirstGesture()
export function setupInput(canvas, dial, opts) {
  let dialPointerId = null;
  let firstGesture = false;

  function toLocal(ev) {
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function packetHit(p) {
    const layout = opts.getLayout();
    const packets = layout.packets || [];
    for (let i = 0; i < packets.length; i++) {
      const t = packets[i];
      // square hit-test (tiles are square grid cells), with a small forgiving margin
      const r = t.r * 1.05;
      if (Math.abs(p.x - t.x) <= r && Math.abs(p.y - t.y) <= r) return i;
    }
    return -1;
  }

  function onDown(ev) {
    if (!firstGesture) { firstGesture = true; opts.onFirstGesture(); }
    const p = toLocal(ev);

    const pi = packetHit(p);
    if (pi >= 0) {
      opts.onPacketTap(pi); // a single tap streams the whole packet
      return;               // a packet tap is not a dial grab
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
