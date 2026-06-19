// renderer.js — all canvas drawing for the three stacked zones:
//   TOP    tray row (dispensers)
//   MIDDLE round conveyor loop (marbles ride here, drawn at their angle)
//   BOTTOM bin row (collection bins)
// Plus particles, motion-blur trails, vignette and the debug overlay.
// Procedural; no image files. Reads marble positions from GameState.

import { bus, EV } from '../core/events.js';
import { COLORS, THEME, RENDER, RULES, BIN, DIAL } from '../config.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = 0; this.h = 0;
    this.particles = [];
    this.fps = 60;
    this.debug = false;

    bus.on(EV.BOX_CLEAR, ({ x, y, color }) => this._burst(x, y, color));
    bus.on(EV.MARBLE_SEAT, ({ x, y, color }) => this._burst(x, y, color, 0.4));
  }

  resize() {
    // visualViewport tracks the actually-visible area on mobile (URL bar, etc.);
    // fall back to innerWidth/Height on desktop.
    const vv = window.visualViewport;
    const w = Math.max(1, Math.round(vv ? vv.width : window.innerWidth));
    const h = Math.max(1, Math.round(vv ? vv.height : window.innerHeight));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.w = w; this.h = h;
    return { w, h };
  }

  _burst(x, y, colorKey, scale = 1) {
    const col = COLORS[colorKey] || { base: '#fff' };
    const n = Math.round(RENDER.particleCount * scale);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (40 + Math.random() * 160) * scale;
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30 * scale,
        life: RENDER.particleLifeMs * (0.6 + Math.random() * 0.4), age: 0,
        r: (2 + Math.random() * 3) * scale, color: col.light || col.base,
      });
    }
  }

  // --- primitives -----------------------------------------------------------

  _marble(ctx, x, y, r, col, scale = 1, roll = null) {
    r *= scale;
    ctx.beginPath();
    ctx.ellipse(x + r * 0.18, y + r * 0.32, r * 0.95, r * 0.7, 0, 0, Math.PI * 2);
    ctx.fillStyle = RENDER.marbleShadow;
    ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, col.light);
    g.addColorStop(0.45, col.base);
    g.addColorStop(1, col.dark);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    // surface speckle that orbits with `roll` to read as rolling/spin (clipped to the body)
    if (roll !== null) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.96, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = col.dark;
      for (let k = 0; k < 2; k++) {
        const a = roll + k * Math.PI;
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * r * 0.42, y + Math.sin(a) * r * 0.42, r * 0.2, r * 0.13, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    // specular highlight (fixed to the light, drawn over the rolling speckle)
    ctx.beginPath();
    ctx.arc(x - r * 0.34, y - r * 0.4, r * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = RENDER.specular;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.98, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.stroke();
  }

  _roundRect(ctx, x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  // --- main render ----------------------------------------------------------

  render(state, dial, dt) {
    const ctx = this.ctx;
    const L = state.layout;
    if (!L) return;
    this.fps += ((1 / Math.max(dt, 1e-4)) - this.fps) * 0.1;
    const beltN = state.beltCount();
    const omega = dial.angularVel;

    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, this.w, this.h);
    const bgGrad = ctx.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, Math.max(this.w, this.h) * 0.6);
    bgGrad.addColorStop(0, 'rgba(40,48,64,0.35)');
    bgGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, this.w, this.h);

    this._drawLoop(ctx, state, beltN);
    this._drawBins(ctx, state);
    this._drawTrays(ctx, state);
    this._drawMarbles(ctx, state);
    this._updateParticles(ctx, dt);
    this._drawVignette(ctx);
    if (this.debug) this._drawDebug(ctx, beltN, omega, state);
  }

  _drawLoop(ctx, state, beltN) {
    const L = state.layout;
    const warn = beltN >= RULES.warnAt;

    // track band (annulus)
    ctx.save();
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, L.outerR, 0, Math.PI * 2);
    ctx.arc(L.cx, L.cy, L.innerR, 0, Math.PI * 2, true);
    const tg = ctx.createRadialGradient(L.cx, L.cy, L.innerR, L.cx, L.cy, L.outerR);
    tg.addColorStop(0, THEME.trackEdge);
    tg.addColorStop(0.5, THEME.track);
    tg.addColorStop(1, THEME.trackEdge);
    ctx.fillStyle = tg;
    ctx.fill('evenodd');
    ctx.restore();

    // glossy centerline
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, L.R, 0, Math.PI * 2);
    ctx.lineWidth = L.trackW * 0.5;
    ctx.strokeStyle = THEME.trackHighlight;
    ctx.stroke();

    // rotating detent ticks (convey spin)
    const N = DIAL.detents;
    ctx.save();
    ctx.translate(L.cx, L.cy);
    ctx.rotate(state.beltAngle);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (L.outerR - 2), Math.sin(a) * (L.outerR - 2));
      ctx.lineTo(Math.cos(a) * (L.outerR - 8), Math.sin(a) * (L.outerR - 8));
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();

    // edge rings
    for (const rr of [L.innerR, L.outerR]) {
      ctx.beginPath();
      ctx.arc(L.cx, L.cy, rr, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = warn ? 'rgba(232,97,95,0.5)' : THEME.trackEdge;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(L.cx, L.cy, rr, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.stroke();
    }

    // hub
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, L.innerR * 0.6, 0, Math.PI * 2);
    const hub = ctx.createRadialGradient(L.cx - 8, L.cy - 8, 2, L.cx, L.cy, L.innerR * 0.6);
    hub.addColorStop(0, '#222836');
    hub.addColorStop(1, '#10131a');
    ctx.fillStyle = hub;
    ctx.fill();
    if (warn) {
      ctx.fillStyle = `rgba(232,97,95,${0.12 + 0.1 * Math.sin(performance.now() / 120)})`;
      ctx.fill();
    }
  }

  _drawBins(ctx, state) {
    const L = state.layout;
    for (let i = 0; i < state.bins.length; i++) {
      const bin = state.bins[i];
      const bl = L.bins[i];
      const col = COLORS[bin.colorKey];
      const w = bl.r * 3.2, h = bl.r * 1.8;
      const x = bl.x - w / 2, y = bl.y - h / 2;
      this._roundRect(ctx, x, y, w, h, 10);
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, '#222732');
      g.addColorStop(1, '#171b23');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = col.base;
      ctx.globalAlpha = bin.clearing ? 0.6 + 0.4 * Math.sin(performance.now() / 80) : 0.85;
      ctx.stroke();
      ctx.globalAlpha = 1;
      // color tab on top
      this._roundRect(ctx, x, y - 6, w, 8, 4);
      ctx.fillStyle = col.base;
      ctx.fill();
      // slots
      for (let s = 0; s < BIN.slots; s++) {
        const sp = state.slotPos(bl, s, BIN.slots);
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, bl.r * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.stroke();
      }
      // seated marbles
      for (const m of bin.seated) {
        const sp = state.slotPos(bl, m.slot, BIN.slots);
        const age = performance.now() - m.pop;
        const pop = age < 220 ? 1 + 0.25 * Math.sin((age / 220) * Math.PI) : 1;
        this._marble(ctx, sp.x, sp.y, bl.r * 0.42, col, pop);
      }
    }
  }

  _drawTrays(ctx, state) {
    const L = state.layout;
    for (let i = 0; i < state.trays.length; i++) {
      const tray = state.trays[i];
      const tl = L.trays[i];
      const w = tl.r * 2.0, h = tl.r * 1.6;
      const x = tl.x - w / 2, y = tl.y - h / 2;
      this._roundRect(ctx, x, y, w, h, 10);
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, THEME.trayRim);
      g.addColorStop(1, THEME.trayBody);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.stroke();

      // little spout pointing down toward the loop
      ctx.beginPath();
      ctx.moveTo(tl.x - tl.r * 0.28, y + h);
      ctx.lineTo(tl.x + tl.r * 0.28, y + h);
      ctx.lineTo(tl.x, y + h + tl.r * 0.34);
      ctx.closePath();
      ctx.fillStyle = THEME.trayBody;
      ctx.fill();

      // peek at the next marbles in the stack (front-most lowest)
      const stack = tray.stack;
      const show = Math.min(stack.length, 3);
      for (let s = show - 1; s >= 0; s--) {
        const key = stack[stack.length - 1 - s];
        const col = COLORS[key];
        const mr = tl.r * 0.5;
        this._marble(ctx, tl.x, tl.y + h * 0.12 - s * mr * 0.5, mr, col, s === 0 ? 1 : 0.82);
      }
      // count badge
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.arc(x + w - 6, y + 6, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = THEME.text;
      ctx.font = '600 13px -apple-system, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(stack.length), x + w - 6, y + 7);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  _drawMarbles(ctx, state) {
    const L = state.layout;
    for (const m of state.marbles) {
      const col = COLORS[m.colorKey];
      if (m.state === 'riding') {
        const rr = m.rr || L.R;
        const x = L.cx + Math.cos(m.angle) * rr;
        const y = L.cy + Math.sin(m.angle) * rr;
        this._marble(ctx, x, y, L.marbleR, col, 1, m.roll);
      } else {
        // entering (falling onto loop) or dropping (falling into bin)
        const squash = m.state === 'dropping' ? 1 - 0.12 * Math.sin(m.t * Math.PI) : 1;
        this._marble(ctx, m.x, m.y, L.marbleR, col, squash);
      }
    }
  }

  _updateParticles(ctx, dt) {
    const ms = dt * 1000;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += ms;
      if (p.age >= p.life) { this.particles.splice(i, 1); continue; }
      p.vy += 220 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const a = 1 - p.age / p.life;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * a, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _drawVignette(ctx) {
    const g = ctx.createRadialGradient(
      this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.35,
      this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, THEME.bgVignette);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  _drawDebug(ctx, beltN, omega, state) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    this._roundRect(ctx, 10, 10, 200, 106, 8);
    ctx.fill();
    ctx.fillStyle = '#9fe8b0';
    ctx.font = '600 13px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(`FPS      ${this.fps.toFixed(0)}`, 22, 20);
    ctx.fillText(`marbles  ${beltN} / ${RULES.loopCapacity}`, 22, 40);
    ctx.fillText(`ω        ${omega.toFixed(2)} rad/s`, 22, 60);
    const seat = state && state.canSeat;
    ctx.fillStyle = seat ? '#9fe8b0' : '#e8855f';
    ctx.fillText(`seating  ${seat ? 'ON (auto-flow)' : 'OFF (spinning)'}`, 22, 80);
    ctx.restore();
  }
}
