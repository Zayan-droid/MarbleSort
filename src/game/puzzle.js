// puzzle.js — PuzzleGame: the tap-driven packet → center → jar-queues puzzle.
//
// This REPLACES the conveyor (state.js, kept dormant) as the active game. There is no belt,
// no dial. Flow:
//   tap a RACK candy -> it tumbles (funnel physics) into the CENTER holding tray and piles
//   AUTO-ROUTE       -> once settled, matching candies flow into an accepting ACTIVE jar; any
//                       color with no active jar WAITS in the center (the only buffer — no tray)
//   tap a JAR        -> manual override of the above (only the lane's front/active jar collects)
//
// Candies are plain objects that LIVE in a container (the center or a jar) and
// carry an optional transient tween `anim`. Logical rules read container membership IMMEDIATELY
// on a tap (a candy belongs to its destination the instant a move is decided); the tween is
// purely cosmetic. All timing runs off the dt-accumulated `_time` (ms) — no performance.now —
// so the headless smoketest can fast-forward.

import { bus, EV } from '../core/events.js';
import {
  LEVELS, ACTIVE_LEVEL, COLORS, CANDY_PHYSICS_DEFAULT, HUD, CENTER, JAR, ANIM, DISPENSER, ART, SCORING, POUR,
} from '../config.js';
import { CenterContainerManager } from './center.js';
import { JarManager } from './jars.js';
import { PacketQueueManager } from './packetQueue.js';
import { validateLevel } from './levelValidator.js';
import { computeDispenserColliders, DispenserPhysics, advanceWobble, hash32, makeRng } from './dispenser.js';

// container.png native aspect (1672×941). The dispenser box is sized by screen fraction
// (DISPENSER.widthFrac/heightFrac), NOT this — the art stretches to fill. Kept for reference.
const DISPENSER_ASPECT = 941 / 1672;

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

export class PuzzleGame {
  constructor() {
    this.phase = 'ready';   // ready | playing | win | lose
    this.layout = null;
    this._time = 0;         // dt-accumulated clock (ms)
    this._nextId = 1;
    this.activity = 0;      // kept for audio.update() compatibility
    this.loadLevel(ACTIVE_LEVEL);
  }

  loadLevel(idx) {
    const def = LEVELS[idx];
    this.levelDef = def;
    validateLevel(def);
    // nullish (??) not || — a level may legitimately set capacity 0 (e.g. a no-tray puzzle).
    this.center = new CenterContainerManager((def.centerContainer && def.centerContainer.capacity) ?? CENTER.capacity);
    this.jars = new JarManager(def);
    this.packets = new PacketQueueManager(def, DISPENSER.rackCols * DISPENSER.rackRows);
    // live rack grid (responsive): resize() picks the best of DISPENSER.rackGrids; these are the
    // pre-resize defaults / fallback. _dispenseBlocked + the rack layout read these live values.
    this._rackCols = DISPENSER.rackCols;
    this._rackRows = DISPENSER.rackRows;
    // dispenser funnel sim: candies spilled from a tapped packet live in `transit` (physics)
    // until they exit the chute into the center; `_releasing` locks input during that fall.
    this.physics = new DispenserPhysics(DISPENSER);
    this.transit = [];
    this._releasing = false;
    this._calmMs = 0;        // how long the spilling pile has been moving below the settle speed
    this._fallMs = 0;        // total time since the current spill began (force-settle fallback)
    this._idleSince = null;  // _time the table last became fully still (gates the auto-route beat)
    this._centerTilt = 0;    // current tray-tip angle (rad), eased toward the active pour direction
    this._combo = 0;         // jar completions in the CURRENT cascade window (drives the feel-layer)
    this._pourLane = null;   // lane currently being fed (the held tilt direction); null = neutral
    this._pourStreak = 0;    // consecutive completions DOWN one lane (the vertical chain)
    this._rowStreak = 0;     // consecutive completions ACROSS the front row, lane→lane (the horizontal chain)
    this._lastClearLane = null; // lane of the previous completion (distinguishes vertical vs horizontal)
    this.rejecting = [];     // candies ROLLING BACK OUT of an over-filled tray (cosmetic; re-queued on arrival)
    this._time = 0;
    this._nextId = 1;
    this.phase = 'playing';
  }

  // ---- layout: HUD · dispenser (top) · center+tray (under the chute) · jar QUEUES (bottom) ----
  resize(w, h) {
    const s = Math.min(w, h);
    const cx = w / 2;
    const padY = Math.max(s * 0.025, 8);
    const hudH = HUD.topInsetFrac * h;
    const sideMargin = Math.max(s * 0.03, 10);
    const gap = Math.max(s * 0.02, 10);
    const topBandTop = hudH + padY;
    const exitFrac = DISPENSER.path.exitY;

    // ---- BOTTOM JAR-QUEUE AREA: ~80% width × ~30% height, centred near the bottom. The 4 queue
    // lanes are laid out inside this box (see _buildJarQueueGeom / _refreshJarSlots). The center
    // container is placed ABOVE this area and the dispenser height is clamped so the chute exit
    // leaves room for the holding tray between the two. ----
    const Q = JAR.queue;
    const jarBottomMargin = Math.max(Q.bottomMarginFrac * h, padY);
    const jarAreaH = Q.areaHFrac * h;
    const jarAreaW = Math.min(Q.areaWFrac * w, w - 2 * sideMargin);
    const jarAreaBottom = h - jarBottomMargin;
    const jarAreaTop = jarAreaBottom - jarAreaH;
    const jarArea = { x: cx, y: (jarAreaTop + jarAreaBottom) / 2, w: jarAreaW, h: jarAreaH };

    // ---- DISPENSER: the central hero, pinned to the top and sized DIRECTLY as a fraction of the
    // screen (DISPENSER.widthFrac × DISPENSER.heightFrac). container.png is drawn to fill the box,
    // so it stretches to these targets; the box-relative colliders stay aligned to the art. The
    // height is clamped so the chute exit leaves room for the holding tray ABOVE the jar area. ----
    const dispTop = topBandTop;
    const minCenterH = Math.max(s * 0.10, 56);          // min vertical kept for the holding tray
    let dispW = DISPENSER.widthFrac * w;
    const maxDispW = w - 2 * sideMargin;
    if (dispW > maxDispW) dispW = maxDispW;
    let dispH = DISPENSER.heightFrac * h;
    const maxDispH = (jarAreaTop - gap - minCenterH - dispTop) / exitFrac;
    if (dispH > maxDispH) dispH = Math.max(60, maxDispH);
    const dispBox = { x: cx - dispW / 2, y: dispTop, w: dispW, h: dispH }; // centered horizontally
    const colliders = computeDispenserColliders(dispBox, DISPENSER);
    this.physics.configure(colliders, dispW);
    const chuteExit = dispTop + exitFrac * dispH;

    // ---- CENTER holding tray under the chute (centered at cx so the chute feeds it) ----
    const centerTop = chuteExit - dispH * 0.02;
    const centerBot = jarAreaTop - gap;
    let centerH = clamp(centerBot - centerTop, 36, CENTER.maxHeightFrac * s);
    let centerW = centerH * CENTER.aspect;
    const maxCenterW = w - 2 * sideMargin;   // the center is the only mid element now; keep it on screen
    if (centerW > maxCenterW) { centerW = Math.max(8, maxCenterW); centerH = Math.min(centerH, centerW / CENTER.aspect); }
    const centerCY = centerTop + centerH / 2;
    const centerBox = { x: cx, y: centerCY, w: centerW, h: centerH };

    // TRAY BASIN (absolute px): the inner walls + floor of the holding tray that the spilled
    // candies tumble into and pile against (CENTER.basin fractions of the center box). The funnel
    // sim (dispenser.js) reads this once the candies fall past the chute exit.
    const bL = centerBox.x - centerW / 2;
    const bT = centerBox.y - centerH / 2;
    this.physics.basin = {
      left: bL + CENTER.basin.left * centerW,
      right: bL + CENTER.basin.right * centerW,
      floor: bT + CENTER.basin.floor * centerH,
    };
    // ITEM 4: the resting-pile wake threshold (a strike must give a settled candy more than this
    // speed to wake it) + how much it yields on contact. Scaled to the tray so it's screen-independent.
    this.physics.pileWake = CENTER.pile.wakeSpeedFracH * centerH;
    this.physics.pilePush = CENTER.pile.push;

    // ---- CANDY RACK: a grid of individual candies SPREADING down the dispenser cavity ----
    // The rack runs from the inner rect's top down to DISPENSER.rackBottomFrac of the box — i.e. it
    // SPREADS into the funnel, not just the rectangular cavity, so the candies fill the dispenser
    // instead of clustering at the top. Rows below the funnel mouth TAPER: each row is positioned and
    // sized to the cavity width at its own height (which narrows toward the chute), so every candy
    // stays inside the visible glass. Front-first / the puzzle are unaffected — only the x/y/r of each
    // slot change.
    const IR = colliders.innerRect;
    const irW = IR.right - IR.left;
    const rackTop = IR.top;
    const rackBot = dispBox.y + DISPENSER.rackBottomFrac * dispBox.h;
    const rackH = rackBot - rackTop;
    const pkPad = DISPENSER.packetPadFrac * Math.min(irW, rackH);
    // RESPONSIVE grid: pick whichever candidate makes the most NEAR-SQUARE cells over the rack region
    // (square cells fill both axes). Tall regions land on 6×6, wide ones on 11×3. Re-grid the rack
    // slots if the cell count changed (preserves the candies still to dispense).
    const grids = DISPENSER.rackGrids || [{ cols: DISPENSER.rackCols, rows: DISPENSER.rackRows }];
    let best = grids[0], bestScore = Infinity;
    for (const g of grids) {
      const cw = (irW - 2 * pkPad) / g.cols, ch = (rackH - 2 * pkPad) / g.rows;
      const score = Math.max(cw / ch, ch / cw); // 1 = perfectly square; lower = squarer = fuller
      if (score < bestScore) { bestScore = score; best = g; }
    }
    this._rackCols = best.cols;
    this._rackRows = best.rows;
    this.packets.relayout(best.cols * best.rows);
    this.packets.centerLastRow(best.cols); // centre a partial last row (e.g. 2 candies in a 6-wide row)
    const pkCols = Math.max(1, this._rackCols);
    const pkRows = Math.max(1, this._rackRows);
    const rowH = (rackH - 2 * pkPad) / pkRows;
    // cavity [left,right] at a given y: full inner-rect width above the funnel mouth, lerping in to
    // the chute walls below it (matches the painted funnel slants from the colliders).
    const cavAt = (y) => {
      if (y <= colliders.funnelTopY) return [IR.left, IR.right];
      const t = Math.min(1, (y - colliders.funnelTopY) / Math.max(1, colliders.funnelBotY - colliders.funnelTopY));
      return [IR.left + (colliders.pathLeft - IR.left) * t, IR.right + (colliders.pathRight - IR.right) * t];
    };
    const packets = this.packets.slots.map((_, i) => {
      const col = i % pkCols, row = Math.floor(i / pkCols);
      const y = rackTop + pkPad + (row + 0.5) * rowH;
      const [cl, cr] = cavAt(y);
      const cw = ((cr - cl) - 2 * pkPad) / pkCols;
      const x = cl + pkPad + (col + 0.5) * cw;
      const r = Math.max(6, (Math.min(cw, rowH) / 2) * DISPENSER.rackCandyFill);
      return { x, y, r };
    });

    // center candy grid metrics
    const cPad = centerW * CENTER.padFrac;
    const cCellW = (centerW - 2 * cPad) / CENTER.cols;
    const cCellH = (centerH - 2 * cPad) / CENTER.rows;
    // Candy radius is a frac of box height; cCellW/cCellH are kept only for the procedural
    // fallback when the tray art hasn't loaded (the live tray seats candies by physics piling).
    const centerR = CENTER.candyRadiusFracH * centerH;
    // Spilled candies should look like NORMAL candies — i.e. the size they'll be once seated
    // in the center — not scale with the (large) dispenser width. Drive the funnel sim off the
    // center candy size so the tumble matches the destination. (configure() set a dispW-based
    // default above; override it here now that the center metrics are known.)
    //   - draw radius = centerR (the renderer then blits it at centerR × ART.candyFill)
    //   - COLLISION radius = the VISUAL radius (centerR × ART.candyFill) so a candy's PAINTED edge
    //     stops at the wall instead of its center — otherwise candies sink ~22% into the walls.
    this._candyDrawR = centerR;
    this.physics.r = centerR * ART.candyFill;

    this.layout = {
      w, h, cx, hudH,
      dispenser: { box: dispBox, colliders, innerRect: colliders.innerRect, exitY: colliders.exitY },
      packets, jars: [],   // filled by _refreshJarSlots with the ACTIVE (front) jar hit-boxes
      jarQueue: this._buildJarQueueGeom(jarArea),
      center: { ...centerBox, pad: cPad, cellW: cCellW, cellH: cCellH, r: centerR },
    };
    this._refreshJarSlots(true, 0);   // assign + SNAP each queue jar's display box; fills layout.jars
    return this.layout;
  }

  // ---- BOTTOM JAR-QUEUE LAYOUT -----------------------------------------------
  // Derive the fixed geometry of the 4 queue lanes inside the bottom area: lane x-centres, the
  // active-jar size (baseW/baseH) and the per-jar gaps. The active (front) jar is full size; the
  // preview jars behind it are scaled by previewScale. Sizing is bounded by BOTH the lane width
  // and the area height so up to maxVisible jars always fit, non-overlapping.
  _buildJarQueueGeom(area) {
    const Q = JAR.queue;
    const laneCount = this.jars.laneCount;
    const laneGap = Q.laneGapFrac * area.w;
    const laneW = (area.w - (laneCount - 1) * laneGap) / Math.max(1, laneCount);
    const vGap = Q.vGapFrac * area.h;
    const maxVisible = Q.maxVisible;
    const ps = Q.previewScale;
    // height budget: active + (maxVisible-1) previews + the gaps between them must fit area.h.
    let baseH = (area.h - (maxVisible - 1) * vGap) / (1 + (maxVisible - 1) * ps);
    baseH = Math.min(baseH, laneW / JAR.aspect);   // and an active jar must fit its lane width
    baseH = Math.max(baseH, 24);
    const baseW = baseH * JAR.aspect;
    const left = area.x - area.w / 2;
    const laneX = [];
    for (let i = 0; i < laneCount; i++) laneX.push(left + i * (laneW + laneGap) + laneW / 2);
    return {
      area, laneCount, laneGap, laneW, vGap, maxVisible, baseH, baseW,
      previewScale: ps, previewAlpha: Q.previewAlpha,
      top: area.y - area.h / 2, laneX,
    };
  }

  // Target box for the jar in visible slot `k` of `laneIndex` (slot 0 = front/active, at the area
  // TOP; higher slots stack DOWNWARD as smaller previews, non-overlapping).
  _jarSlotBox(geom, laneIndex, k) {
    const ps = geom.previewScale;
    const hOf = (i) => (i === 0 ? geom.baseH : geom.baseH * ps);
    let topEdge = geom.top;             // running top edge available for the current slot
    let cy = 0, hh = 0;
    for (let i = 0; i <= k; i++) {
      hh = hOf(i);
      if (i > 0) topEdge = topEdge + geom.vGap;   // gap below the previous slot's bottom
      cy = topEdge + hh / 2;
      topEdge = topEdge + hh;                      // becomes this slot's bottom edge
    }
    return { x: geom.laneX[laneIndex], y: cy, w: (k === 0 ? geom.baseW : geom.baseW * ps), h: hh };
  }

  // Assign each visible jar its display box and (smoothly, unless `snap`) ease toward it — this is
  // what animates a lane shifting FORWARD when its front jar completes + is removed. Also refreshes
  // layout.jars with the active (front) jar hit-boxes for input. Called on resize (snap) + each frame.
  _refreshJarSlots(snap, dt) {
    const geom = this.layout && this.layout.jarQueue;
    if (!geom) return;
    const baseTau = JAR.queue.slideTauMs;
    const sweepMul = this._pourDurMul();   // the held lane shifts forward at the accelerating tempo too
    const active = [];
    for (let lane = 0; lane < geom.laneCount; lane++) {
      const tau = lane === this._pourLane ? baseTau * sweepMul : baseTau;
      const k = snap ? 1 : (tau > 0 ? 1 - Math.exp(-(dt * 1000) / tau) : 1);
      const visible = this.jars.lanes[lane].filter((j) => !j.removed).slice(0, geom.maxVisible);
      visible.forEach((jar, slot) => {
        const b = this._jarSlotBox(geom, lane, slot);
        jar._slot = slot;
        jar._previewAlpha = slot === 0 ? 1 : geom.previewAlpha;
        if (snap || jar._x == null) { jar._x = b.x; jar._y = b.y; jar._w = b.w; jar._h = b.h; }
        else {
          jar._x += (b.x - jar._x) * k;
          jar._y += (b.y - jar._y) * k;
          jar._w += (b.w - jar._w) * k;
          jar._h += (b.h - jar._h) * k;
        }
        if (slot === 0) active.push({ id: jar.id, x: jar._x, y: jar._y, w: jar._w, h: jar._h });
      });
    }
    this.layout.jars = active;
  }

  colorOf(key) { return COLORS[key]; }

  // ---- position helpers (live; derive from current layout, so resize never strands) ----
  // Center candies have NO fixed grooves: each carries its own resting spot as fractions of the
  // box (`restFx`/`restFy`), set by the physics pile-up when they tumble in. Resolve it to live
  // screen px every frame.
  centerRestPos(c) {
    const L = this.layout.center;
    const fx = c.restFx != null ? c.restFx : 0.5;
    const fy = c.restFy != null ? c.restFy : CENTER.basin.floor - 0.5 * (this._candyDrawR / Math.max(1, L.h));
    return { x: L.x + (fx - 0.5) * L.w, y: L.y + (fy - 0.5) * L.h };
  }

  // Live (smoothed) display box of a jar, set by _refreshJarSlots from its lane + visible slot.
  _jarBox(jar) { return { x: jar._x || 0, y: jar._y || 0, w: jar._w || 0, h: jar._h || 0 }; }

  // The candy grid sits inside the jar art's clear glass bowl (JAR.glass), not the whole
  // box — so candies land in the bowl rather than over the rim/base of the open-jar art.
  _jarGlass(jar) {
    const bl = this._jarBox(jar);
    const G = JAR.glass;
    // use no more columns than there are candies, so a small jar's candies rest CENTERED at the
    // bottom (a 2-candy jar packs 2 across the middle, not 2 of 3 cells off to one side).
    const cols = Math.max(1, Math.min(JAR.cols, jar.capacity));
    const rows = Math.ceil(jar.capacity / cols);
    const gw = G.w * bl.w, gh = G.h * bl.h;
    const cx = bl.x + (G.cx - 0.5) * bl.w;
    const cy = bl.y + (G.cy - 0.5) * bl.h;
    return { cx, cy, gw, gh, cols, rows, cellW: gw / cols, cellH: gh / rows };
  }

  jarSlotPos(jar, slot) {
    const g = this._jarGlass(jar);
    const col = slot % g.cols;
    const rowFromBottom = Math.floor(slot / g.cols);
    return {
      x: g.cx - g.gw / 2 + g.cellW * (col + 0.5),
      y: (g.cy + g.gh / 2) - g.cellH * (rowFromBottom + 0.5),
    };
  }

  jarCandyR(jar) {
    const g = this._jarGlass(jar);
    return Math.min(g.cellW, g.cellH) * JAR.candyCellFill;
  }

  _restPos(c) {
    if (c.where === 'center') return this.centerRestPos(c);
    if (c.where === 'jar') return this.jarSlotPos(c.jar, c.slot);
    return { x: 0, y: 0 };
  }

  candyRadius(c) {
    if (c.where === 'jar') {
      const jr = this.jarCandyR(c.jar);
      // during a POUR, ease the radius from the tray-candy size to the jar-candy size so it doesn't
      // pop the instant it leaves the tray.
      if (c.anim && c.anim.kind === 'pour') {
        const p = clamp((this._time - c.anim.startTime) / c.anim.dur, 0, 1);
        const cr = this.layout.center.r;
        return cr + (jr - cr) * p;
      }
      return jr;
    }
    return this.layout.center.r;
  }

  // Live screen position of a candy (eased along its anim, or its rest slot when idle).
  candyScreenPos(c) {
    if (!this.layout) return { x: 0, y: 0 };
    const tgt = this._restPos(c);
    const a = c.anim;
    if (!a) return tgt;
    const p = (this._time - a.startTime) / a.dur;
    if (p <= 0) return { x: a.fromX, y: a.fromY };
    if (p >= 1) return tgt;
    // POUR: a quadratic Bézier over the tray lip (control point) then down into the jar, with an
    // ease-in-out parameter so the candy lingers at the rim then drops — reads as a pour, not a glide.
    if (a.kind === 'pour' && a.ctrlX != null) {
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const u = 1 - e;
      return {
        x: u * u * a.fromX + 2 * u * e * a.ctrlX + e * e * tgt.x,
        y: u * u * a.fromY + 2 * u * e * a.ctrlY + e * e * tgt.y,
      };
    }
    const e = 1 - Math.pow(1 - p, 3); // ease-out cubic
    return { x: a.fromX + (tgt.x - a.fromX) * e, y: a.fromY + (tgt.y - a.fromY) * e };
  }

  // Settle-pop scale right after a candy lands (for renderer juice).
  candyPop(c) {
    const t = c._landAt != null ? this._time - c._landAt : 1e9;
    if (t < 0 || t > 220) return 1;
    return 1 + ANIM.bounce * Math.sin((t / 220) * Math.PI);
  }

  _capture(list) {
    const m = new Map();
    for (const c of list) m.set(c, this.candyScreenPos(c));
    return m;
  }

  _allCandies() {
    const out = [...this.center.candies];
    for (const jar of this.jars.jars) out.push(...jar.candies);
    return out;
  }

  _centerSettled() { return this.center.candies.every((c) => !c.anim); }
  _allSettled() { return this._allCandies().every((c) => !c.anim); }

  // DISPENSER-STACK RULE: a candy can only be dispensed once the candy directly IN FRONT of it
  // (the next one toward the chute — one row DOWN in its column) has already been removed. So each
  // column empties front-first (bottom row up). True ⇒ this candy is still blocked by the one ahead.
  _dispenseBlocked(i) {
    const front = i + (this._rackCols || DISPENSER.rackCols); // the cell one row toward the chute, same column
    const slots = this.packets.slots;
    return front < slots.length && !!(slots[front] && slots[front].color);
  }

  // Rack slots the player may tap right now: a candy is present AND nothing is in front of it.
  tappableSlots() {
    return this.packets.slots
      .map((s, i) => i)
      .filter((i) => this.packets.slots[i].color && !this._dispenseBlocked(i));
  }

  // ---- INTENTS ---------------------------------------------------------------
  // Tap a candy in the rack: ONE tap drops ONE candy. It spills out as a physics object at the
  // tapped cell, tumbles down the dispenser funnel, and PILES in the tray basin; once everything
  // settles, _depositTray hands the pile to the center container. The player may tap several in a
  // row (they rain down together) — but only while the tray pipeline (candies falling + already in
  // the center) stays within the center's capacity, so the holding tray never overflows. A candy
  // can only be taken once the one IN FRONT of it (toward the chute) is gone (_dispenseBlocked).
  onPacketTapped(i) {
    if (this.phase !== 'playing' || !this.layout) return false;
    // A candy still TUMBLING down the funnel isn't in the tray yet, so the cap is raised by the
    // overfill margin: you can drop into a brief jumble instead of being hard-blocked at capacity.
    // Only the hard ceiling (capacity + margin in flight) refuses a tap — with a feedback cue.
    const ceil = this.center.capacity + (CENTER.overfill.enabled ? CENTER.overfill.margin : 0);
    if (this.transit.length + this.center.count() >= ceil) {
      const t = this.layout.packets[i];
      if (t) bus.emit(EV.MOVE_INVALID, { x: t.x, y: t.y });
      return false;
    }
    const slot = this.packets.slots[i];
    if (!slot || !slot.color) return false;
    if (this._dispenseBlocked(i)) { // blocked by the candy in front — reject with a cue
      const t = this.layout.packets[i];
      bus.emit(EV.MOVE_INVALID, { x: t.x, y: t.y });
      return false;
    }
    const dropped = this.packets.consume(i);
    if (!dropped) return false;
    // Bring any candies ALREADY resting in the tray back into the physics sim, so the newly dropped
    // candy actually COLLIDES with them (piles on top / nudges them) per each candy's material —
    // instead of falling through and sitting on the floor in front of the pile. They re-settle and
    // re-deposit together. (No-op on a fresh tap with an empty tray, and while raining several down
    // the tray is empty until the batch deposits, so this only fires for a drop onto a settled pile.)
    // ITEM 4: with the soft pile ON we DON'T revive the whole pile — the dropped candy lands on the
    // settled candies as colliders and ripples only the ones it strikes (see update()/_wakePile).
    if (!CENTER.pile.enabled) this._reflowCenterIntoTransit();
    this._calmMs = 0; this._fallMs = 0;
    const tile = this.layout.packets[i];
    const drawR = this._candyDrawR ?? this.physics.r; // DRAW radius (renderer); physics uses cr below
    const baseCr = this.physics.r;                    // global collision radius (draw × candyFill)
    const burst = this.physics.burst;
    const col = dropped.color;
    const special = dropped.special;   // multiplier candy — travels with this candy to its jar
    const ph = (COLORS[col] && COLORS[col].physics) || CANDY_PHYSICS_DEFAULT;
    const dir = this.physics.colliders.cx - tile.x > 0 ? 1 : -1;
    const id = this._nextId++;
    // ITEM 1 — DETERMINISTIC per-candy variety. Seed a tiny PRNG from the FIXED game seed XOR this
    // candy's id, so every candy launches + tumbles a little differently yet 100% reproducibly (no
    // Math.random anywhere in the sim → the headless smoketest still repeats). Purely cosmetic: it
    // only perturbs the spawn point, launch vector, spin and per-candy material — never any logic.
    const V = DISPENSER.variety || {};
    const on = V.enabled !== false;
    const rng = makeRng(hash32(((V.seed || 0) >>> 0) ^ Math.imul(id, 0x9e3779b1)));
    const jit = (amt) => (on ? (rng() * 2 - 1) * (amt || 0) : 0);   // symmetric ± amt (0 if disabled)
    // base launch: a gentle nudge toward the chute centre + downward, then jitter its angle + speed
    const bvx = dir * burst * 0.12, bvy = burst * 0.25;
    const ang = Math.atan2(bvy, bvx) + jit(V.angleJitterRad);
    const spd = Math.hypot(bvx, bvy) * (1 + jit(V.speedJitter));
    const posJ = (V.posJitterFrac || 0) * drawR;
    // ITEM 3 — coarse SHAPE footprint + settle profile (deterministic per colour; shape is fixed).
    const SH = DISPENSER.shape;
    const prof = (SH && SH.enabled && SH.profiles[(COLORS[col] && COLORS[col].shape)]) || null;
    const cr = baseCr * (1 + jit(V.radiusJitter));
    const c = {
      id, colorKey: col, r: drawR, special,
      // per-candy COLLISION radius (item 1 radius jitter) — the sim collides at this; draw stays uniform
      cr,
      // coarse ellipse half-extents + settle profile from the candy's silhouette (item 3)
      rx: cr * (prof ? prof.wx : 1), ry: cr * (prof ? prof.hy : 1),
      shape: (COLORS[col] && COLORS[col].shape) || 'round',
      settle: prof ? prof.settle : 'roll', restBase: prof ? prof.base : 0,
      // each candy carries its REAL material so the funnel sim treats it accordingly: restitution
      // (bounce), friction (slide/grip), mass (collision momentum + air drag), roll (does it spin),
      // and the soft-body fields (jiggle/wobble/bump/airDrag) for jelly wobble + cake squash — each
      // nudged a touch per-candy so a pile of one colour still looks organic.
      e: clamp(ph.restitution + jit(V.restJitter), 0.05, 0.95),
      fr: ph.friction,
      mass: ph.mass * (1 + jit(V.massJitter)),
      roll: ph.roll, material: ph.material,
      jiggle: ph.jiggle || 0, wobbleFreq: ph.wobbleFreq || 0, wobbleDamp: ph.wobbleDamp || 0,
      // give EVERY candy a little surface unevenness (added to the material's own bump) so its path
      // through the funnel + pegs scatters instead of tracing the same line each time.
      bump: (ph.bump || 0) + (on ? (V.bumpBase || 0) + Math.abs(jit(V.bumpJitter)) : 0),
      airDrag: ph.airDrag || 1, squashMax: ph.squashMax,
      wAmp: 0, wPhase: 0, wAng: 0,
      angle: 0,
      spin: (ph.roll ? dir * 5 : 0) + jit(V.spinJitter),
      // spawn near the tapped cell (jittered within it); gravity + the funnel slants + the PEGS
      // carry it down into the tray.
      x: tile.x + jit(posJ),
      y: tile.y + jit(posJ * 0.5),
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      bornAt: this._time,
    };
    this.transit.push(c);
    bus.emit(EV.CANDY_RELEASE, { x: c.x, y: c.y, color: col, angle: 0 });
    this._releasing = true;
    return true;
  }

  // ITEM 4: a dropped candy struck one or more settled candies hard enough to WAKE them. Pull just
  // those out of the center back into the transit sim (keeping their current velocity) so they
  // re-settle with the new candy — the rest of the pile is untouched (no whole-pile twitch). The
  // center count is unchanged in total (they move center → transit and re-deposit on settle).
  _wakePile() {
    const all = this.center.takeAll();
    const keep = all.filter((c) => !c._wake);
    this.center.add(keep);
    for (const c of all) {
      if (!c._wake) continue;
      c._wake = false; c.where = 'transit'; c.anim = null; c._started = false;
      c.bornAt = this._time; c.spin = c.spin || 0;
      this.transit.push(c);
    }
    this._calmMs = 0; this._fallMs = 0;   // pile disturbed → let it re-settle before depositing
  }

  // True once every spilling candy is in the tray basin and (nearly) at rest, so the whole batch
  // can be handed to the center. A hard `maxMs` fallback force-settles so the loop never hangs.
  _traySettled() {
    if (!this.transit.length) return false;
    if (this._fallMs >= CENTER.settle.maxMs) return true;
    const L = this.layout.center;
    const floor = this.physics.basin ? this.physics.basin.floor : Infinity;
    const speed = CENTER.settle.speedFracH * L.h;          // px/s threshold
    const calm = this.transit.every((c) => (c.vx * c.vx + c.vy * c.vy) < speed * speed
      && c.y > this.layout.dispenser.exitY && c.y <= floor + 1);
    return calm && this._calmMs >= CENTER.settle.holdMs;
  }

  // Pull every candy currently RESTING in the center back into the transit physics sim (at its live
  // screen position, velocity 0) so a freshly dropped candy collides + piles on it via the normal
  // funnel-sim candy/candy physics, then the whole pile re-settles and re-deposits. Removing them
  // from the center container (takeAll) means they're not double-counted or double-drawn while in
  // flight; _depositTray re-adds them. Safe to call on every tap — a no-op when the tray is empty.
  _reflowCenterIntoTransit() {
    if (this.center.isEmpty()) return;
    const taken = this.center.takeAll();
    for (const c of taken) {
      const p = this.centerRestPos(c);
      c.x = p.x; c.y = p.y;
      c.vx = 0; c.vy = 0; c.spin = 0; c._contact = false;
      c.r = this._candyDrawR ?? c.r;     // refresh draw radius (it may have changed on a resize)
      c.where = 'transit'; c.jar = null; c.anim = null;
      c.bornAt = this._time;
      this.transit.push(c);
    }
  }

  // The resting orientation for a settled candy (item 3): snap a cube to its nearest flat face and a
  // bean/pill onto its long axis so the pile reads as candies LYING naturally; a roller keeps the
  // angle it tumbled to. (The dynamic wobble/rock already played during the fall.)
  _restAngleFor(c) {
    const S = DISPENSER.shape;
    if (!S || !S.enabled || !c.settle || c.settle === 'roll') return c.angle || 0;
    const half = Math.PI / 2, base = c.restBase || 0;
    const step = c.settle === 'flat' ? Math.PI : half;
    return Math.round(((c.angle || 0) - base) / step) * step + base;
  }

  // The spilled candies have settled in the tray -> hand the whole pile to the center container,
  // each frozen at its physics resting spot (recorded as fractions of the box, so a later resize
  // keeps the pile in place). No tween: they're already exactly where they came to rest.
  _depositTray() {
    const L = this.layout.center;
    const B = this.physics.basin, r = this.physics.r;
    const settled = this.transit.slice();
    this.transit.length = 0;
    this.center.add(settled); // assigns logical slots (used only for counting now)
    for (const c of settled) {
      // safety: a stray force-settled while still in the dispenser (hang-guard) is dropped onto
      // the floor so no candy is ever frozen above the tray.
      if (B) {
        const rx = c.rx || r, ry = c.ry || r;   // shape-aware footprint (item 3)
        c.x = clamp(c.x, B.left + rx, B.right - rx);
        if (c.y < this.layout.dispenser.exitY) c.y = B.floor - ry;
        else c.y = Math.min(c.y, B.floor - ry);
      }
      c.where = 'center'; c.jar = null; c._started = false; c.anim = null;
      c._landAt = this._time;
      c.restFx = (c.x - L.x) / L.w + 0.5;
      c.restFy = (c.y - L.y) / L.h + 0.5;
      c.restAngle = this._restAngleFor(c);   // snap to the shape's stable rest orientation (item 3)
      c.spin = 0;
      const pan = clamp((c.x - this.layout.cx) / (this.layout.w / 2), -1, 1);
      // landing sound matches the material: a hard candy clacks bright, a soft slab lands dull.
      const inten = c.material === 'hard' ? 0.6 : c.material === 'soft' ? 0.28 : 0.42;
      bus.emit(EV.MARBLE_CLINK, { x: c.x, y: c.y, angle: pan, intensity: inten });
    }
    this._releasing = false;
  }

  // Send matching candies from the center into a jar (up to the jar's room).
  onJarTapped(jarId) {
    if (this.phase !== 'playing' || !this.layout) return false;
    if (this._releasing || this.transit.length) return false; // wait for the spill to land
    if (!this._centerSettled()) return false;
    const jar = this.jars.jarById(jarId);
    if (!jar) return false;
    if (!this.jars.isActive(jar)) { // a preview jar is read-only — only the front jar collects
      const bl = this._jarBox(jar);
      bus.emit(EV.MOVE_INVALID, { x: bl.x, y: bl.y });
      return false;
    }
    if (this.center.isEmpty()) return false;
    const color = jar.colorKey;
    const room = this.jars.roomIn(jar);
    if (room <= 0 || !this.center.colorsPresent().includes(color)) {
      const bl = this._jarBox(jar);
      bus.emit(EV.MOVE_INVALID, { x: bl.x, y: bl.y });
      return false;
    }
    const prev = this._capture(this.center.candies);
    const moving = this.center.removeMatching(color, room);
    const remaining = this.center.candies.slice();
    const st = this._time;
    // a manual pour aims the tilt the same way auto-route does, so it joins the directional sweep.
    if (jar.lane !== this._pourLane) {
      this._pourLane = jar.lane;
      if (POUR.perLaneReset) this._pourStreak = 0;
    }
    const mul = this._pourDurMul();
    jar._durMul = mul;
    this._pourCandies(jar, moving, prev, st, mul);
    this._reflow(remaining, prev, st, mul);
    return true;
  }

  // ---- AUTO-ROUTE (single-tap mode) ------------------------------------------
  // The player only ever TAPS A PACKET. Once a candy has spilled into the center and SETTLED, its
  // destination is decided automatically: matching candies flow into any accepting ACTIVE jar
  // (greedily, across same-color front jars). Any candy whose color no active jar will take simply
  // WAITS in the holding tray until a lane advances and a jar of its color becomes active (the
  // center is the only buffer — there is no storage tray). This mirrors the manual onJarTapped move
  // (same tweens + events). Guarded on a fully-settled, idle table so a routing pass never fires
  // mid-tween or fights an in-progress spill; each pass that moves something returns and lets it
  // settle before the next pass.
  _autoRoute() {
    if (this.phase !== 'playing' || !this.layout) return;
    if (this._releasing || this.transit.length) return;
    if (!this._allSettled()) return;
    if (this.center.isEmpty()) return;
    // The FIRST route of a freshly-settled candy fires (near) immediately — as soon as it's in the
    // tray with a matching active jar, it flows in with no artificial wait. Only once a sweep is
    // RUNNING (_pourLane set) do successive pours hold the cascade beat (shrunk by the sweep tempo),
    // so the chain stays readable without the first move feeling sluggish.
    const beat = this._pourLane != null ? ANIM.autoRouteDelayMs * this._pourDurMul() : ANIM.firstRouteDelayMs;
    if (this._idleSince == null || this._time - this._idleSince < beat) return;

    const st = this._time;
    // DIRECTIONAL SWEEP: PREFER the lane we're already pouring into — follow one queue to exhaustion
    // (keep filling its front jar as the lane advances) before considering other lanes, so the tray
    // holds its tilt and pours down a single queue. Only the ORDER of fills changes; the loop still
    // routes whatever is satisfiable, so every jar that was fillable is still filled (winnability,
    // stuck-detection and final state unchanged). One jar per pass keeps the settle-stagger intact.
    const active = this.jars.activeJars();
    const held = this._pourLane != null ? active.find((j) => j.lane === this._pourLane) : null;
    const ordered = held ? [held, ...active.filter((j) => j !== held)] : active;
    for (const jar of ordered) {
      const room = this.jars.roomIn(jar);
      if (room <= 0 || !this.center.colorsPresent().includes(jar.colorKey)) continue;
      const prev = this._capture(this.center.candies);
      const moving = this.center.removeMatching(jar.colorKey, room);
      if (!moving.length) continue;
      const remaining = this.center.candies.slice();
      // a new pour lane re-aims the tilt and (with POUR.perLaneReset) resets the sweep tempo.
      if (jar.lane !== this._pourLane) {
        this._pourLane = jar.lane;
        if (POUR.perLaneReset) this._pourStreak = 0;
      }
      const mul = this._pourDurMul();   // tempo for THIS jar's whole cycle (route + fill + close)
      jar._durMul = mul;                // the close animation (logic + renderer) reuses it
      this._pourCandies(jar, moving, prev, st, mul);
      this._reflow(remaining, prev, st, mul);
      return; // pour one jar at a time
    }
  }

  // Held-sweep tempo: each consecutive completion in the cascade shrinks the route/fill/close/lane-
  // shift tween durations, FLOORED at minMul so a long sweep never becomes an unreadable blur. Driven
  // by the CASCADE count (`_combo`) so it accelerates whether the sweep runs DOWN a lane (vertical
  // chain) or ACROSS the front row (horizontal chain) — both feed _combo.
  _pourDurMul() {
    return Math.max(POUR.speedup.minMul, Math.pow(POUR.speedup.factorPerLink, this._combo));
  }

  // ---- combo window helpers (feel-layer only — no gameplay effect) ----
  // A jar is mid-close (lid dropping/sealing/fading): its lane is shifting forward and another pour
  // may follow once it's removed, so the cascade is NOT over.
  _anyClosing() { return this.jars.jars.some((j) => j.complete && !j.removed); }
  // Would _autoRoute pour anything right now? (Center holds a color some ACTIVE jar still has room
  // for.) Mirrors the inner test of _autoRoute, minus the idle-beat gate.
  _autoRoutePending() {
    if (this.center.isEmpty()) return false;
    const present = this.center.colorsPresent();
    return this.jars.activeJars().some((j) => this.jars.roomIn(j) > 0 && present.includes(j.colorKey));
  }

  // Give center candies that shifted slot a short slide so the grid re-packs smoothly.
  _reflow(list, prev, st, mul = 1) {
    for (const c of list) {
      const from = prev.get(c);
      const tgt = this.centerRestPos(c);
      if (from && (Math.abs(from.x - tgt.x) > 0.5 || Math.abs(from.y - tgt.y) > 0.5)) {
        c.anim = { fromX: from.x, fromY: from.y, startTime: st, dur: ANIM.moveDurMs * 0.7 * mul, kind: 'reflow' };
      }
    }
  }

  // ---- POUR: tray TIPS toward a jar and the matching candies roll over its lip + arc in ----
  // Set up the pour anim for each candy moving from the tray into `jar`: a lip-then-drop Bézier
  // (resolved live in candyScreenPos), staggered so they leave one-by-one, with a ROLLER tumbling
  // as it pours. The tray-tip itself is eased by _updatePourTilt, which reads these in-flight anims.
  // Logic is identical to the old straight tween (candy belongs to the jar immediately, seats on
  // arrival) — only the PATH + tilt are new — so the headless smoketest is unaffected.
  // `mul` (1 by default) is the held-sweep tempo multiplier — successive same-lane pours shorten the
  // route + arc so each jar fills quicker than the last (floored in _pourDurMul so it never blurs).
  _pourCandies(jar, moving, prev, st, mul = 1) {
    const L = this.layout.center;
    const P = ANIM.pour;
    const dur = P.durMs * mul;
    const stagger = P.staggerMs * mul;
    const jb = this._jarBox(jar);
    const dir = jb.x >= L.x ? 1 : -1;              // tip + arc toward the jar's side
    const lipOut = dir * P.lipOutFrac * L.w;
    const lift = P.lipLiftFrac * L.h;
    moving.forEach((c, k) => {
      c.where = 'jar'; c.jar = jar;
      this.jars.add(jar, c);                       // assigns the jar slot (used by jarSlotPos)
      const from = prev.get(c);
      const tgt = this.jarSlotPos(jar, c.slot);
      // control point: out past the tray lip toward the jar, lifted above the higher endpoint so
      // the candy clears the rim before dropping into the jar.
      c.anim = {
        fromX: from.x, fromY: from.y,
        ctrlX: from.x + (tgt.x - from.x) * 0.5 + lipOut,
        ctrlY: Math.min(from.y, tgt.y) - lift,
        startTime: st + k * stagger, dur, kind: 'pour',
      };
      // rad/s so a roller completes ~spinTurns over the pour; gummies/jelly (roll=false) don't spin.
      c._pourSpin = c.roll ? dir * (P.spinTurns * 2 * Math.PI) / (dur / 1000) : 0;
    });
  }

  // Each frame: tumble the candies mid-pour, and ease the tray tip toward the lane we're POURING INTO.
  // The tilt target is the HELD pour lane (`_pourLane`), not the transient in-flight pour — so it
  // persists across the close-animation gap between same-lane jars (the sweep holds the tilt) and only
  // eases back to level when the sweep releases (lane exhausts / cascade drains → `_pourLane` null).
  // Purely cosmetic (no logic / no events), so the headless sim can ignore it entirely.
  _updatePourTilt(dt) {
    if (!this.layout) return;
    // keep tumbling the candies that are mid-pour (cosmetic spin)
    for (const c of this._allCandies()) {
      const a = c.anim;
      if (a && a.kind === 'pour' && this._time >= a.startTime && c._pourSpin) {
        c.restAngle = (c.restAngle || 0) + c._pourSpin * dt;
      }
    }
    // held directional target: aim at the current pour lane's front jar (x relative to the tray center)
    let target = 0, aiming = false;
    if (this._pourLane != null) {
      const front = this.jars.frontJar(this._pourLane);
      if (front) {
        const sign = this._jarBox(front).x >= this.layout.center.x ? 1 : -1;
        target = sign * (POUR.angleDeg * Math.PI) / 180;
        aiming = true;
      }
    }
    // ease faster toward an active target, slower back to level (a gentle relax)
    const tau = aiming ? POUR.easeTauMs : POUR.neutralReturnTauMs;
    const k = tau > 0 ? 1 - Math.exp(-(dt * 1000) / tau) : 1;
    this._centerTilt = (this._centerTilt || 0) + (target - (this._centerTilt || 0)) * k;
  }

  // Tray-tip transform for the renderer: angle (rad) + pivot (near the tray's base) about which to
  // rotate the tray art and the candies still resting in it.
  centerTiltInfo() {
    const L = this.layout && this.layout.center;
    if (!L) return { angle: 0, x: 0, y: 0 };
    return { angle: this._centerTilt || 0, x: L.x, y: L.y + (CENTER.tilt.pivotYFrac - 0.5) * L.h };
  }

  // Drain the funnel sim's recorded PEG strikes (item 2) into EV.PEG_HIT. The sim stays pure (no event
  // bus / no Math.random), just RECORDING each pin hit; here we translate it into the normalized
  // { speed01, pan } the audio (pentatonic music-box tick), haptic and spark layers ride. The hits are
  // already gated above a speed floor in the sim, so silent grazes never reach here.
  _emitPegHits() {
    if (!this.layout) return;
    const ref = (DISPENSER.pegs && DISPENSER.pegs.speedRef) || 900;
    const halfW = (this.layout.w || 2) / 2;
    for (const hit of this.physics.pegHits) {
      const speed01 = clamp(hit.speed / ref, 0, 1);
      const pan = clamp((hit.x - this.layout.cx) / halfW, -1, 1);
      bus.emit(EV.PEG_HIT, { x: hit.x, y: hit.y, note01: hit.note01, speed01, pan, color: hit.colorKey, pegIndex: hit.pegIndex });
    }
  }

  // OVERFILL ROLLBACK: after a drop has jumbled in and auto-route has taken everything that logically
  // FITS, any candy still over capacity rolls BACK OUT to the rack (a satisfying reject, not a hard
  // pre-block). Only fires on a settled, fully-drained table (so auto-route got first pick); it pulls
  // the TOP candies off the pile and they re-queue to the dispenser supply when they finish rolling out.
  _resolveOverfill() {
    if (!CENTER.overfill.enabled) return;
    if (!this._idle() || this._anyClosing() || this._autoRoutePending()) return;
    const excess = this.center.count() - this.center.capacity;
    if (excess <= 0) return;
    // eject the topmost candies (smallest y = highest in the pile)
    const byTop = this.center.candies.slice().sort((a, b) => this.centerRestPos(a).y - this.centerRestPos(b).y);
    const ejectSet = new Set(byTop.slice(0, excess));
    const keep = this.center.takeAll().filter((c) => !ejectSet.has(c));
    this.center.add(keep);
    for (const c of ejectSet) {
      const p = this.centerRestPos(c);
      c.where = 'reject'; c.anim = null;
      c._rejX = p.x; c._rejY = p.y; c._rejT0 = this._time;
      this.rejecting.push(c);
    }
    const L = this.layout.center;
    bus.emit(EV.MOVE_INVALID, { x: L.x, y: L.y - L.h * 0.2 });   // reject cue (warning + haptic)
  }

  // Advance the roll-back-out animation; when a candy finishes, RETURN its color to the rack supply
  // (so the level stays winnable) and drop it from the list. Cosmetic timing off the _time clock.
  _advanceRejecting(dt) {
    if (!this.rejecting.length) return;
    const dur = CENTER.overfill.fadeMs;
    for (let i = this.rejecting.length - 1; i >= 0; i--) {
      const c = this.rejecting[i];
      if (this._time - c._rejT0 >= dur) {
        this.packets.returnCandy(c.colorKey, c.special);
        c.where = null;
        this.rejecting.splice(i, 1);
      }
    }
  }

  // ---- main update -----------------------------------------------------------
  update(dt) {
    if (this.phase !== 'playing') return;
    this._time += dt * 1000;
    // dispenser funnel physics: step the spilling candies down the funnel and let them PILE in
    // the tray basin; once the whole pile has settled, hand it to the center container.
    if (this.transit.length) {
      // ITEM 4: pass the settled pile as colliders (refreshed to their rest spots) so a dropped candy
      // lands on it; afterwards, move any struck-awake neighbours back into transit to re-settle.
      let resting = null;
      if (CENTER.pile.enabled) {
        resting = this.center.candies.filter((c) => !c.anim);
        for (const c of resting) { const p = this.centerRestPos(c); c.x = p.x; c.y = p.y; }
      }
      this.physics.step(this.transit, dt, this._time, resting);
      if (resting && this.center.candies.some((c) => c._wake)) this._wakePile();
      if (this.physics.pegHits.length) this._emitPegHits();   // item 2: tick off the funnel pins
      const ms = dt * 1000;
      this._fallMs += ms;
      const sp = CENTER.settle.speedFracH * this.layout.center.h;
      const slow = this.transit.every((c) => (c.vx * c.vx + c.vy * c.vy) < sp * sp);
      this._calmMs = slow ? this._calmMs + ms : 0;
      if (this._traySettled()) this._depositTray();
    }
    if (this._releasing && this.transit.length === 0) this._releasing = false;
    this._processAnims();
    // settled center candies keep finishing their landing jiggle / cake squash after deposit
    for (const c of this.center.candies) if (c.wAmp) advanceWobble(c, dt);
    this._updatePourTilt(dt);   // tumble pouring candies + ease the tray tip toward the active pour
    this._advanceRejecting(dt); // candies rolling BACK OUT of an over-filled tray (item: overfill)
    this._resolveJarCompletions();
    this._autoRoute();
    this._resolveOverfill();    // auto-route took what FITS; anything still over capacity rolls back out
    this._checkEnd();
    this._refreshJarSlots(false, dt);   // ease jars toward their slots (lane shift-forward animation)
    // gentle ambient activity: rises while candies are in motion
    const moving = this.transit.length > 0 || this.rejecting.length > 0 || this._allCandies().some((c) => c.anim);
    // track when the table last went fully still — the auto-route beat measures from here, so the
    // player SEES the candies tumble in and rest for a moment before they flow onward.
    if (moving || this._releasing) this._idleSince = null;
    else if (this._idleSince == null) this._idleSince = this._time;
    this.activity += ((moving ? 0.6 : 0.08) - this.activity) * Math.min(dt * 3, 1);
    // Close the combo window only when the cascade has TRULY drained — the cascade passes through
    // idle BETWEEN pours, so we must NOT reset on the bare busy->idle transition. Re-checked every
    // frame (not one-shot) so it correctly fires after a closing jar is removed. The directional pour
    // sweep shares this exact boundary: lane + tempo release to neutral when the cascade drains.
    if (this._idle() && !this._anyClosing() && !this._autoRoutePending()) {
      this._combo = 0;
      this._pourLane = null;
      this._pourStreak = 0;
      this._rowStreak = 0;
      this._lastClearLane = null;
    }
  }

  // Fully idle: nothing spilling, nothing tweening (used to gate win/lose).
  _idle() { return !this._releasing && this.transit.length === 0 && this.rejecting.length === 0 && this._allSettled(); }

  _processAnims() {
    for (const c of this._allCandies()) {
      const a = c.anim;
      if (!a) continue;
      if (!c._started && this._time >= a.startTime) {
        c._started = true;
        if (a.kind === 'fall') {
          bus.emit(EV.CANDY_RELEASE, { x: a.fromX, y: a.fromY, color: c.colorKey, angle: 0 });
        }
      }
      if (this._time >= a.startTime + a.dur) {
        const tgt = this._restPos(c);
        c.anim = null; c._started = false; c._landAt = this._time;
        const pan = clamp((tgt.x - this.layout.cx) / (this.layout.w / 2), -1, 1);
        if (a.kind === 'toJar' || a.kind === 'pour') {
          bus.emit(EV.MARBLE_SEAT, { x: tgt.x, y: tgt.y, color: c.colorKey, pan });
        } else if (a.kind === 'fall' || a.kind === 'toTray' || a.kind === 'toCenter' || a.kind === 'intake') {
          bus.emit(EV.MARBLE_CLINK, { x: tgt.x, y: tgt.y, angle: pan, intensity: 0.4 });
        }
      }
    }
  }

  _resolveJarCompletions() {
    const closeBase = JAR.close.lidDropMs + JAR.close.holdMs + JAR.close.fadeMs;
    for (const jar of this.jars.jars) {
      if (!jar.complete) {
        if (jar.candies.length >= jar.capacity && jar.candies.every((c) => !c.anim)) {
          jar.complete = true;          // filled + settled → start the closing animation
          jar._clearStart = this._time;
          // FEEL-LAYER: recognize the cascade. Each completion in this window escalates.
          this._combo += 1;
          // VERTICAL chain: a completion in the held pour lane extends the down-a-lane sweep.
          if (jar.lane === this._pourLane) this._pourStreak += 1;
          // HORIZONTAL chain: consecutive completions that STEP to a new front-row lane (same row,
          // lane→lane). Same lane as last = vertical, so the horizontal run resets.
          if (this._lastClearLane != null && jar.lane !== this._lastClearLane) this._rowStreak += 1;
          else this._rowStreak = 1;
          this._lastClearLane = jar.lane;
          const comboIndex = Math.min(this._combo, SCORING.combo.maxLink); // 1-based, clamped
          const clutch = this.center.count() / this.center.capacity >= SCORING.clutch.thresholdFrac;
          const last = jar.candies[jar.capacity - 1];   // candy in the FINAL slot (Phase 2 multiplier)
          const multiplier = !!(last && last.special);
          const bl = this._jarBox(jar);
          bus.emit(EV.BOX_CLEAR, { x: bl.x, y: bl.y, color: jar.colorKey, comboIndex, clutch, multiplier, pourStreak: this._pourStreak, rowStreak: this._rowStreak });
        }
        continue;
      }
      // the lid has dropped, sealed, and faded → the jar is REMOVED (renderer stops drawing it). The
      // close runs at this jar's held-sweep tempo (jar._durMul) so a fast sweep advances the lane sooner.
      if (!jar.removed && this._time - jar._clearStart >= closeBase * (jar._durMul || 1)) jar.removed = true;
    }
  }

  _checkEnd() {
    if (!this._idle()) return;
    if (!this.packets.hasRemainingPackets() && this.center.isEmpty() && this.jars.allComplete()) {
      this.phase = 'win';
      bus.emit(EV.GAME_WIN, {});
      return;
    }
    // Stuck (no storage tray to fall back on): the center holds candies no ACTIVE jar will take,
    // AND there is no way to make progress — either no candies left to dispense, or the center is
    // full so none can be dropped to complete a jar and advance a lane.
    if (!this.center.isEmpty()) {
      const canJar = this.center.colorsPresent().some((col) => this.jars.anyAccepts(col));
      const canProgress = this.packets.hasRemainingPackets() && this.center.hasRoom();
      // A jar that has filled but is still playing its closing animation (complete but not yet
      // removed) is about to advance its lane and expose a new active jar — which may well accept a
      // color now waiting in the center. Don't call stuck while such a lane advance is pending.
      const laneAdvancePending = this.jars.jars.some((j) => j.complete && !j.removed);
      if (!canJar && !canProgress && !laneAdvancePending) {
        this.phase = 'lose';
        bus.emit(EV.GAME_LOSE, {});
      }
    }
  }

  // candies still needing the player's action (HUD counter + progress). Includes candies
  // currently spilling through the dispenser (transit) so the count never dips mid-release.
  candiesToSort() {
    return this.packets.remainingCandies() + this.transit.length + this.center.count() + this.rejecting.length;
  }
}
