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
  LEVELS, ACTIVE_LEVEL, COLORS, CANDY_PHYSICS_DEFAULT, HUD, CENTER, JAR, ANIM, DISPENSER, ART,
} from '../config.js';
import { CenterContainerManager } from './center.js';
import { JarManager } from './jars.js';
import { PacketQueueManager } from './packetQueue.js';
import { validateLevel } from './levelValidator.js';
import { computeDispenserColliders, DispenserPhysics, advanceWobble } from './dispenser.js';

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
    // dispenser funnel sim: candies spilled from a tapped packet live in `transit` (physics)
    // until they exit the chute into the center; `_releasing` locks input during that fall.
    this.physics = new DispenserPhysics(DISPENSER);
    this.transit = [];
    this._releasing = false;
    this._calmMs = 0;        // how long the spilling pile has been moving below the settle speed
    this._fallMs = 0;        // total time since the current spill began (force-settle fallback)
    this._idleSince = null;  // _time the table last became fully still (gates the auto-route beat)
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

    // ---- CANDY RACK: a grid of individual candies SPANNING the dispenser's inner rect ----
    // The cells tile the WHOLE inner cavity (not a centered cluster), so the candies cover the
    // entire dispenser. Each candy fills its cell (radius = half the smaller cell dim × fill).
    const IR = colliders.innerRect;
    const irW = IR.right - IR.left, irH = IR.bottom - IR.top;
    const pkPad = DISPENSER.packetPadFrac * Math.min(irW, irH);
    const pkCols = Math.max(1, DISPENSER.rackCols);
    const pkRows = Math.max(1, DISPENSER.rackRows);
    const cellW = (irW - 2 * pkPad) / pkCols;
    const cellH = (irH - 2 * pkPad) / pkRows;
    const pkR = Math.max(6, (Math.min(cellW, cellH) / 2) * DISPENSER.rackCandyFill);
    const px0 = IR.left + pkPad + cellW / 2;
    const py0 = IR.top + pkPad + cellH / 2;
    const packets = this.packets.slots.map((_, i) => ({
      x: px0 + (i % pkCols) * cellW,
      y: py0 + Math.floor(i / pkCols) * cellH,
      r: pkR,
    }));

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
    const tau = JAR.queue.slideTauMs;
    const k = snap ? 1 : (tau > 0 ? 1 - Math.exp(-(dt * 1000) / tau) : 1);
    const active = [];
    for (let lane = 0; lane < geom.laneCount; lane++) {
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
    if (c.where === 'jar') return this.jarCandyR(c.jar);
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
    const front = i + DISPENSER.rackCols; // the cell one row toward the chute, same column
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
    if (this.transit.length + this.center.count() >= this.center.capacity) return false;
    const slot = this.packets.slots[i];
    if (!slot || !slot.color) return false;
    if (this._dispenseBlocked(i)) { // blocked by the candy in front — reject with a cue
      const t = this.layout.packets[i];
      bus.emit(EV.MOVE_INVALID, { x: t.x, y: t.y });
      return false;
    }
    const colors = this.packets.consume(i);
    if (!colors) return false;
    this._calmMs = 0; this._fallMs = 0;
    const tile = this.layout.packets[i];
    const r = this._candyDrawR ?? this.physics.r; // DRAW radius; physics collides at this.physics.r
    const burst = this.physics.burst;
    const col = colors[0];
    const ph = (COLORS[col] && COLORS[col].physics) || CANDY_PHYSICS_DEFAULT;
    const dir = this.physics.colliders.cx - tile.x > 0 ? 1 : -1;
    const c = {
      id: this._nextId++, colorKey: col, r,
      // each candy carries its REAL material so the funnel sim treats it accordingly: restitution
      // (bounce), friction (slide/grip), mass (collision momentum + air drag), roll (does it spin),
      // and the soft-body fields (jiggle/wobble/bump/airDrag) for jelly wobble + cake squash.
      e: ph.restitution, fr: ph.friction, mass: ph.mass, roll: ph.roll, material: ph.material,
      jiggle: ph.jiggle || 0, wobbleFreq: ph.wobbleFreq || 0, wobbleDamp: ph.wobbleDamp || 0,
      bump: ph.bump || 0, airDrag: ph.airDrag || 1, squashMax: ph.squashMax,
      wAmp: 0, wPhase: 0, wAng: 0,
      angle: 0,
      spin: ph.roll ? dir * 5 : 0,   // a roller leaves the cell with a small tumble; a slab/gummy doesn't
      // drop from the tapped cell with a gentle nudge toward the chute centre; gravity + the funnel
      // slants carry it down into the tray. DETERMINISTIC (no Math.random) so the smoketest repeats.
      x: tile.x,
      y: tile.y,
      vx: dir * burst * 0.12,
      vy: burst * 0.25,
      bornAt: this._time,
    };
    this.transit.push(c);
    bus.emit(EV.CANDY_RELEASE, { x: c.x, y: c.y, color: col, angle: 0 });
    this._releasing = true;
    return true;
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
        c.x = clamp(c.x, B.left + r, B.right - r);
        if (c.y < this.layout.dispenser.exitY) c.y = B.floor - r;
        else c.y = Math.min(c.y, B.floor - r);
      }
      c.where = 'center'; c.jar = null; c._started = false; c.anim = null;
      c._landAt = this._time;
      c.restFx = (c.x - L.x) / L.w + 0.5;
      c.restFy = (c.y - L.y) / L.h + 0.5;
      c.restAngle = c.angle || 0;   // keep the orientation it tumbled to rest at
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
    moving.forEach((c, k) => {
      c.where = 'jar'; c.jar = jar;
      this.jars.add(jar, c); // assigns jar slot
      const from = prev.get(c);
      c.anim = { fromX: from.x, fromY: from.y, startTime: st + k * 40, dur: ANIM.moveDurMs, kind: 'toJar' };
    });
    this._reflow(remaining, prev, st);
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
    // hold the beat: let the pile rest visibly in the tray before it flows on.
    if (this._idleSince == null || this._time - this._idleSince < ANIM.autoRouteDelayMs) return;

    const st = this._time;
    // flow matching candies into accepting ACTIVE jars (fill across same-color front jars).
    let movedToJar = false;
    for (const jar of this.jars.activeJars()) {
      const room = this.jars.roomIn(jar);
      if (room <= 0 || !this.center.colorsPresent().includes(jar.colorKey)) continue;
      const prev = this._capture(this.center.candies);
      const moving = this.center.removeMatching(jar.colorKey, room);
      if (!moving.length) continue;
      const remaining = this.center.candies.slice();
      moving.forEach((c, k) => {
        c.where = 'jar'; c.jar = jar;
        this.jars.add(jar, c); // assigns jar slot
        const from = prev.get(c);
        c.anim = { fromX: from.x, fromY: from.y, startTime: st + k * 40, dur: ANIM.moveDurMs, kind: 'toJar' };
      });
      this._reflow(remaining, prev, st);
      movedToJar = true;
    }
    // whatever no active jar accepts just stays in the center, waiting for a lane to advance.
    if (movedToJar) return;
  }

  // Give center candies that shifted slot a short slide so the grid re-packs smoothly.
  _reflow(list, prev, st) {
    for (const c of list) {
      const from = prev.get(c);
      const tgt = this.centerRestPos(c);
      if (from && (Math.abs(from.x - tgt.x) > 0.5 || Math.abs(from.y - tgt.y) > 0.5)) {
        c.anim = { fromX: from.x, fromY: from.y, startTime: st, dur: ANIM.moveDurMs * 0.7, kind: 'reflow' };
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
      this.physics.step(this.transit, dt, this._time);
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
    this._resolveJarCompletions();
    this._autoRoute();
    this._checkEnd();
    this._refreshJarSlots(false, dt);   // ease jars toward their slots (lane shift-forward animation)
    // gentle ambient activity: rises while candies are in motion
    const moving = this.transit.length > 0 || this._allCandies().some((c) => c.anim);
    // track when the table last went fully still — the auto-route beat measures from here, so the
    // player SEES the candies tumble in and rest for a moment before they flow onward.
    if (moving || this._releasing) this._idleSince = null;
    else if (this._idleSince == null) this._idleSince = this._time;
    this.activity += ((moving ? 0.6 : 0.08) - this.activity) * Math.min(dt * 3, 1);
  }

  // Fully idle: nothing spilling, nothing tweening (used to gate win/lose).
  _idle() { return !this._releasing && this.transit.length === 0 && this._allSettled(); }

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
        if (a.kind === 'toJar') {
          bus.emit(EV.MARBLE_SEAT, { x: tgt.x, y: tgt.y, color: c.colorKey, pan });
        } else if (a.kind === 'fall' || a.kind === 'toTray' || a.kind === 'toCenter' || a.kind === 'intake') {
          bus.emit(EV.MARBLE_CLINK, { x: tgt.x, y: tgt.y, angle: pan, intensity: 0.4 });
        }
      }
    }
  }

  _resolveJarCompletions() {
    const closeTotal = JAR.close.lidDropMs + JAR.close.holdMs + JAR.close.fadeMs;
    for (const jar of this.jars.jars) {
      if (!jar.complete) {
        if (jar.candies.length >= jar.capacity && jar.candies.every((c) => !c.anim)) {
          jar.complete = true;          // filled + settled → start the closing animation
          jar._clearStart = this._time;
          const bl = this._jarBox(jar);
          bus.emit(EV.BOX_CLEAR, { x: bl.x, y: bl.y, color: jar.colorKey });
        }
        continue;
      }
      // the lid has dropped, sealed, and faded → the jar is REMOVED (renderer stops drawing it)
      if (!jar.removed && this._time - jar._clearStart >= closeTotal) jar.removed = true;
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
      if (!canJar && !canProgress) {
        this.phase = 'lose';
        bus.emit(EV.GAME_LOSE, {});
      }
    }
  }

  // candies still needing the player's action (HUD counter + progress). Includes candies
  // currently spilling through the dispenser (transit) so the count never dips mid-release.
  candiesToSort() {
    return this.packets.remainingCandies() + this.transit.length + this.center.count();
  }
}
