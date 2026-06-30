// dispenser.js — the candy-machine funnel: invisible colliders + a tiny custom 2D sim.
//
// The container.png is purely visual. This module builds the gameplay colliders that match
// its inner rectangle, the two diagonal slants, and the central vertical chute, then runs a small
// self-contained physics step (NOT an engine) for candies spilled from a tapped packet: gravity,
// candy/candy collisions, slide+bounce against the slants/walls, and an exit trigger at the chute
// mouth. Everything is expressed from the dispenser's drawn box so it scales to any screen size.
//
// Suggested-class mapping: computeDispenserColliders = DispenserPhysicsColliderSetup;
// DispenserPhysics.step = CandyPhysicsController; the onExit callback = CenterContainerIntakeTrigger.

function lerp(a, b, t) { return a + (b - a) * t; }
function sign(x) { return x < 0 ? -1 : x > 0 ? 1 : 0; }
function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

// Radius of an axis-aligned ellipse (half-axes rx, ry) along a unit direction (nx, ny). Used for the
// coarse SHAPE-AWARE collisions (item 3): a flat candy presents a wide-but-shallow footprint, a tall
// pill a narrow-but-deep one, so they pack and rest differently — without any polygon/rotation math.
function ellipseR(rx, ry, nx, ny) {
  const a = nx / (rx || 1e-6), b = ny / (ry || 1e-6);
  return 1 / Math.sqrt(a * a + b * b);
}

// ---- deterministic seeded randomness (item 1) --------------------------------------------------
// A good integer hash + a small fast PRNG (mulberry32). Used to give every dispensed candy its own
// reproducible "shuffle" so the COSMETIC tumble varies candy-to-candy while the LOGIC stays exactly
// reproducible (no Math.random anywhere in the sim / game path → the headless smoketest repeats).
export function hash32(x) {
  x = (x ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0;
  return (x ^ (x >>> 15)) >>> 0;
}
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build absolute-pixel colliders from the drawn dispenser box {x,y,w,h} (top-left origin) and the
// DISPENSER config fractions. Recompute on every resize.
export function computeDispenserColliders(box, cfg) {
  const { x, y, w, h } = box;
  const ir = cfg.innerRect;
  const innerRect = {
    left: x + ir.left * w, right: x + ir.right * w,
    top: y + ir.top * h, bottom: y + ir.bottom * h,
  };
  const pathLeft = x + cfg.path.left * w;
  const pathRight = x + cfg.path.right * w;
  const funnelTopY = y + cfg.funnel.topY * h;
  const funnelBotY = y + cfg.funnel.botY * h;
  const exitY = y + cfg.path.exitY * h;
  const colliders = {
    box, innerRect, pathLeft, pathRight, funnelTopY, funnelBotY, exitY,
    cx: (pathLeft + pathRight) / 2,
  };
  return colliders;
}

export class DispenserPhysics {
  constructor(cfg) {
    this.cfg = cfg;
    this.colliders = null;
    this.r = 8;
    this.g = cfg.gravity;
    this.burst = cfg.burstSpeed;
    // The TRAY BASIN below the chute (absolute px: inner walls + floor). Set by PuzzleGame.resize
    // once the center box is known; candies that fall past the chute exit pile against it.
    this.basin = null;
    // OVERFLOW GATE (absolute px y). Set by PuzzleGame.resize from DISPENSER.gate. A candy flagged
    // `admitted === false` (a WAITING candy, tray full) cannot descend past this line — it rests on
    // it and PILES above it in the funnel. Admitted candies ignore the gate and fall on into the tray.
    this.gateY = null;
  }

  // Bind freshly-computed colliders + scale speeds/sizes to the current dispenser width.
  configure(colliders, dispW) {
    this.colliders = colliders;
    const scale = dispW / this.cfg._refW;
    this.r = this.cfg.candyRFrac * dispW;
    this.g = this.cfg.gravity * scale;
    this.burst = this.cfg.burstSpeed * scale;
    this._vref = (this.cfg.impactVRef || 500) * scale;   // impact speed → full soft-body deformation
  }

  // Advance every transit candy by dt (sub-stepped). `now` is the game clock (ms) for anti-stuck.
  // Candies fall through the funnel + chute and then PILE in the tray basin (they are NOT removed
  // here — PuzzleGame watches them settle and hands the whole batch to the center container).
  step(transit, dt, now, resting = null) {
    // ITEM 4: the settled pile (resting center candies) acts as light colliders this step, so a
    // dropped candy lands on it and ripples only the neighbours it strikes. PuzzleGame passes it.
    this._resting = (resting && resting.length) ? resting : null;
    if (!this.colliders || !transit.length) return;
    const sub = Math.max(1, this.cfg.substeps);
    const h = dt / sub;
    for (let s = 0; s < sub; s++) this._sub(transit, h, now);
  }

  // Per-candy material accessors (each transit candy carries its own from COLORS[key].physics; the
  // global cfg values are the fallback). e = coefficient of restitution, fr = friction coefficient.
  _e(c) { return c.e != null ? c.e : this.cfg.restitution; }
  _fr(c) { return c.fr != null ? c.fr : this.cfg.friction; }

  _sub(transit, h, now) {
    const C = this.colliders;
    for (const c of transit) {
      const r = c.cr || this.r;     // per-candy COLLISION radius (item 1 radius jitter) — drives
                                    // wall/floor/pair contact; falls back to the global radius
      const mass = c.mass || 1;
      // GRAVITY is an ACCELERATION — mass-independent, exactly as in the real world (a heavy gummy
      // and a light hard candy fall together). Mass instead governs momentum in collisions (below).
      c.vy += this.g * h;
      // AIR DRAG decelerates a LIGHTER candy more (drag force / mass); a fluffy candy (high airDrag)
      // floats down slower still.
      const damp = Math.max(0, 1 - ((this.cfg.damping / mass) * (c.airDrag || 1)) * h);
      c.vx *= damp; c.vy *= damp;
      c.x += c.vx * h; c.y += c.vy * h;
      // free rotation; _constrain flips _contact true + couples spin to the surface on contact.
      if (c.angle == null) c.angle = 0;
      if (c.spin == null) c.spin = 0;
      c._contact = false;
      c.angle += c.spin * h;
      advanceWobble(c, h);   // decay/oscillate any soft-body deformation
      // anti-stuck backup (only while still IN the dispenser): nudge a loitering candy chute-ward.
      // SKIP candies waiting at the gate (admitted === false) — they're held there ON PURPOSE.
      if (c.admitted !== false && c.y < C.exitY && now - c.bornAt > this.cfg.stuckMs) {
        c.vx += sign(C.cx - c.x) * this.burst * 0.6 * h * 8;
        c.vy += this.g * 0.5 * h;
      }
      this._constrain(c, C, r, h);
      // airborne (no contact this step): angular momentum bleeds slowly through the air
      if (!c._contact) c.spin *= Math.max(0, 1 - this.cfg.spinAirDamp * h);
    }
    // candy/candy collisions (a packet is only 6 candies — O(n^2) is fine). Drives the pile-up.
    for (let i = 0; i < transit.length; i++) {
      for (let j = i + 1; j < transit.length; j++) this._pair(transit[i], transit[j]);
    }
    // ITEM 4: transit ↔ RESTING pile. A dropped candy lands on the settled pile; only the neighbours
    // it strikes hard enough WAKE (the rest hold their exact spot → no whole-pile freeze→revive twitch).
    if (this._resting) {
      const wakeSp = this.pileWake || 0;
      for (let i = 0; i < transit.length; i++) {
        for (let k = 0; k < this._resting.length; k++) this._pileContact(transit[i], this._resting[k], wakeSp);
      }
    }
    // RIGHTING pass — after all contacts this substep, ease each candy toward its upright rest angle
    // (gentle while falling fast, firm as it settles) so it lands in its canonical spritesheet pose.
    for (let i = 0; i < transit.length; i++) this._right(transit[i], h);
  }

  // A dropped (transit) candy `c` against a RESTING pile candy `o` (item 4). The resting candy holds
  // its position (the renderer draws it at its frozen rest spot) — we push ONLY the dropped candy out
  // and bounce it off. The resting candy receives a fraction of the impulse; if that would set it
  // moving faster than `wakeSp`, it WAKES (gets that velocity + a flag) so PuzzleGame re-sims it.
  _pileContact(c, o, wakeSp) {
    const dx = o.x - c.x, dy = o.y - c.y;
    const d = Math.hypot(dx, dy);
    if (d === 0) return;
    const nx = dx / d, ny = dy / d;
    const rc = c.rx ? ellipseR(c.rx, c.ry, nx, ny) : (c.cr || this.r);
    const ro = o.rx ? ellipseR(o.rx, o.ry, nx, ny) : (o.cr || this.r);
    const min = rc + ro;
    if (d >= min) return;
    const overlap = min - d;
    c.x -= nx * overlap; c.y -= ny * overlap;            // separate ONLY the dropped candy
    const vn = (o.vx - c.vx) * nx + (o.vy - c.vy) * ny;  // o is ~still → ≈ approach speed into the pile
    if (vn < 0) {
      const e = Math.min(this._e(c), this._e(o));
      const j = -(1 + e) * vn;
      c.vx -= j * nx; c.vy -= j * ny;                    // the dropped candy bounces off the pile
      c._contact = true;
      this._squash(c, -vn, -nx, -ny);
      const push = this.pilePush != null ? this.pilePush : 0.45;
      const ovx = o.vx + j * nx * push, ovy = o.vy + j * ny * push;
      if (Math.hypot(ovx, ovy) > wakeSp) { o.vx = ovx; o.vy = ovy; o._wake = true; }  // local ripple
    }
  }

  // Keep a candy inside the funnel: rectangle walls -> slant lines -> chute walls -> tray basin,
  // by y-band. Below the chute exit the candy is in the tray and piles on its floor/walls. Every
  // surface is RIGID: the bounce uses the CANDY's own restitution; tangential grip uses the candy's
  // friction scaled by the surface smoothness (smooth dispenser walls vs the grippier tray floor).
  _constrain(c, C, r, h) {
    const e = this._e(c);
    const wfr = this._fr(c) * this.cfg.wallFrictionMul;   // impulsive wall/slant tangential loss
    // SHAPE-AWARE half-extents (item 3): rx bounds the vertical walls, ry the floor/top; the diagonal
    // slants use the mean (their contact is oblique). Fall back to the circular radius when off.
    const rx = c.rx || r, ry = c.ry || r, rm = (rx + ry) * 0.5;
    // OVERFLOW GATE: a WAITING candy (admitted === false, tray full) can't pass the gate line — it
    // rests on it; the band logic below still bounds its x against the funnel walls, so waiting candies
    // PILE in the funnel above the gate (and on one another via _pair) instead of entering the tray.
    // Admitted candies (the normal flow) have admitted !== false, so they fall straight through.
    if (this.gateY != null && c.admitted === false && c.y > this.gateY - ry) {
      c.y = this.gateY - ry;
      if (c.vy > 0) { this._impact(c, c.vy, 0, -1); c.vy = -c.vy * e; }   // soft-body squash on the gate
      const decel = this._fr(c) * this.cfg.floorFrictionMul * this.g * h;  // Coulomb friction → settles ON it
      if (Math.abs(c.vx) <= decel) c.vx = 0; else c.vx -= sign(c.vx) * decel;
      this._floorRoll(c, rm);
    }
    if (c.y < C.funnelTopY) {
      // inside the rectangle: side + top walls
      if (c.x < C.innerRect.left + rx) { c.x = C.innerRect.left + rx; if (c.vx < 0) { this._impact(c, -c.vx, 1, 0); c.vx = -c.vx * e; c.vy *= (1 - wfr); this._wallRoll(c, 'left', rm); } }
      else if (c.x > C.innerRect.right - rx) { c.x = C.innerRect.right - rx; if (c.vx > 0) { this._impact(c, c.vx, -1, 0); c.vx = -c.vx * e; c.vy *= (1 - wfr); this._wallRoll(c, 'right', rm); } }
      if (c.y < C.innerRect.top + ry && c.vy < 0) { c.y = C.innerRect.top + ry; this._impact(c, -c.vy, 0, 1); c.vy = -c.vy * e; c._contact = true; }
    } else if (c.y < C.funnelBotY) {
      // diagonal slant band: bound x by the two converging lines
      const t = (c.y - C.funnelTopY) / Math.max(1, C.funnelBotY - C.funnelTopY);
      const leftB = lerp(C.innerRect.left, C.pathLeft, t) + rm;
      const rightB = lerp(C.innerRect.right, C.pathRight, t) - rm;
      if (c.x < leftB) this._slant(c, leftB, 'left', C, e, wfr, rm);
      else if (c.x > rightB) this._slant(c, rightB, 'right', C, e, wfr, rm);
    } else if (c.y < C.exitY) {
      // vertical chute: side walls
      if (c.x < C.pathLeft + rx) { c.x = C.pathLeft + rx; if (c.vx < 0) { this._impact(c, -c.vx, 1, 0); c.vx = -c.vx * e; c.vy *= (1 - wfr); this._wallRoll(c, 'left', rm); } }
      else if (c.x > C.pathRight - rx) { c.x = C.pathRight - rx; if (c.vx > 0) { this._impact(c, c.vx, -1, 0); c.vx = -c.vx * e; c.vy *= (1 - wfr); this._wallRoll(c, 'right', rm); } }
    } else if (this.basin) {
      // TRAY BASIN: the candy has left the chute and now bounces off the tray's inner walls and
      // floor (and other candies, via _pair) until it comes to rest — a natural tumble + pile.
      const B = this.basin;
      if (c.x < B.left + rx) { c.x = B.left + rx; if (c.vx < 0) { this._impact(c, -c.vx, 1, 0); c.vx = -c.vx * e; c.vy *= (1 - wfr); this._wallRoll(c, 'left', rm); } }
      else if (c.x > B.right - rx) { c.x = B.right - rx; if (c.vx > 0) { this._impact(c, c.vx, -1, 0); c.vx = -c.vx * e; c.vy *= (1 - wfr); this._wallRoll(c, 'right', rm); } }
      if (c.y > B.floor - ry) {
        c.y = B.floor - ry;
        if (c.vy > 0) { this._impact(c, c.vy, 0, -1); c.vy = -c.vy * e; }  // soft-body squashes + rocks on the floor
        // COULOMB friction along the floor: a CONSTANT deceleration μ·g opposing horizontal motion
        // (real kinetic friction, not a multiplier) — a slippery hard candy slides far, a tacky
        // gummy / soft slab stops almost at once.
        const decel = this._fr(c) * this.cfg.floorFrictionMul * this.g * h;
        if (Math.abs(c.vx) <= decel) c.vx = 0; else c.vx -= sign(c.vx) * decel;
        this._floorRoll(c, rm);
      }
    }
  }

  // RIGHTING (run every substep for every transit candy): ease the candy toward its canonical UPRIGHT
  // orientation (its `restBase` — 0 for most, +90° for the lollipop) so it comes to REST exactly as
  // drawn in the spritesheet. Strength ramps with how SETTLED it is — none while it tumbles/rolls down
  // fast, full as it slows to rest — and it turns by the SHORTEST path to the nearest equivalent of the
  // target, so the correction is spread across the slow part of the fall and never reads as a snap.
  // Purely an orientation effect (no position/logic change) so the headless smoketest is unaffected.
  _right(c, h) {
    const R = this.cfg.righting;
    if (!R || !R.enabled) return;
    const speed = Math.hypot(c.vx, c.vy);
    const s = clamp(1 - speed / Math.max(1, R.speedFrac * this._vref), 0, 1);
    if (s <= 0) return;
    const target = c.restBase || 0;
    let d = (target - (c.angle || 0)) % (2 * Math.PI);     // shortest signed turn to the nearest
    if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;  // equivalent of target
    c.angle = (c.angle || 0) + d * Math.min(1, R.rate * s * h);   // ease toward upright
    c.spin *= Math.max(0, 1 - s * (R.spinBleed || 8) * h);        // bleed the tumble so it doesn't fight
  }

  // A 'wobble' candy gets a rotational ROCK kick on a firm contact (landing on the floor or striking
  // the pile), scaled by the impact speed `sp`. Direction is deterministic (its current spin, else its
  // horizontal motion, else seeded noise) so a straight drop still tips a repeatable way.
  _rockKick(c, sp) {
    const S = this.cfg.shape;
    if (!S || !S.enabled || c.settle !== 'wobble' || sp <= this._vref * 0.05) return;
    const k = S.landKick * Math.min(1.5, sp / this._vref);
    const dir = sign(c.spin) || sign(c.vx) || sign(this._noise(c)) || 1;
    c.spin = (c.spin || 0) + dir * k;
  }

  // Push a candy onto a slant line and reflect its velocity about the slant normal so it SLIDES
  // down toward the chute (bounce on the normal component, friction on the tangential).
  _slant(c, boundX, side, C, e, fr, r) {
    c.x = boundX;
    c._contact = true;
    const dx = side === 'left' ? (C.pathLeft - C.innerRect.left) : (C.pathRight - C.innerRect.right);
    const dy = C.funnelBotY - C.funnelTopY;
    const len = Math.hypot(dx, dy) || 1;
    const tx = dx / len, ty = dy / len;          // tangent: down-slope toward the chute
    let nx = ty, ny = -tx;                        // a normal; flip it to point into the interior
    if (sign(nx) !== sign(C.cx - boundX) && C.cx - boundX !== 0) { nx = -nx; ny = -ny; }
    const vn = c.vx * nx + c.vy * ny;
    // reflect the into-slope velocity (rigid surface; bounce by the candy's restitution) and record
    // the NORMAL IMPULSE so friction is real Coulomb friction (μ·N), not a fixed fraction of speed.
    let normalImp = 0;
    if (vn < 0) { this._impact(c, -vn, nx, ny); normalImp = -(1 + e) * vn; c.vx += normalImp * nx; c.vy += normalImp * ny; }
    // tangential Coulomb friction: opposes down-slope motion, capped at μ·(normal impulse). With the
    // funnel slope steeper than the friction angle (μ < tanθ), gravity wins and every candy slides
    // down — a slick hard candy fast, a tacky gummy slower — instead of gluing to the slope.
    let vt = c.vx * tx + c.vy * ty;
    const dvt = Math.min(Math.abs(vt), fr * normalImp);
    if (vt !== 0) { c.vx -= sign(vt) * dvt * tx; c.vy -= sign(vt) * dvt * ty; }
    vt = c.vx * tx + c.vy * ty;
    // a hard candy/pillow ROLLS down the slope; a gummy/slab just slides (spin decays)
    if (c.roll) { const target = vt / Math.max(1, r); c.spin += (target - c.spin) * this.cfg.rollGrip; }
    else c.spin *= 0.6;
  }

  // Spin coupling on the floor: a rolling candy spins to match its ground speed (ω = v/r, rolling
  // without slipping); a non-roller's tumble dies on landing.
  _floorRoll(c, r) {
    c._contact = true;
    if (c.roll) { const target = c.vx / Math.max(1, r); c.spin += (target - c.spin) * this.cfg.rollGrip; }
    else c.spin *= 0.5;
  }

  // Spin coupling on a side wall: a rolling candy picks up spin from its sliding-down speed.
  _wallRoll(c, side, r) {
    c._contact = true;
    if (c.roll) { const target = (side === 'left' ? -1 : 1) * c.vy / Math.max(1, r); c.spin += (target - c.spin) * this.cfg.rollGrip; }
    else c.spin *= 0.5;
  }

  // Candy↔candy collision: mass-weighted separation + impulse with the COMBINED (minimum)
  // restitution, so a hard candy dropping onto a soft pile barely rebounds (like real life).
  _pair(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d === 0) return;
    const nx = dx / d, ny = dy / d;
    // SHAPE-AWARE footprint (item 3): each candy's reach along the contact normal is its ellipse
    // radius (half-extents rx/ry from its silhouette), falling back to the circular radius.
    const ra = a.rx ? ellipseR(a.rx, a.ry, nx, ny) : (a.cr || this.r);
    const rb = b.rx ? ellipseR(b.rx, b.ry, nx, ny) : (b.cr || this.r);
    const min = ra + rb;
    if (d >= min) return;
    const overlap = min - d;
    const ma = a.mass || 1, mb = b.mass || 1;
    const wa = mb / (ma + mb), wb = ma / (ma + mb);   // the heavier candy moves LESS
    a.x -= nx * overlap * wa; a.y -= ny * overlap * wa;
    b.x += nx * overlap * wb; b.y += ny * overlap * wb;
    const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (vn < 0) {
      const e = Math.min(this._e(a), this._e(b));
      const j = -(1 + e) * vn / (1 / ma + 1 / mb);
      a.vx -= (j / ma) * nx; a.vy -= (j / ma) * ny;
      b.vx += (j / mb) * nx; b.vy += (j / mb) * ny;
      a._contact = true; b._contact = true;
      // soft candies squash where they press into each other (no bump kick — keeps the pile stable)
      this._squash(a, -vn, -nx, -ny);
      this._squash(b, -vn, nx, ny);
      // a 'wobble' candy also ROCKS when it strikes the pile (a bit less than a floor landing)
      this._rockKick(a, -vn * 0.6);
      this._rockKick(b, -vn * 0.6);
    }
  }

  // ---- soft-body (jiggle / squash) + bumpy-surface kicks ----
  // Trigger a deformation from an impact of normal-speed `sp` along (nx,ny). A bigger/faster hit
  // deforms more (capped). The squash axis is the contact normal — the candy flattens against it.
  _squash(c, sp, nx, ny) {
    if (!c.jiggle || sp <= 0) return;
    const cap = c.squashMax != null ? c.squashMax : this.cfg.wobbleMaxAmp;
    const amp = Math.min(cap, (sp / this._vref) * c.jiggle);
    if (amp > (c.wAmp || 0)) { c.wAmp = amp; c.wPhase = 0; c.wAng = Math.atan2(ny, nx); }
  }

  // A surface impact: squash + (for an UNEVEN surface) a deterministic lateral + spin KICK, so a
  // lumpy jelly catches on its bumps and tumbles erratically instead of sliding straight. Gated to
  // firm contacts so a candy still comes to rest (no perpetual jitter).
  _impact(c, sp, nx, ny) {
    this._squash(c, sp, nx, ny);
    this._rockKick(c, sp);   // a 'wobble' candy turns on a firm impact
    if (c.bump && sp > this._vref * 0.18) {
      const n1 = this._noise(c), n2 = this._noise(c);   // deterministic per-candy (no Math.random)
      const tx = -ny, ty = nx;                          // along the surface
      const kick = this.cfg.bumpKick * c.bump * sp;
      c.vx += tx * kick * n1; c.vy += ty * kick * n1;
      c.spin = (c.spin || 0) + n2 * c.bump * 10;
    }
  }

  // Deterministic pseudo-noise in [-0.5, 0.5), seeded by candy id, advancing per call (LCG).
  _noise(c) {
    c._seed = (c._seed == null ? ((c.id * 2654435761) >>> 0) : ((c._seed * 1664525 + 1013904223) >>> 0));
    return (c._seed / 4294967296) - 0.5;
  }
}

// Advance a candy's soft-body deformation. Anything with a `wobbleFreq` OSCILLATES (squash↔stretch)
// as it decays — the difference between materials is the decay rate (`wobbleDamp`): a jelly damps
// slowly and keeps wobbling; a cake damps fast (high wobbleDamp) so it jiggles only 1–2 cycles then
// settles. A material with no wobbleFreq just relaxes its compression straight back (no oscillation).
// Shared by the funnel sim (transit) and PuzzleGame (settled center candies) so a landing jiggle
// finishes smoothly after the candy comes to rest.
export function advanceWobble(c, dt) {
  if (!c.wAmp) return;
  if (c.wobbleFreq) c.wPhase = (c.wPhase || 0) + c.wobbleFreq * dt;
  c.wAmp *= Math.exp(-(c.wobbleDamp || 8) * dt);
  if (c.wAmp < 0.003) { c.wAmp = 0; c.wPhase = 0; }
}
