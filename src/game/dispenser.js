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
  return {
    box, innerRect, pathLeft, pathRight, funnelTopY, funnelBotY, exitY,
    cx: (pathLeft + pathRight) / 2,
  };
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
  step(transit, dt, now) {
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
    const C = this.colliders, r = this.r;
    for (const c of transit) {
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
      // anti-stuck backup (only while still IN the dispenser): nudge a loitering candy chute-ward
      if (c.y < C.exitY && now - c.bornAt > this.cfg.stuckMs) {
        c.vx += sign(C.cx - c.x) * this.burst * 0.6 * h * 8;
        c.vy += this.g * 0.5 * h;
      }
      this._constrain(c, C, r, h);
      // airborne (no contact this step): angular momentum bleeds slowly through the air
      if (!c._contact) c.spin *= Math.max(0, 1 - this.cfg.spinAirDamp * h);
    }
    // candy/candy collisions (a packet is only 6 candies — O(n^2) is fine). Drives the pile-up.
    for (let i = 0; i < transit.length; i++) {
      for (let j = i + 1; j < transit.length; j++) this._pair(transit[i], transit[j], r);
    }
  }

  // Keep a candy inside the funnel: rectangle walls -> slant lines -> chute walls -> tray basin,
  // by y-band. Below the chute exit the candy is in the tray and piles on its floor/walls. Every
  // surface is RIGID: the bounce uses the CANDY's own restitution; tangential grip uses the candy's
  // friction scaled by the surface smoothness (smooth dispenser walls vs the grippier tray floor).
  _constrain(c, C, r, h) {
    const e = this._e(c);
    const wfr = this._fr(c) * this.cfg.wallFrictionMul;   // impulsive wall/slant tangential loss
    if (c.y < C.funnelTopY) {
      // inside the rectangle: side + top walls
      if (c.x < C.innerRect.left + r) { c.x = C.innerRect.left + r; if (c.vx < 0) { this._impact(c, -c.vx, 1, 0); c.vx = -c.vx * e; c.vy *= (1 - wfr); this._wallRoll(c, 'left', r); } }
      else if (c.x > C.innerRect.right - r) { c.x = C.innerRect.right - r; if (c.vx > 0) { this._impact(c, c.vx, -1, 0); c.vx = -c.vx * e; c.vy *= (1 - wfr); this._wallRoll(c, 'right', r); } }
      if (c.y < C.innerRect.top + r && c.vy < 0) { c.y = C.innerRect.top + r; this._impact(c, -c.vy, 0, 1); c.vy = -c.vy * e; c._contact = true; }
    } else if (c.y < C.funnelBotY) {
      // diagonal slant band: bound x by the two converging lines
      const t = (c.y - C.funnelTopY) / Math.max(1, C.funnelBotY - C.funnelTopY);
      const leftB = lerp(C.innerRect.left, C.pathLeft, t) + r;
      const rightB = lerp(C.innerRect.right, C.pathRight, t) - r;
      if (c.x < leftB) this._slant(c, leftB, 'left', C, e, wfr, r);
      else if (c.x > rightB) this._slant(c, rightB, 'right', C, e, wfr, r);
    } else if (c.y < C.exitY) {
      // vertical chute: side walls
      if (c.x < C.pathLeft + r) { c.x = C.pathLeft + r; if (c.vx < 0) { this._impact(c, -c.vx, 1, 0); c.vx = -c.vx * e; c.vy *= (1 - wfr); this._wallRoll(c, 'left', r); } }
      else if (c.x > C.pathRight - r) { c.x = C.pathRight - r; if (c.vx > 0) { this._impact(c, c.vx, -1, 0); c.vx = -c.vx * e; c.vy *= (1 - wfr); this._wallRoll(c, 'right', r); } }
    } else if (this.basin) {
      // TRAY BASIN: the candy has left the chute and now bounces off the tray's inner walls and
      // floor (and other candies, via _pair) until it comes to rest — a natural tumble + pile.
      const B = this.basin;
      if (c.x < B.left + r) { c.x = B.left + r; if (c.vx < 0) { this._impact(c, -c.vx, 1, 0); c.vx = -c.vx * e; c.vy *= (1 - wfr); this._wallRoll(c, 'left', r); } }
      else if (c.x > B.right - r) { c.x = B.right - r; if (c.vx > 0) { this._impact(c, c.vx, -1, 0); c.vx = -c.vx * e; c.vy *= (1 - wfr); this._wallRoll(c, 'right', r); } }
      if (c.y > B.floor - r) {
        c.y = B.floor - r;
        if (c.vy > 0) { this._impact(c, c.vy, 0, -1); c.vy = -c.vy * e; }  // soft-body squashes on the floor
        // COULOMB friction along the floor: a CONSTANT deceleration μ·g opposing horizontal motion
        // (real kinetic friction, not a multiplier) — a slippery hard candy slides far, a tacky
        // gummy / soft slab stops almost at once.
        const decel = this._fr(c) * this.cfg.floorFrictionMul * this.g * h;
        if (Math.abs(c.vx) <= decel) c.vx = 0; else c.vx -= sign(c.vx) * decel;
        this._floorRoll(c, r);
      }
    }
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
  _pair(a, b, r) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    const min = 2 * r;
    if (d >= min || d === 0) return;
    const nx = dx / d, ny = dy / d;
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
