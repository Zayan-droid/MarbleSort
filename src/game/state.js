// state.js — game state + the AUTHORITATIVE angular-track conveyor model.
//
// Three stacked zones: a tray ROW across the top, the round loop in the middle,
// a bin ROW across the bottom. The conveyor is NOT emergent physics: every
// riding marble owns an `angle` on the loop and is advanced each frame by the
// belt's angular speed (base auto-spin + the dial's velocity). It is rendered at
// (center + R, at its angle), so it visibly travels around the ring.
//
//   release  -> marble FALLS from a top tray onto the loop at that tray's entry angle
//   ride     -> angle advances each frame; light deterministic jostle keeps marbles
//               from overlapping and emits clinks when they bump
//   drop-off -> when a riding marble's angle reaches a bottom bin whose color
//               matches and has room, it detaches and falls DOWN into that bin
//   clear    -> a full bin bursts and resets
//
// Matter.js is intentionally NOT used for the carry (it tunneled / flung marbles).

import { bus, EV } from '../core/events.js';
import {
  LEVELS, ACTIVE_LEVEL, COLORS, LOOP, MARBLE, TRAY, BIN, RULES, DIAL, RADIAL, RELEASE, SEAT,
} from '../config.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
function clamp01(x) { return clamp(x, 0, 1); }
function norm(a) { return ((a % TAU) + TAU) % TAU; }
function wrapPi(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
function lerp(a, b, t) { return a + (b - a) * t; }

let _nextId = 1;

export class GameState {
  constructor() {
    this.phase = 'ready';     // ready | playing | win | lose
    this.layout = null;
    this.marbles = [];        // on-loop marbles: state 'entering' | 'riding' | 'dropping'
    this.beltAngle = 0;       // accumulated belt rotation, for detents + rim render
    this._detentIndex = 0;
    this._lastDetentT = 0;
    this._warnCooldown = 0;
    this._time = 0;          // dt-accumulated game clock (ms), for the release gate
    this._lastSpinT = -1e9;  // game time the dial was last "spinning" (far past => start calm)
    this._autoFlow = false;  // belt currently running on its own (no player influence)?
    this._autoFlowSince = 0; // game time auto-flow began
    this.canSeat = false;    // are drop-offs into bins currently allowed?
    this.activity = 0;
    this._lastOmega = 0;
    this.loadLevel(ACTIVE_LEVEL);
  }

  loadLevel(idx) {
    const def = LEVELS[idx];
    this.levelDef = def;
    // dump=true => the whole stack is queued to pour onto the loop when calm
    this.trays = def.trays.map((stack) => ({ stack: [...stack].reverse(), dump: false })); // pop() = front
    this.bins = def.bins.map((colorKey) => ({
      colorKey,
      filled: 0,
      seated: [],         // { colorKey, x, y, slot, pop }
      clearing: false,
      clearAt: 0,
    }));
    this.marbles = [];
    this.phase = 'playing';
  }

  // ---- layout: three stacked zones, fully responsive -----------------------
  // Works at any size / aspect ratio (portrait phone, landscape, ultrawide):
  // element sizes scale with the smaller screen dimension (with px floors), the
  // loop is centered BETWEEN the two rows, its radius is fit so the outer rail
  // always clears the rows + screen edges, and each row's span is bounded so it
  // can never run off-screen or overlap its own items.
  resize(w, h) {
    const s = Math.min(w, h);
    const cx = w / 2;

    const trackW = LOOP.trackWidthFrac * s;
    const half = trackW / 2;
    // marble fits the channel with radial room to spare
    const marbleR = clamp(Math.max(MARBLE.radiusFrac * s, MARBLE.minRadiusPx), 6, half * 0.8);
    const trayR = Math.max(TRAY.sizeFrac * s, TRAY.minSizePx);
    const binR = Math.max(BIN.sizeFrac * s, BIN.minSizePx);

    // vertical bands reserved for each row, then the loop takes the middle
    const trayBandH = trayR * 1.6 + trayR * 0.34;  // box + spout
    const binBandH = binR * 1.8;
    const padY = Math.max(s * 0.025, 8);
    const trayRowY = padY + trayBandH / 2;
    const binRowY = h - padY - binBandH / 2;
    const cy = (trayRowY + binRowY) / 2;            // loop centered between the rows

    const gap = Math.max(s * 0.02, marbleR * 0.6);
    const sideMargin = Math.max(s * 0.03, 10);
    const fitTop = (cy - trayRowY) - trayBandH / 2 - gap - half;
    const fitBot = (binRowY - cy) - binBandH / 2 - gap - half;
    const fitSide = w / 2 - sideMargin - half;
    const R = Math.max(40, Math.min(LOOP.radiusFracCap * s, fitTop, fitBot, fitSide));
    const clampDx = R * 0.82;

    // place a row of items, bounded so it never overflows or self-overlaps
    const placeRow = (items, sizeR, y, aim, arcSign) => {
      const n = items.length;
      const itemW = sizeR * 2;
      const minSpread = (n - 1) * itemW * 1.12;           // no self-overlap
      const maxSpread = Math.max(minSpread, w - itemW - 2 * sideMargin); // stay on screen
      const spread = n <= 1 ? 0 : clamp(2 * R * aim, minSpread, maxSpread);
      return items.map((_, i) => {
        const x = n <= 1 ? cx : cx + ((i / (n - 1)) - 0.5) * spread;
        const dx = clamp(x - cx, -clampDx, clampDx);
        const py = cy + arcSign * Math.sqrt(Math.max(0, R * R - dx * dx));
        return { x, y, r: sizeR, angle: Math.atan2(py - cy, dx), point: { x: cx + dx, y: py } };
      });
    };

    const trays = placeRow(this.trays, trayR, trayRowY, TRAY.spreadAimFrac, -1)
      .map((p) => ({ x: p.x, y: p.y, r: p.r, entryAngle: p.angle, entry: p.point }));
    const bins = placeRow(this.bins, binR, binRowY, BIN.spreadAimFrac, +1)
      .map((p) => ({ x: p.x, y: p.y, r: p.r, dropAngle: p.angle, drop: p.point }));

    this.layout = {
      w, h, cx, cy, R, trackW, marbleR,
      innerR: R - half, outerR: R + half,
      trays, bins, trayRowY, binRowY,
    };

    // keep in-flight marbles inside the new channel after a resize
    const rMin = (R - half) + marbleR, rMax = (R + half) - marbleR;
    for (const m of this.marbles) {
      if (typeof m.rr === 'number') m.rr = clamp(m.rr, rMin, rMax);
    }
    return this.layout;
  }

  colorOf(key) { return COLORS[key]; }

  // Screen position of slot `i` within bin layout `bl`.
  slotPos(bl, i, n) {
    const spread = bl.r * 1.5;
    const t = n <= 1 ? 0 : (i / (n - 1)) * 2 - 1; // -1..1
    return { x: bl.x + t * spread, y: bl.y };
  }

  beltCount() {
    let n = 0;
    for (const m of this.marbles) if (m.state === 'entering' || m.state === 'riding') n++;
    return n;
  }

  // ---- tap a tray: queue its WHOLE stack to dump -----------------------------
  // The actual placement onto the loop is gated on the dial being calm (see
  // _placeQueued, called from update). Tapping just flags the tray.
  tapTray(trayIndex) {
    if (this.phase !== 'playing') return;
    const tray = this.trays[trayIndex];
    if (!tray || tray.stack.length === 0) return;
    tray.dump = true;
  }

  // Place all queued tray dumps onto the loop, but only once the dial has been
  // calm (not spinning) for RELEASE.placeDelayMs of game time.
  _placeQueued(spinning) {
    if (spinning) this._lastSpinT = this._time;
    if (this._time - this._lastSpinT < RELEASE.placeDelayMs) return;
    for (let i = 0; i < this.trays.length; i++) {
      if (this.trays[i].dump && this.trays[i].stack.length) this._dumpTray(i);
    }
  }

  // Pour an entire tray's stack onto the loop at once, fanned out by a small
  // angular offset so the balls form a neat stream instead of overlapping.
  _dumpTray(trayIndex) {
    const tray = this.trays[trayIndex];
    const tl = this.layout.trays[trayIndex];
    const L = this.layout;
    const angStep = (2 * L.marbleR * RELEASE.streamAngleGap) / L.R;
    const dir = DIAL.baseDirection >= 0 ? 1 : -1;
    const count = tray.stack.length;
    for (let k = 0; k < count; k++) {
      const colorKey = tray.stack.pop();
      const a = norm(tl.entryAngle - dir * k * angStep); // trail behind the entry point
      const ex = L.cx + Math.cos(a) * L.R;
      const ey = L.cy + Math.sin(a) * L.R;
      this.marbles.push({
        id: _nextId++,
        colorKey,
        state: 'entering',
        angle: a,
        jitter: 1 + (Math.random() * 2 - 1) * MARBLE.speedJitter,
        // radial axis (centrifugal physics): rr = distance from loop center
        rr: L.R, vr: 0, roll: Math.random() * Math.PI * 2,
        // fall tween from the tray down onto the loop
        fromX: tl.x, fromY: tl.y, toX: ex, toY: ey,
        x: tl.x, y: tl.y, t: 0, dur: MARBLE.entryDurationMs,
        touching: false,
        bin: null, slot: 0,
      });
      bus.emit(EV.MARBLE_DROP, { x: tl.x, y: tl.y, color: colorKey, angle: a });
    }
    tray.dump = false;
  }

  // ---- main update ----------------------------------------------------------
  update(dt, omega, dragging = false) {
    if (this.phase !== 'playing') return;
    this._lastOmega = omega;
    this._time += dt * 1000;
    const L = this.layout;

    // place queued tray dumps once the dial has been calm for RELEASE.placeDelayMs
    const spinning = dragging || Math.abs(omega) > DIAL.baseSpeed * RELEASE.spinThreshold;
    this._placeQueued(spinning);

    // Drop-offs into bins are gated on the belt having FULLY resumed auto-flow
    // (player not dragging AND speed back to base) and held it for autoFlowDelayMs.
    const base = DIAL.baseSpeed * DIAL.baseDirection;
    const autoFlow = !dragging && Math.abs(omega - base) < SEAT.autoFlowEpsilon;
    if (autoFlow) {
      if (!this._autoFlow) { this._autoFlow = true; this._autoFlowSince = this._time; }
    } else {
      this._autoFlow = false;
    }
    this.canSeat = this._autoFlow && (this._time - this._autoFlowSince >= SEAT.autoFlowDelayMs);

    this._updateDetents(dt, omega);
    this._advanceMarbles(dt, omega);
    this._resolveJostle(omega);
    this._detectDropOff(this.canSeat);
    this._resolveBinClears();

    // activity (drives ambient swell)
    const beltN = this.beltCount();
    const target = clamp01(beltN / RULES.loopCapacity * 0.7 + Math.abs(omega) / DIAL.maxSpeed * 0.5);
    this.activity += (target - this.activity) * clamp01(dt * 3);

    // jam warning
    if (beltN >= RULES.warnAt) {
      const now = performance.now();
      if (now - this._warnCooldown > 900) {
        this._warnCooldown = now;
        bus.emit(EV.JAM_WARNING, { count: beltN });
      }
    }

    // lose / win
    if (beltN > RULES.loopCapacity) {
      this.phase = 'lose';
      bus.emit(EV.GAME_LOSE, {});
      return;
    }
    const traysEmpty = this.trays.every((t) => t.stack.length === 0);
    if (traysEmpty && this.marbles.length === 0) {
      this.phase = 'win';
      bus.emit(EV.GAME_WIN, {});
    }
  }

  _updateDetents(dt, omega) {
    this.beltAngle += omega * dt;
    const step = TAU / DIAL.detents;
    const idx = Math.floor(this.beltAngle / step);
    if (idx !== this._detentIndex && Math.abs(omega) > 0.05) {
      const now = performance.now();
      if (now - this._lastDetentT >= 1000 / DIAL.detentMaxRate) {
        this._lastDetentT = now;
        bus.emit(EV.DIAL_DETENT, { speed: omega });
      }
      this._detentIndex = idx;
    }
  }

  _advanceMarbles(dt, omega) {
    const L = this.layout;
    for (let i = this.marbles.length - 1; i >= 0; i--) {
      const m = this.marbles[i];
      if (m.state === 'riding') {
        // AUTHORITATIVE angular transport: advance the angle by belt speed, but cap
        // the per-frame step so a hard spin / low frame rate can't make the ball jump
        // a visible gap (which strobes as a faint ghost down the track).
        const rr0 = m.rr || L.R;
        const maxStep = (MARBLE.maxStepRadii * L.marbleR) / Math.max(rr0, 1);
        let dAng = omega * dt * m.jitter;
        if (dAng > maxStep) dAng = maxStep;
        else if (dAng < -maxStep) dAng = -maxStep;
        m.angle = norm(m.angle + dAng);

        // RADIAL axis — centrifugal "spinning bowl" physics, independent of transport.
        // outward = gain*omega^2*r ; a spring pulls back to the centerline at rest.
        const aOut = RADIAL.centrifugalGain * omega * omega * m.rr;
        const aSpring = -RADIAL.settleStiffness * (m.rr - L.R);
        m.vr += (aOut + aSpring) * dt;
        m.vr *= Math.max(0, 1 - RADIAL.damping * dt); // radial damping (no jelly)
        m.rr += m.vr * dt;
        // HARD rails: clamp inside the channel, bounce with restitution, clack on impact
        const rMin = L.innerR + L.marbleR, rMax = L.outerR - L.marbleR;
        if (m.rr > rMax) {
          m.rr = rMax;
          if (m.vr > RADIAL.railClinkMinSpeed) this._railClink(m);
          m.vr = -m.vr * RADIAL.restitution;
        } else if (m.rr < rMin) {
          m.rr = rMin;
          if (m.vr < -RADIAL.railClinkMinSpeed) this._railClink(m);
          m.vr = -m.vr * RADIAL.restitution;
        }
        // visual roll matches travel speed (tangential = omega * rr)
        m.roll += (RADIAL.rollScale * omega * m.rr / L.marbleR) * dt;
      } else if (m.state === 'entering') {
        m.t = clamp01(m.t + (dt * 1000) / m.dur);
        const e = 1 - Math.pow(1 - m.t, 2); // ease-out
        m.x = lerp(m.fromX, m.toX, e);
        m.y = lerp(m.fromY, m.toY, e);
        if (m.t >= 1) {
          m.state = 'riding';
          m.angle = norm(m.angle);
          m.rr = L.R; m.vr = 0; // land on the centerline, at rest radially
          // a soft clink as it lands on the belt
          bus.emit(EV.MARBLE_CLINK, { x: m.toX, y: m.toY, angle: m.angle, intensity: 0.45 });
        }
      } else if (m.state === 'dropping') {
        m.t = clamp01(m.t + (dt * 1000) / m.dur);
        const e = 1 - Math.pow(1 - m.t, 3); // ease-out cubic fall
        m.x = lerp(m.fromX, m.toX, e);
        m.y = lerp(m.fromY, m.toY, e);
        if (m.t >= 1) {
          // seat into the bin
          const bin = m.bin;
          bin.seated.push({ colorKey: m.colorKey, x: m.toX, y: m.toY, slot: m.slot, pop: performance.now() });
          bus.emit(EV.MARBLE_SEAT, { x: m.toX, y: m.toY, color: m.colorKey, pan: (m.toX - L.cx) / L.outerR });
          if (bin.filled >= BIN.slots && !bin.clearing) {
            bin.clearing = true;
            bin.clearAt = performance.now() + BIN.clearHoldMs;
          }
          this.marbles.splice(i, 1);
        }
      }
    }
  }

  // Deterministic light jostle: keep riding marbles from overlapping, clink on
  // a fresh bump. Authoritative positions stay angular — this only spaces them.
  _resolveJostle(omega) {
    const L = this.layout;
    const riders = this.marbles.filter((m) => m.state === 'riding');
    const n = riders.length;
    if (n < 2) { if (n === 1) riders[0].touching = false; return; }
    const minGap = (2 * L.marbleR * MARBLE.packFactor) / L.R;

    riders.sort((a, b) => a.angle - b.angle);
    const bumped = new Set();
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const trail = riders[i];
        const lead = riders[(i + 1) % n];
        let gap = lead.angle - trail.angle;
        if (i === n - 1) gap += TAU; // wrap pair
        if (gap < minGap) {
          const push = (minGap - gap) / 2;
          trail.angle -= push;
          lead.angle += push;
          bumped.add(trail.id);
          bumped.add(lead.id);
        }
      }
    }
    const intensity = 0.25 + Math.min(Math.abs(omega) / DIAL.maxSpeed, 1) * 0.5;
    for (const m of riders) {
      m.angle = norm(m.angle);
      const was = m.touching;
      m.touching = bumped.has(m.id);
      if (m.touching && !was) {
        const x = L.cx + Math.cos(m.angle) * m.rr;
        const y = L.cy + Math.sin(m.angle) * m.rr;
        bus.emit(EV.MARBLE_CLINK, { x, y, angle: m.angle, intensity });
      }
    }
  }

  // A ball slamming a rail (centrifugal pile-up against the outer rim, mostly).
  _railClink(m) {
    const L = this.layout;
    const x = L.cx + Math.cos(m.angle) * m.rr;
    const y = L.cy + Math.sin(m.angle) * m.rr;
    const intensity = 0.3 + Math.min(Math.abs(m.vr) / 200, 0.7);
    bus.emit(EV.MARBLE_CLINK, { x, y, angle: m.angle, intensity });
  }

  // Drop-off: a riding marble aligned with a matching, non-full bin detaches and
  // falls down into it. Only runs once the belt is in steady auto-flow (canSeat).
  _detectDropOff(canSeat) {
    if (!canSeat) return;
    const L = this.layout;
    const cap = BIN.captureArcDeg * DEG;
    for (const m of this.marbles) {
      if (m.state !== 'riding') continue;
      for (let bi = 0; bi < this.bins.length; bi++) {
        const bin = this.bins[bi];
        if (bin.colorKey !== m.colorKey) continue;
        if (bin.clearing || bin.filled >= BIN.slots) continue;
        const bl = L.bins[bi];
        if (Math.abs(wrapPi(m.angle - bl.dropAngle)) > cap) continue;
        // detach -> fall into the next open slot
        const slot = bin.filled;
        bin.filled++;
        const target = this.slotPos(bl, slot, BIN.slots);
        m.state = 'dropping';
        m.fromX = L.cx + Math.cos(m.angle) * m.rr;
        m.fromY = L.cy + Math.sin(m.angle) * m.rr;
        // seed the render position at the detach point THIS frame — otherwise m.x/m.y
        // still hold the stale entry point (frozen during riding) and the ball flashes
        // a one-frame ghost on the far side of the loop before the drop tween starts.
        m.x = m.fromX; m.y = m.fromY;
        m.toX = target.x; m.toY = target.y;
        m.t = 0; m.dur = BIN.dropDurationMs; m.bin = bin; m.slot = slot;
        break;
      }
    }
  }

  _resolveBinClears() {
    const L = this.layout;
    const now = performance.now();
    for (let bi = 0; bi < this.bins.length; bi++) {
      const bin = this.bins[bi];
      if (bin.clearing && now >= bin.clearAt) {
        const bl = L.bins[bi];
        bus.emit(EV.BOX_CLEAR, { x: bl.x, y: bl.y, color: bin.colorKey });
        bin.filled = 0;
        bin.seated = [];
        bin.clearing = false;
      }
    }
  }

  marblesRemaining() {
    let n = this.marbles.length;
    for (const t of this.trays) n += t.stack.length;
    return n;
  }
}
