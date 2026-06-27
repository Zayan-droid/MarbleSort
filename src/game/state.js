// state.js — game state + the AUTHORITATIVE angular-track conveyor model.
//
// Layout: a packet ROW across the top, the round loop below it, and collection
// bins in two VERTICAL COLUMNS flanking the loop left and right. The conveyor is
// NOT emergent physics: every riding candy owns an `angle` on the loop and is
// advanced each frame by the belt's angular speed (base auto-spin + the dial's
// velocity). It is rendered at (center + rr, at its angle), so it visibly travels.
//
//   release  -> ONE candy FALLS from a top packet onto the loop at that packet's
//               entry angle (player-metered: tap = one, hold = a stream)
//   ride     -> angle advances each frame; light deterministic jostle keeps candies
//               from overlapping and emits clinks when they bump
//   drop-off -> when a riding candy's angle reaches a SIDE bin whose color matches
//               and has room, it detaches and falls into that bin (gated on canSeat)
//   clear    -> a full bin bursts and resets
//
// Matter.js is intentionally NOT used for the carry (it tunneled / flung marbles).

import { bus, EV } from '../core/events.js';
import {
  LEVELS, ACTIVE_LEVEL, COLORS, LOOP, MARBLE, BIN, RULES, DIAL, RADIAL, SEAT, HUD, PACKET,
} from '../config.js';
import { TraySlotManager } from './traySlots.js';
import { PacketManager, validatePacketBalance } from './packets.js';

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
    this._time = 0;          // dt-accumulated game clock (ms), for the auto-flow gate
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
    // Collection trays: each physical slot owns its own queue (see traySlots.js). The
    // manager spawns each slot's first tray as its active tray. `this.bins` is the slot
    // array (kept under that name for the layout/renderer/drop-off machinery); a slot's
    // collection state lives on its `activeTray`.
    this.traySlots = new TraySlotManager(def);
    this.bins = this.traySlots.slots;
    // Source PACKETS: finite MIXED-color batches in a queue (see packets.js). Each top slot
    // holds the front packet; tapping it streams its candies onto the loop (see tapPacket /
    // _streamPackets below). validatePacketBalance warns if the level's supply per color
    // doesn't match what the trays can collect.
    validatePacketBalance(def);
    this.packets = new PacketManager(def);
    this.marbles = [];
    this.phase = 'playing';
  }

  // ---- layout: HUD band, packet row, round loop hero, side tray columns -----
  // Marble-Sort-style composition. Works at any size / aspect ratio; element sizes
  // scale with the smaller screen dimension (with px floors). Top to bottom:
  //   1. HUD band (HUD.topInsetFrac of height) reserved at the very top.
  //   2. SOURCE PACKETS in one centered horizontal row directly under the HUD.
  //   3. The ROUND loop, centered, fit as large as clearances allow (the hero).
  //   4. COLLECTION TRAYS in two symmetric vertical columns flanking the loop — ALL
  //      one shared size, evenly spaced, vertically centered on the loop.
  resize(w, h) {
    const s = Math.min(w, h);
    const cx = w / 2;

    const padY = Math.max(s * 0.025, 8);
    const hudH = HUD.topInsetFrac * h;                  // reserved top HUD band
    const sideMargin = Math.max(s * 0.03, 10);

    // ---- TOP PACKET FEEDER: a clean, machine-like GRID of mono-color packet trays ----
    // A centered grid sitting in a light "feeder" panel below the HUD (Marble-Sort style: a
    // few columns, a couple of rows). Tiles are sized so MANY fit without overlap; the row
    // count adapts to aspect (more rows when tall, a single row when wide) and tiles shrink to
    // fit both the available width and a capped vertical budget. Cell CENTERS are filled in
    // after the dial is sized (the candy entry point needs the loop radius); here we only need
    // the panel's height so the loop can be placed below it.
    const nPk = this.packets.slots.length;
    const pkGap = Math.max(PACKET.gapFrac * s, 5);
    const pkPad = Math.max(PACKET.padFrac * s, 5);
    let pkRows = h >= w ? Math.min(PACKET.maxRows, Math.ceil(nPk / PACKET.columns))
      : (w / h > 1.6 ? 1 : 2);
    pkRows = clamp(Math.round(pkRows), 1, Math.max(1, nPk));
    const pkCols = Math.ceil(nPk / pkRows);
    const pkAvailW = w - 2 * sideMargin - 2 * pkPad;
    const pkVBudget = Math.min(h * PACKET.vBudgetFrac, h - hudH - padY * 2);
    let pkTile = Math.min(
      Math.max(PACKET.tileFrac * s, PACKET.minTilePx),
      (pkAvailW - (pkCols - 1) * pkGap) / pkCols,
      (pkVBudget - 2 * pkPad - (pkRows - 1) * pkGap) / pkRows,
      PACKET.maxTilePx,
    );
    pkTile = Math.max(pkTile, 12);                      // hard floor on ultra-small screens
    const pkGridW = pkCols * pkTile + (pkCols - 1) * pkGap;
    const pkGridH = pkRows * pkTile + (pkRows - 1) * pkGap;
    const feederW = pkGridW + 2 * pkPad;
    const feederH = pkGridH + 2 * pkPad;
    const feederX = cx - feederW / 2;
    const feederY = hudH + padY;

    // collection trays: split into left / right columns by each slot's `position`, then
    // ordered top-to-bottom by its vertical rank (top < upper < mid < lower < bottom).
    // Trays are uniform height (mul = 1): a slot is a fixed position, not color-bound, and
    // its tray color changes as its queue advances, so size must not depend on color.
    const RANK = { top: 0, upper: 1, mid: 2, middle: 2, center: 2, lower: 3, bottom: 4 };
    const rankOf = (bi) => {
      const p = (this.bins[bi].position || '').toLowerCase().replace(/^(left|right)/, '');
      return p in RANK ? RANK[p] : bi;
    };
    const leftIdx = [], rightIdx = [];
    this.bins.forEach((slot, i) => {
      const p = (slot.position || '').toLowerCase();
      if (p.startsWith('right')) rightIdx.push(i);
      else if (p.startsWith('left')) leftIdx.push(i);
      else (i % 2 === 0 ? leftIdx : rightIdx).push(i); // fallback: alternate
    });
    leftIdx.sort((a, b) => rankOf(a) - rankOf(b));
    rightIdx.sort((a, b) => rankOf(a) - rankOf(b));
    const maxPerCol = Math.max(leftIdx.length, rightIdx.length, 1);
    const mulOf = () => 1;
    const maxSumMul = maxPerCol;
    const maxMul = 1;
    const binVGap = BIN.colVPadFrac * s;

    // provisional marble radius (the belt-thickness cap is re-applied once `half` is known)
    let marbleR = clamp(Math.max(MARBLE.radiusFrac * s, MARBLE.minRadiusPx), 6, s);
    const gap = Math.max(s * 0.02, marbleR * 0.6);

    // vertical band available to the dial: below the packet feeder, above the bottom margin
    const topLimit = feederY + feederH + gap;           // loop's outer rail must clear the feeder
    const botLimit = h - padY;
    const cy = (topLimit + botLimit) / 2;
    const RoutVert = (botLimit - topLimit) / 2;         // vertical room for the OUTER radius

    // tray column vertical fit: tallest tray height that lets the column stack on screen
    const colTop = hudH + padY, colBot = h - padY;
    const colAvail = colBot - colTop;
    const cwFrac = BIN.columnWidthFrac * maxMul;
    const vFitBinH = (colAvail - (maxPerCol - 1) * binVGap) / maxSumMul;
    let binH = Math.min(Math.max(BIN.heightFrac * s, BIN.minHeightPx), vFitBinH);

    // ---- DIAL (round conveyor) sizing -----------------------------------------------
    // Outer conveyor diameter = LOOP.outerDiamFrac of screen HEIGHT, clamped to the 60–65%
    // band and capped to fit vertically. Then guarantee the horizontal layout: a gap of at
    // least ONE tray width on each side AND at least `minVisible` trays per queue fully on
    // screen. We shrink the trays first and the dial only as a last resort, so the minimum
    // count ALWAYS shows. Per side, the half-width consumed (in units of one tray width) is
    //   gap(1) + active(1) + (N-1) previews each `g`  =>  mult(N) = 2 + (N-1)·g.
    const g = 1 + BIN.queue.gapFrac;                    // tray pitch = colW · g
    const maxVis = Math.max(1, BIN.queue.maxVisible);
    const minVis = Math.max(1, Math.min(BIN.queue.minVisible, maxVis));
    const colWFloor = Math.max(8, BIN.minTrayWidthPx);
    const horiz = w / 2 - sideMargin;
    const multMin = 2 + (minVis - 1) * g;

    let Rout = clamp(LOOP.outerDiamFrac * h / 2, LOOP.outerDiamMin * h / 2, LOOP.outerDiamMax * h / 2);
    Rout = Math.min(Rout, RoutVert);

    let colW = binH * cwFrac;
    const colWcap = (horiz - Rout) / multMin;           // widest tray that still fits minVis here
    if (colW > colWcap) colW = colWcap;                 // shrink trays to fit the minimum count
    if (colW < colWFloor) {                             // floor trays still don't fit -> shrink dial
      colW = colWFloor;
      Rout = horiz - colWFloor * multMin;
      if (Rout < LOOP.minOuterRadiusPx) {               // ultra-narrow: accept sub-floor trays
        Rout = LOOP.minOuterRadiusPx;
        colW = Math.max(4, (horiz - Rout) / multMin);
      }
    }
    Rout = Math.max(20, Rout);
    binH = Math.min(binH, colW / cwFrac);               // keep binH within both fits
    colW = binH * cwFrac;

    // belt geometry from the outer radius and the inner-circle ratio (thick ring)
    const half = (Rout * (1 - LOOP.innerDiamFrac)) / 2; // half the belt thickness
    const R = Rout - half;                              // ride centerline radius (outerR = Rout)
    const trackW = 2 * half;
    marbleR = clamp(Math.max(MARBLE.radiusFrac * s, MARBLE.minRadiusPx), 6, half * 0.8);

    const binColGap = colW;                             // gap dial<->trays = one tray width
    const queueGap = BIN.queue.gapFrac * colW;
    const trayPitch = colW + queueGap;                  // tray center-to-center spacing

    // how many trays actually fit fully on screen for real: >= minVis, up to maxVis
    const roomForTrays = horiz - Rout;
    let fitTrays = minVis;
    for (let N = maxVis; N >= minVis; N--) {
      if (colW * (2 + (N - 1) * g) <= roomForTrays + 0.5) { fitTrays = N; break; }
    }
    fitTrays = Math.max(minVis, Math.min(maxVis, fitTrays));
    const clampDx = R * 0.82;

    // top SOURCE PACKETS: lay the slots into the feeder grid (row-major, each row centered).
    // A slot is a fixed POSITION; its packet changes as the queue advances, so geometry is
    // per-slot, not per-color. Each tile's candy entry point is the loop's TOP arc beneath it.
    const pkGridY0 = feederY + pkPad + pkTile / 2;
    const packets = this.packets.slots.map((_, i) => {
      const row = Math.floor(i / pkCols);
      const col = i % pkCols;
      const inRow = Math.min(pkCols, nPk - row * pkCols);     // items in this (possibly partial) row
      const rowW = inRow * pkTile + (inRow - 1) * pkGap;
      const x = cx - rowW / 2 + pkTile / 2 + col * (pkTile + pkGap);
      const y = pkGridY0 + row * (pkTile + pkGap);
      const dx = clamp(x - cx, -clampDx, clampDx);
      const py = cy - Math.sqrt(Math.max(0, R * R - dx * dx)); // loop's TOP arc
      return { x, y, r: pkTile / 2, entryAngle: Math.atan2(py - cy, dx), entry: { x: cx + dx, y: py } };
    });

    // place each column: trays (each height = binH × its mul) evenly spaced and vertically
    // centered on the loop, centered within the shared-width column. A tray's drop point is
    // the loop point closest to it, so its dropAngle = angle from loop center to the tray.
    const bins = new Array(this.bins.length);
    const placeColumn = (idxs, sideSign) => {
      const n = idxs.length;
      if (!n) return;
      const colX = cx + sideSign * (R + half + binColGap + colW / 2);
      const heights = idxs.map((bi) => binH * mulOf(bi));
      const total = heights.reduce((a, b) => a + b, 0) + (n - 1) * binVGap;
      const top = clamp(cy - total / 2, colTop, Math.max(colTop, colBot - total));
      let yc = top;
      idxs.forEach((bi, k) => {
        const hh = heights[k];
        const by = yc + hh / 2;
        yc += hh + binVGap;
        const dropAngle = Math.atan2(by - cy, colX - cx);
        // QUEUE LINE: the upcoming trays line up FULL-SIZE outward from the active tray,
        // evenly spaced and non-overlapping (a waiting line, not a stacked deck). Only the
        // `fitTrays - 1` that fully fit on screen get geometry; the rest stay hidden until a
        // front tray clears and frees space. Same y + size + alpha as the active tray.
        const previews = [];
        for (let j = 0; j < fitTrays - 1; j++) {
          previews.push({
            x: colX + sideSign * (j + 1) * trayPitch,
            y: by,
            scale: 1,
            alpha: BIN.queue.alpha,
          });
        }
        bins[bi] = {
          x: colX, y: by, w: colW, h: hh, sideSign,
          r: hh * BIN.candyRadiusFrac, slotSpread: hh * BIN.slotSpreadFrac, dropAngle,
          drop: { x: cx + Math.cos(dropAngle) * R, y: cy + Math.sin(dropAngle) * R },
          previews,
        };
      });
    };
    placeColumn(leftIdx, -1);
    placeColumn(rightIdx, +1);

    this.layout = {
      w, h, cx, cy, R, trackW, marbleR,
      innerR: R - half, outerR: R + half,
      packets, bins, hudH,
      feeder: { x: feederX, y: feederY, w: feederW, h: feederH, pad: pkPad, tile: pkTile },
    };

    // keep in-flight candies inside the new channel after a resize
    const rMin = (R - half) + marbleR, rMax = (R + half) - marbleR;
    for (const m of this.marbles) {
      if (typeof m.rr === 'number') m.rr = clamp(m.rr, rMin, rMax);
    }
    return this.layout;
  }

  colorOf(key) { return COLORS[key]; }

  // Screen position of slot `i` within tray layout `bl`. Side trays stack their
  // slots VERTICALLY (top slot fills first) using the layout's precomputed slotSpread.
  slotPos(bl, i, n) {
    const t = n <= 1 ? 0 : (i / (n - 1)) * 2 - 1; // -1..1
    return { x: bl.x, y: bl.y + t * bl.slotSpread };
  }

  beltCount() {
    let n = 0;
    for (const m of this.marbles) if (m.state === 'entering' || m.state === 'riding') n++;
    return n;
  }

  // ---- packet release: TAP a packet -> stream its candies one at a time -------
  // A tap starts the packet releasing; the actual candies are dispensed over time by
  // _streamPackets (one every PACKET.releaseIntervalMs). Tapping a packet that is already
  // releasing (or empty / on a dead slot) is a no-op. Returns true if a release started.
  tapPacket(slotIndex) {
    if (this.phase !== 'playing') return false;
    const slot = this.packets.slots[slotIndex];
    if (!slot || !slot.packet) return false;
    const p = slot.packet;
    if (p.state === 'releasing') return false;     // already streaming — locked
    if (p.releasedCount >= p.count) return false;  // nothing left to release
    p.state = 'releasing';
    p._nextReleaseAt = this._time;                         // first candy fires on the next tick
    return true;
  }

  // Dispense ONE candy from the packet in slot `slotIndex`: it FALLS (entry tween) from the
  // packet down onto the loop's top arc beneath it, then rides. Driven by _streamPackets.
  _spawnCandy(slotIndex, colorKey) {
    const L = this.layout;
    const tl = L.packets[slotIndex];
    const a = norm(tl.entryAngle);
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
      // fall tween from the packet down onto the loop
      fromX: tl.x, fromY: tl.y, toX: ex, toY: ey,
      x: tl.x, y: tl.y, t: 0, dur: MARBLE.entryDurationMs,
      touching: false,
      bin: null, slot: 0,
    });
    // sparkle + pop fire at the packet mouth (just below the box)
    bus.emit(EV.CANDY_RELEASE, { x: tl.x, y: tl.y + tl.r * 0.8, color: colorKey, angle: a });
  }

  // Drain any packets currently releasing: dispense each one's candies in order, one every
  // PACKET.releaseIntervalMs (off the dt-accumulated game clock, so the headless sim streams
  // identically). When a packet has released its last candy it is removed and the next
  // queued packet fills that slot (which arrives idle — the player must tap it).
  _streamPackets() {
    const slots = this.packets.slots;
    for (let i = 0; i < slots.length; i++) {
      const p = slots[i].packet;
      if (!p || p.state !== 'releasing') continue;
      // a mono-color packet dispenses `count` candies of its single color, one per interval
      while (p.releasedCount < p.count && this._time >= p._nextReleaseAt) {
        this._spawnCandy(i, p.color);
        p.releasedCount++;
        p._nextReleaseAt += PACKET.releaseIntervalMs;
      }
      if (p.releasedCount >= p.count) {
        this.packets.refillPacketSlot(slots[i].slotId); // packet emptied -> next packet in
      }
    }
  }

  // ---- main update ----------------------------------------------------------
  update(dt, omega, dragging = false) {
    if (this.phase !== 'playing') return;
    this._lastOmega = omega;
    this._time += dt * 1000;

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
    this._streamPackets();
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
    // Win only when ALL packets are used (queue empty + no candy left in any slot packet,
    // so nothing is still releasing), all tray queues are completed (no trays left
    // anywhere), AND no candy is mid-flight on the belt.
    if (!this.packets.hasRemainingPackets()
        && this.marbles.length === 0
        && !this.traySlots.hasRemainingTrays()) {
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
          // seat into the active tray
          const tray = m.tray;
          tray.seated.push({ colorKey: m.colorKey, x: m.toX, y: m.toY, slot: m.slot, pop: performance.now() });
          bus.emit(EV.MARBLE_SEAT, { x: m.toX, y: m.toY, color: m.colorKey, pan: (m.toX - L.cx) / L.outerR });
          if (tray.filled >= tray.capacity && !tray.clearing) {
            tray.clearing = true;
            tray.clearAt = performance.now() + BIN.clearHoldMs;
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

  // Drop-off: a riding marble aligned with a slot whose ACTIVE tray matches its color
  // (and has room) detaches and falls into it. Preview trays never collect — only the
  // active tray does. Only runs once the belt is in steady auto-flow (canSeat).
  _detectDropOff(canSeat) {
    if (!canSeat) return;
    const L = this.layout;
    const cap = BIN.captureArcDeg * DEG;
    for (const m of this.marbles) {
      if (m.state !== 'riding') continue;
      for (let bi = 0; bi < this.bins.length; bi++) {
        const tray = this.bins[bi].activeTray;
        if (!tray || tray.colorKey !== m.colorKey) continue;
        if (tray.clearing || tray.filled >= tray.capacity) continue;
        const bl = L.bins[bi];
        if (Math.abs(wrapPi(m.angle - bl.dropAngle)) > cap) continue;
        // detach -> fall into the next open slot of the active tray
        const slot = tray.filled;
        tray.filled++;
        const target = this.slotPos(bl, slot, tray.capacity);
        m.state = 'dropping';
        m.fromX = L.cx + Math.cos(m.angle) * m.rr;
        m.fromY = L.cy + Math.sin(m.angle) * m.rr;
        // seed the render position at the detach point THIS frame — otherwise m.x/m.y
        // still hold the stale entry point (frozen during riding) and the ball flashes
        // a one-frame ghost on the far side of the loop before the drop tween starts.
        m.x = m.fromX; m.y = m.fromY;
        m.toX = target.x; m.toY = target.y;
        m.t = 0; m.dur = BIN.dropDurationMs; m.tray = tray; m.slot = slot;
        break;
      }
    }
  }

  // A full active tray, after its hold, pops/clears — then that SLOT's queue shifts
  // forward and its next tray (any color) becomes active. If the queue is empty, the
  // slot goes inactive. The completed tray's color does NOT decide the replacement.
  _resolveBinClears() {
    const L = this.layout;
    const now = performance.now();
    for (let bi = 0; bi < this.bins.length; bi++) {
      const slot = this.bins[bi];
      const tray = slot.activeTray;
      if (tray && tray.clearing && now >= tray.clearAt) {
        const bl = L.bins[bi];
        bus.emit(EV.BOX_CLEAR, { x: bl.x, y: bl.y, color: tray.colorKey });
        this.traySlots.completeActiveTray(slot.slotId);
        // the next tray simply slides forward from its queue slot into the active position
        // (handled by the renderer's per-tray easing) — no separate pop-in.
      }
    }
  }

  marblesRemaining() {
    return this.marbles.length + this.packets.remainingCandies();
  }
}
