// renderer.js — all canvas drawing for Candy Sort:
//   TOP    HUD band + source-packet row (candy dispensers)
//   MIDDLE round conveyor loop (candies ride here, drawn at their angle)
//   SIDES  collection-tray columns left + right
// Candies blit from the spritesheet; packets/trays from per-color PNGs (CandyTrayPackets/,
// Trays/), each with a procedural fallback until its image loads. Plus particles, sparkles,
// vignette, HUD pills and the debug overlay. Reads candy positions from GameState.

import { bus, EV } from '../core/events.js';
import { COLORS, THEME, RENDER, RULES, BIN, DIAL, ART, PACKET, CENTER, JAR } from '../config.js';
import candyUrl from '../../newcandy/newcandies.png';
import dispenserUrl from '../../candyDispenser/container.png';
import jarUrl from '../../Jar/jars.png';
import bgUrl from '../../background/background.png';
import holdingTrayUrl from '../../containers/newholdingtray.png';

const SPRITE_COLS = 4, SPRITE_ROWS = 2;

// Per-color source-packet + collection-tray art, loaded via Vite glob (filenames have
// spaces/parens and mixed case — glob handles them). Key each URL by the color prefix before
// the first '_'. The top MONO-COLOR packet tiles draw from CandyTrayPackets/<color> (a tray
// full of that one color's candies — exactly the Marble-Sort feeder-tile look).
const PACKET_URLS = import.meta.glob('../../CandyTrayPackets/*.png', { eager: true, query: '?url', import: 'default' });
const TRAY_URLS = import.meta.glob('../../Trays/*.png', { eager: true, query: '?url', import: 'default' });

const TRAY_FRAMES = 4; // tray frame sheets are a horizontal strip: empty | 1 | 2 | 3 candies

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (p) => 1 - (1 - p) * (1 - p);

function indexByColor(urlMap) {
  const out = {};
  for (const path in urlMap) {
    const file = path.split('/').pop();
    if (/spritesheet/i.test(file)) continue; // frame sheets are handled separately
    // color = the basename token before the first '_' or space, minus any trailing
    // digits. Handles 'red_candy (1).png', 'cyan.png', and re-exports like 'mango2.png'.
    const color = file.replace(/\.[^.]+$/, '').split(/[_ ]/)[0].replace(/\d+$/, '').toLowerCase();
    out[color] = urlMap[path];
  }
  return out;
}

// Tray FRAME sheets: any Trays/*spritesheet*.png. Color = basename with the words
// 'tray'/'spritesheet', digits and non-letters stripped (e.g. 'redtray spritesheet.png' -> 'red').
function indexFrameSheets(urlMap) {
  const out = {};
  for (const path in urlMap) {
    const file = path.split('/').pop();
    if (!/spritesheet/i.test(file)) continue;
    const color = file.replace(/\.[^.]+$/, '').toLowerCase().replace(/spritesheet|tray/g, '').replace(/[^a-z]/g, '');
    if (color) out[color] = urlMap[path];
  }
  return out;
}
function imgReady(im) { return !!im && im.complete && im.naturalWidth > 0; }

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = 0; this.h = 0;
    this.particles = [];
    this.fps = 60;
    this.debug = false;

    // candy spritesheet (4×2). Until it loads, _candy falls back to procedural shapes.
    this.sprites = new Image();
    this.spritesReady = false;
    this.cellW = 0; this.cellH = 0;
    this.candyContent = {}; // 'col,row' -> tight alpha bbox of that candy within the sheet
    const onSheet = () => {
      this.spritesReady = true;
      this.cellW = this.sprites.naturalWidth / SPRITE_COLS;
      this.cellH = this.sprites.naturalHeight / SPRITE_ROWS;
      this._measureCandyCells();
    };
    this.sprites.onload = onSheet;
    this.sprites.src = candyUrl;
    if (this.sprites.complete && this.sprites.naturalWidth) onSheet();

    // per-color source-packet + collection-tray art (keyed by COLORS[key].art name). Until an
    // image is ready, a procedural fallback is drawn instead. On load each image's tight alpha
    // bounding box is cached (img._bbox) so transparent padding is cropped and mismatched art
    // draws at its true size / aspect.
    this._scan = null; // lazily-created offscreen canvas for alpha bbox scans
    // the candy-machine dispenser frame (drawn to fill its layout box exactly, so the
    // DISPENSER collider fractions line up with the art)
    this.dispenserImg = new Image();
    this.dispenserReady = false;
    this.dispenserImg.onload = () => { this.dispenserReady = true; };
    this.dispenserImg.src = dispenserUrl;
    if (this.dispenserImg.complete && this.dispenserImg.naturalWidth) this.dispenserReady = true;
    // the target jar frame (drawn to fill each jar's layout box; candies + the target-color
    // indicator sit in its glass bowl via JAR.glass)
    this.jarImg = new Image();
    this.jarReady = false;
    this.jarImg.onload = () => { this.jarReady = true; };
    this.jarImg.src = jarUrl;
    if (this.jarImg.complete && this.jarImg.naturalWidth) this.jarReady = true;
    // full-screen candy background (drawn cover-fit behind everything)
    this.bgImg = new Image();
    this.bgReady = false;
    this.bgImg.onload = () => { this.bgReady = true; };
    this.bgImg.src = bgUrl;
    if (this.bgImg.complete && this.bgImg.naturalWidth) this.bgReady = true;
    // the center "holding" tray (wide). Drawn to fill its layout box; CENTER aspect matches the art
    // so it isn't distorted. A procedural glass box stands in until the PNG loads.
    this.holdingTrayImg = new Image();
    this.holdingTrayReady = false;
    this.holdingTrayImg.onload = () => { this.holdingTrayReady = true; };
    this.holdingTrayImg.src = holdingTrayUrl;
    if (this.holdingTrayImg.complete && this.holdingTrayImg.naturalWidth) this.holdingTrayReady = true;
    this.packetImgs = this._loadArt(indexByColor(PACKET_URLS));
    this.trayImgs = this._loadArt(indexByColor(TRAY_URLS));
    // per-color 4-frame tray sheets (empty|1|2|3). When a color has one, the tray draws
    // the frame matching its seated-candy count instead of stacking individual candies.
    this.trayFrameImgs = this._loadFrameSheets(indexFrameSheets(TRAY_URLS));

    bus.on(EV.BOX_CLEAR, ({ x, y, color }) => this._burst(x, y, color));
    bus.on(EV.MARBLE_SEAT, ({ x, y, color }) => this._burst(x, y, color, 0.4));
    bus.on(EV.CANDY_RELEASE, ({ x, y, color }) => this._sparkle(x, y, color));
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

  // Load a {color: url} map into {color: Image}, caching each image's tight alpha
  // bounding box (img._bbox, in source pixels) once it loads.
  _loadArt(urlMap) {
    const out = {};
    for (const k in urlMap) {
      const im = new Image();
      const done = () => { im._bbox = this._measureContent(im); };
      im.onload = done;
      im.src = urlMap[k];
      if (im.complete && im.naturalWidth) done(); // already cached
      out[k] = im;
    }
    return out;
  }

  // Tight alpha bounding box of an image (in source pixels), via a downscaled scan.
  // Lets transparent padding be cropped so each art draws at its true size / aspect.
  _measureContent(im) {
    const full = { sx: 0, sy: 0, sw: im.naturalWidth, sh: im.naturalHeight };
    const MAXD = 96;
    const sc = Math.min(1, MAXD / Math.max(im.naturalWidth, im.naturalHeight));
    const w = Math.max(1, Math.round(im.naturalWidth * sc));
    const h = Math.max(1, Math.round(im.naturalHeight * sc));
    if (!this._scan) this._scan = document.createElement('canvas');
    this._scan.width = w; this._scan.height = h;
    const c = this._scan.getContext('2d', { willReadFrequently: true });
    c.clearRect(0, 0, w, h);
    c.drawImage(im, 0, 0, w, h);
    let data;
    try { data = c.getImageData(0, 0, w, h).data; } catch { return full; }
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    const A = 12; // alpha threshold
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > A) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < x0 || y1 < y0) return full;
    const inv = 1 / sc;
    return { sx: x0 * inv, sy: y0 * inv, sw: (x1 - x0 + 1) * inv, sh: (y1 - y0 + 1) * inv };
  }

  // Load {color: url} tray FRAME sheets into {color: Image}. On load, measure the tray's
  // tight alpha bbox WITHIN ONE FRAME (the tray sits in the same spot in every frame), so
  // the padding is cropped consistently across frames.
  _loadFrameSheets(urlMap) {
    const out = {};
    for (const k in urlMap) {
      const im = new Image();
      const done = () => this._measureFrameSheet(im);
      im.onload = done;
      im.src = urlMap[k];
      if (im.complete && im.naturalWidth) done();
      out[k] = im;
    }
    return out;
  }

  // Measure frame 0's content bbox (relative to a single frame) and cache frame metrics.
  _measureFrameSheet(im) {
    const W = im.naturalWidth, H = im.naturalHeight;
    const fw = W / TRAY_FRAMES;
    im._frames = TRAY_FRAMES;
    im._frameW = fw;
    if (!this._scan) this._scan = document.createElement('canvas');
    this._scan.width = W; this._scan.height = H;
    const c = this._scan.getContext('2d', { willReadFrequently: true });
    c.clearRect(0, 0, W, H);
    c.drawImage(im, 0, 0);
    let data;
    try { data = c.getImageData(0, 0, W, H).data; } catch { im._frameBoxes = null; return; }
    const A = 16;
    // Some tray sheets are NOT frame-aligned — the tray drifts horizontally from frame
    // to frame (green/mango slide left as candies are added) instead of staying put like
    // red. Measure EACH frame's own content bbox (in absolute sheet pixels) so every frame
    // is cropped and re-centered to its true content; cropping all frames to frame 0's box
    // would clip the drifted frames' left edge (worse the more they drift).
    const boxes = [];
    for (let i = 0; i < TRAY_FRAMES; i++) {
      const fx0 = Math.round(i * fw), fx1 = Math.round((i + 1) * fw);
      let x0 = fx1, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) {
        for (let x = fx0; x < fx1; x++) {
          if (data[(y * W + x) * 4 + 3] > A) {
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
      boxes[i] = (x1 >= x0 && y1 >= y0)
        ? { sx: x0, sy: y0, sw: x1 - x0 + 1, sh: y1 - y0 + 1 }
        : { sx: fx0, sy: 0, sw: fx1 - fx0, sh: H };
    }
    im._frameBoxes = boxes;
  }

  // Draw frame `idx` of a tray frame sheet, cropped to that frame's own content bbox,
  // preserving aspect, fit to height `destH`, centered at (cx, cy).
  _drawTrayFrame(ctx, im, idx, cx, cy, destH, alpha = 1) {
    const i = Math.max(0, Math.min(idx, im._frames - 1));
    const fb = im._frameBoxes[i];
    const destW = destH * (fb.sw / fb.sh);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(im, fb.sx, fb.sy, fb.sw, fb.sh, cx - destW / 2, cy - destH / 2, destW, destH);
    ctx.restore();
  }

  // Measure each candy cell's tight alpha bounding box within the spritesheet, so a
  // seated candy can be cropped to its content (no per-sprite padding) and centered.
  _measureCandyCells() {
    const im = this.sprites;
    const W = im.naturalWidth, H = im.naturalHeight;
    const cw = W / SPRITE_COLS, ch = H / SPRITE_ROWS;
    if (!this._scan) this._scan = document.createElement('canvas');
    this._scan.width = W; this._scan.height = H;
    const c = this._scan.getContext('2d', { willReadFrequently: true });
    c.clearRect(0, 0, W, H);
    c.drawImage(im, 0, 0);
    let data;
    try { data = c.getImageData(0, 0, W, H).data; } catch { return; }
    const A = 16; // alpha threshold
    for (let row = 0; row < SPRITE_ROWS; row++) {
      for (let col = 0; col < SPRITE_COLS; col++) {
        const ox = Math.floor(col * cw), oy = Math.floor(row * ch);
        const cwI = Math.floor(cw), chI = Math.floor(ch);
        // Bound the candy by its connected blob(s), not a naive alpha bbox: some
        // sprite cells carry a few stray speckle pixels near an edge (green has a
        // bottom-right dot, mango a bottom-edge fleck) that would otherwise inflate
        // the box, shrinking and off-centering the seated candy. Label 8-connected
        // components, then take the bbox of every component large enough to be real.
        const N = cwI * chI;
        const label = new Int32Array(N).fill(-1);
        const sizes = [];
        const stack = [];
        let next = 0;
        for (let i = 0; i < N; i++) {
          const sx = i % cwI, sy = (i / cwI) | 0;
          if (label[i] !== -1 || data[((oy + sy) * W + (ox + sx)) * 4 + 3] <= A) continue;
          const id = next++;
          let sz = 0;
          stack.push(i);
          label[i] = id;
          while (stack.length) {
            const cur = stack.pop();
            sz++;
            const x = cur % cwI, y = (cur / cwI) | 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= cwI || ny >= chI) continue;
                const ni = ny * cwI + nx;
                if (label[ni] !== -1 || data[((oy + ny) * W + (ox + nx)) * 4 + 3] <= A) continue;
                label[ni] = id;
                stack.push(ni);
              }
            }
          }
          sizes[id] = sz;
        }
        if (next === 0) continue;
        // keep any blob >= 2% of the largest (drops specks, preserves real parts)
        const minSize = Math.max(50, Math.max(...sizes) * 0.02);
        let x0 = cwI, y0 = chI, x1 = -1, y1 = -1;
        for (let i = 0; i < N; i++) {
          const id = label[i];
          if (id < 0 || sizes[id] < minSize) continue;
          const x = i % cwI, y = (i / cwI) | 0;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        if (x1 >= x0 && y1 >= y0) {
          this.candyContent[`${col},${row}`] = { sx: ox + x0, sy: oy + y0, sw: x1 - x0 + 1, sh: y1 - y0 + 1 };
        }
      }
    }
  }

  // Draw a SEATED candy cropped to its content, scaled to fill (boxW × boxH) preserving
  // aspect, centered at (cx, cy). `pop` is a transient settle-bounce scale.
  _seatCandy(ctx, col, cx, cy, boxW, boxH, pop = 1) {
    const key = col.sprite && `${col.sprite[0]},${col.sprite[1]}`;
    const cc = key && this.candyContent[key];
    if (!this.spritesReady || !cc) {
      // procedural fallback until the sheet is measured
      this._candy(ctx, cx, cy, Math.min(boxW, boxH) / 2, col, { scale: pop, shape: col.shape });
      return;
    }
    const scale = Math.min(boxW / cc.sw, boxH / cc.sh) * pop * (col.seatScale || 1);
    const dw = cc.sw * scale, dh = cc.sh * scale;
    // no contact shadow for a seated candy — it rests inside its groove
    ctx.drawImage(this.sprites, cc.sx, cc.sy, cc.sw, cc.sh, cx - dw / 2, cy - dh / 2, dw, dh);
  }

  // Draw a tray art's cropped content preserving aspect, fit to height `destH`,
  // centered at (cx, cy). Width follows the art's own (cropped) aspect.
  _drawTrayArt(ctx, im, cx, cy, destH, alpha = 1) {
    const bb = im._bbox || { sx: 0, sy: 0, sw: im.naturalWidth, sh: im.naturalHeight };
    const destW = destH * (bb.sw / bb.sh);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(im, bb.sx, bb.sy, bb.sw, bb.sh, cx - destW / 2, cy - destH / 2, destW, destH);
    ctx.restore();
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

  // Trace the body outline of a candy at (x,y) sized to radius r. Each shape is a
  // distinct silhouette so candy TYPES read apart at a glance (color + form).
  _candyPath(ctx, x, y, r, shape) {
    ctx.beginPath();
    switch (shape) {
      case 'oval': // horizontal jelly bean
        ctx.ellipse(x, y, r * 1.12, r * 0.76, 0, 0, Math.PI * 2);
        break;
      case 'square': { // rounded square (soft caramel)
        const a = r * 0.92, rad = r * 0.42;
        this._roundRect(ctx, x - a, y - a, a * 2, a * 2, rad);
        break;
      }
      case 'pill': { // vertical capsule (gum)
        const hw = r * 0.66, hh = r * 1.02;
        this._roundRect(ctx, x - hw, y - hh, hw * 2, hh * 2, hw);
        break;
      }
      case 'diamond': // rhombus (hard candy)
        ctx.moveTo(x, y - r * 1.16);
        ctx.lineTo(x + r * 1.0, y);
        ctx.lineTo(x, y + r * 1.16);
        ctx.lineTo(x - r * 1.0, y);
        ctx.closePath();
        break;
      case 'round':
      default: // slightly squished gummy
        ctx.ellipse(x, y, r, r * 0.94, 0, 0, Math.PI * 2);
        break;
    }
  }

  // Draw one candy. Uses the spritesheet when loaded; otherwise a procedural body.
  // opts: { scale, roll, shape }.
  // Blit a candy's art from the spritesheet (its COLORS `spriteRect` pixel box), fit aspect-
  // preserved into a `box`-sized square centered at (cx, cy). Returns false (so callers can fall
  // back to a procedural draw) if the sheet isn't ready or the color has no rect.
  _blitCandySprite(ctx, col, cx, cy, box) {
    if (!this.spritesReady || !col || !col.spriteRect) return false;
    const [sx, sy, sw, sh] = col.spriteRect;
    const s = box / Math.max(sw, sh);     // fit the longer side; candies are ~square so this reads centered
    const dw = sw * s, dh = sh * s;
    ctx.drawImage(this.sprites, sx, sy, sw, sh, cx - dw / 2, cy - dh / 2, dw, dh);
    return true;
  }

  _candy(ctx, x, y, r, col, opts = {}) {
    const { scale = 1, roll = null, shape = 'round', angle = 0, squash = null } = opts;
    r *= scale;
    // soft contact shadow grounds the candy on the belt / in its slot (stays level, not deformed)
    ctx.beginPath();
    ctx.ellipse(x + r * 0.12, y + r * 0.5, r * 0.82, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = RENDER.marbleShadow;
    ctx.fill();

    // sprite path: blit the candy's art from the sheet, sized so the body ≈ 2r. A rolling candy
    // rotates the whole sprite; a soft candy (jelly/cake) squashes — flattened along the impact
    // axis (`squash.amp` > 0 compress, < 0 stretch) and bulged across it (volume-ish preserved).
    if (angle || squash) {
      ctx.save();
      ctx.translate(x, y);
      if (squash) { ctx.rotate(squash.ang); ctx.scale(1 - squash.amp, 1 + squash.amp * 0.6); ctx.rotate(-squash.ang); }
      if (angle) ctx.rotate(angle);
      const ok = this._blitCandySprite(ctx, col, 0, 0, r * 2 * ART.candyFill);
      ctx.restore();
      if (ok) return;
    } else if (this._blitCandySprite(ctx, col, x, y, r * 2 * ART.candyFill)) return;

    // --- procedural fallback (only until the spritesheet loads) ---
    // body
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.42, r * 0.1, x, y, r * 1.15);
    g.addColorStop(0, col.light);
    g.addColorStop(0.5, col.base);
    g.addColorStop(1, col.dark);
    this._candyPath(ctx, x, y, r, shape);
    ctx.fillStyle = g;
    ctx.fill();
    // surface speckle that orbits with `roll` to read as rolling/spin (clipped to body)
    if (roll !== null) {
      ctx.save();
      this._candyPath(ctx, x, y, r * 0.98, shape);
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
    // glossy specular highlight (fixed to the light)
    ctx.beginPath();
    ctx.ellipse(x - r * 0.32, y - r * 0.4, r * 0.26, r * 0.18, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = RENDER.specular;
    ctx.fill();
    // outline
    this._candyPath(ctx, x, y, r * 0.99, shape);
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.stroke();
  }

  // Small, bright upward sparkle at a packet mouth when a candy is released.
  _sparkle(x, y, colorKey) {
    const col = COLORS[colorKey] || { light: '#fff' };
    const n = Math.round(RENDER.particleCount * 0.35);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6; // fan upward
      const sp = 60 + Math.random() * 120;
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: RENDER.particleLifeMs * 0.5 * (0.6 + Math.random() * 0.4), age: 0,
        r: 1.5 + Math.random() * 2, color: Math.random() < 0.5 ? '#fff' : (col.light || col.base),
      });
    }
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

  // ACTIVE render path: packet feeder (top) · center holding tray (middle) · jar queues (bottom) ·
  // candies on top. The conveyor methods below (_drawLoop / _drawBins / _drawMarbles / old
  // _drawPackets / _drawHud / _drawDebug) are kept DORMANT (uncalled).
  render(state, dt) {
    const ctx = this.ctx;
    const L = state.layout;
    if (!L) return;
    this.fps += ((1 / Math.max(dt, 1e-4)) - this.fps) * 0.1;

    if (this.bgReady) {
      // cover-fit the candy background (fill the viewport, preserve aspect, crop overflow)
      const iw = this.bgImg.naturalWidth, ih = this.bgImg.naturalHeight;
      const scale = Math.max(this.w / iw, this.h / ih);
      const dw = iw * scale, dh = ih * scale;
      ctx.drawImage(this.bgImg, (this.w - dw) / 2, (this.h - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = THEME.bg;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    this._drawDispenser(ctx, state);
    this._drawPacketsPuzzle(ctx, state);
    this._drawCenterBox(ctx, state);
    this._drawJarsPuzzle(ctx, state);
    this._drawCandies(ctx, state);
    this._drawJarLids(ctx, state);
    this._drawTransit(ctx, state);
    this._updateParticles(ctx, dt);
    this._drawVignette(ctx);
    this._drawHudPuzzle(ctx, state);
    if (this.debug) { this._drawDispenserDebug(ctx, state); this._drawDebugPuzzle(ctx, state); }
  }

  // Lightweight marble-sort-style HUD pills in the reserved top band: the level name
  // on the left, candies-remaining on the right. Placeholder only — no scoring system.
  _drawHud(ctx, state) {
    const L = state.layout;
    const band = L.hudH;
    if (!band) return;
    const cyP = band * 0.52;
    const padX = Math.max(L.w * 0.04, 12);
    const pillH = Math.min(band * 0.62, 36);
    const fontPx = Math.round(pillH * 0.42);
    ctx.font = `600 ${fontPx}px -apple-system, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';

    const pill = (text, anchorX, align) => {
      const tw = ctx.measureText(text).width;
      const w = tw + pillH * 1.0;
      const x = align === 'left' ? anchorX : anchorX - w;
      this._roundRect(ctx, x, cyP - pillH / 2, w, pillH, pillH / 2);
      ctx.fillStyle = 'rgba(20,24,33,0.66)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.stroke();
      ctx.fillStyle = THEME.text;
      ctx.textAlign = 'left';
      ctx.fillText(text, x + pillH * 0.5, cyP + 1);
    };

    const name = (state.levelDef && state.levelDef.name) || 'Level';
    pill(name.toUpperCase(), padX, 'left');
    pill(`★ ${state.marblesRemaining()}`, L.w - padX, 'right');
    ctx.textAlign = 'left';
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

    // candy-factory belt texture: dashed band that rides around with the belt
    ctx.save();
    ctx.translate(L.cx, L.cy);
    ctx.rotate(state.beltAngle);
    const dash = Math.max(6, L.R * 0.16);
    ctx.setLineDash([dash, dash]);
    ctx.beginPath();
    ctx.arc(0, 0, L.R, 0, Math.PI * 2);
    ctx.lineWidth = L.trackW * 0.62;
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

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

  // Draw a collection-tray BODY (frame-sheet | art | procedural) centered at (cx,cy), fit
  // to height `h`, at `alpha`. Frame sheets show `seatedCount` candies built in; `popScale`
  // is a transient settle-bounce on the frame. Returns true if a frame sheet was used (so
  // the caller knows the seated candies are already drawn and skips drawing them again).
  _drawTrayBody(ctx, col, cx, cy, h, alpha, seatedCount, capacity, popScale = 1) {
    const frames = this.trayFrameImgs[col.art];
    const art = this.trayImgs[col.art];
    if (imgReady(frames) && frames._frameBoxes) {
      this._drawTrayFrame(ctx, frames, seatedCount, cx, cy, h * ART.trayFill * popScale, alpha);
      return true;
    }
    if (imgReady(art)) {
      this._drawTrayArt(ctx, art, cx, cy, h * ART.trayFill, alpha);
      return false;
    }
    // --- procedural fallback (only until the tray art loads) ---
    const fw = h * 0.56;                 // approx tray aspect (the column box is wider)
    const fx = cx - fw / 2, y = cy - h / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    this._roundRect(ctx, fx, y, fw, h, 10);
    const g = ctx.createLinearGradient(fx, y, fx + fw, y);
    g.addColorStop(0, '#222732');
    g.addColorStop(1, '#171b23');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = col.base;
    ctx.stroke();
    this._roundRect(ctx, fx, y - 6, fw, 10, 4); // color cap
    ctx.fillStyle = col.base;
    ctx.fill();
    const spread = h * BIN.slotSpreadFrac, r = h * BIN.candyRadiusFrac;
    for (let s = 0; s < capacity; s++) {
      const t = capacity <= 1 ? 0 : (s / (capacity - 1)) * 2 - 1;
      ctx.beginPath();
      ctx.arc(cx, cy + t * spread, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.stroke();
    }
    ctx.restore();
    return false;
  }

  _drawBins(ctx, state, dt = 0) {
    const L = state.layout;
    // Per-tray slide smoothing: each tray eases its display position toward its layout
    // target, so when the queue shifts forward the whole line slides instead of snapping.
    // Tray OBJECTS are stable across a shift (a queued tray becomes the active tray — same
    // object), so we can carry _dx/_dy on the tray itself.
    const tau = (BIN.queue && BIN.queue.slideTauMs) || 90;
    const aSlide = 1 - Math.exp(-Math.max(dt, 0) * 1000 / tau);
    const place = (tray, tx, ty) => {
      if (tray._dx == null) { tray._dx = tx; tray._dy = ty; }
      else { tray._dx += (tx - tray._dx) * aSlide; tray._dy += (ty - tray._dy) * aSlide; }
    };

    for (let i = 0; i < state.bins.length; i++) {
      const slot = state.bins[i];
      const bl = L.bins[i];

      // QUEUE LINE: the upcoming trays for THIS slot, drawn FULL-SIZE and non-overlapping,
      // lined up outward from the active tray (a waiting line, not a stacked deck). Only the
      // ones the layout gave geometry for (those that fully fit on screen) are drawn; the
      // rest stay hidden until a front tray clears. They never show candies.
      const previews = slot.previewTrays || [];
      for (let k = previews.length - 1; k >= 0; k--) {
        const pg = bl.previews && bl.previews[k];
        const pt = previews[k];
        const pcol = pt && COLORS[pt.colorKey];
        if (!pg || !pcol) continue;
        place(pt, pg.x, pg.y);
        this._drawTrayBody(ctx, pcol, pt._dx, pt._dy, bl.h * pg.scale, pg.alpha, 0, pt.capacity);
      }

      // ACTIVE TRAY: the tray currently collecting candies for this slot. A slot whose
      // queue is exhausted has no active tray — draw nothing (it sits inactive).
      const tray = slot.activeTray;
      if (!tray) continue;
      place(tray, bl.x, bl.y);
      const ax = tray._dx, ay = tray._dy;
      const col = COLORS[tray.colorKey];
      const h = bl.h;
      const now = performance.now();

      // brief settle-pop when the seated count just changed (frame-sheet path)
      const last = tray.seated[tray.seated.length - 1];
      const lastAge = last ? now - last.pop : 1e9;
      let popScale = lastAge < 200 ? 1 + 0.05 * Math.sin((lastAge / 200) * Math.PI) : 1;
      let alpha = 1;

      if (tray.clearing) {
        // quick pop-OUT: a full tray scales up and fades as it clears (replaces the old
        // flicker). The BOX_CLEAR particle burst fires from state.js as this completes.
        const e = easeOut(clamp01(1 - (tray.clearAt - now) / BIN.clearHoldMs));
        popScale *= 1 + BIN.clearPopScale * e;
        alpha = 1 - e;
      }
      // NOTE: no pop-IN for the next tray — it's already full-size and visible in the queue
      // line; it just SLIDES from its preview slot into the active position (see place()).

      const usedFrames = this._drawTrayBody(
        ctx, col, ax, ay, h, alpha, tray.seated.length, tray.capacity, popScale);
      if (usedFrames) continue; // frame sheet already shows the seated candies

      // seated candies: cropped to content, sized to fill ~90% of THIS candy's groove
      // cavity (per-color), centered on the groove. Offset by any active-tray slide so the
      // candies travel with the tray body while it eases into position.
      const art = this.trayImgs[col.art];
      const trayAspect = (art && art._bbox) ? art._bbox.sw / art._bbox.sh : 0.75;
      const drawnW = h * trayAspect;
      const gv = col.groove || {};
      const grooveW = drawnW * (gv.w || BIN.grooveWidthFrac) * BIN.candyGrooveFill;
      const grooveH = h * (gv.h || BIN.grooveHeightFrac) * BIN.candyGrooveFill;
      const offX = ax - bl.x, offY = ay - bl.y;
      for (const m of tray.seated) {
        const sp = state.slotPos(bl, m.slot, tray.capacity);
        const age = performance.now() - m.pop;
        const pop = age < 220 ? 1 + 0.18 * Math.sin((age / 220) * Math.PI) : 1;
        this._seatCandy(ctx, col, sp.x + offX, sp.y + offY, grooveW, grooveH, pop);
      }
    }
  }

  // TOP PACKET FEEDER (Marble-Sort style): a light, machine-like panel across the top holding
  // a clean GRID of MONO-COLOR packet tiles. Each tile draws its color's CandyTrayPackets art
  // (a tray full of that one color's candies) + a remaining-count badge; the releasing tile
  // pulses; a slot whose queue has drained shows a faint empty well. First the panel, then the
  // tiles on top.
  _drawPackets(ctx, state) {
    const L = state.layout;
    const slots = state.packets.slots;
    this._drawFeederPanel(ctx, L.feeder);
    for (let i = 0; i < slots.length; i++) {
      const tl = L.packets[i];
      if (!tl) continue;
      const packet = slots[i].packet;
      if (!packet) { this._emptyPacket(ctx, tl); continue; }
      this._packetTile(ctx, tl, packet);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // The feeder housing: a soft, light rounded panel (the "machine input area") behind the grid,
  // with a slightly darker recessed inner well the tiles sit in.
  _drawFeederPanel(ctx, f) {
    if (!f) return;
    const rad = Math.min(f.w, f.h) * 0.12;
    // outer housing
    this._roundRect(ctx, f.x, f.y, f.w, f.h, rad);
    const g = ctx.createLinearGradient(f.x, f.y, f.x, f.y + f.h);
    g.addColorStop(0, 'rgba(126,140,166,0.34)');
    g.addColorStop(1, 'rgba(72,84,108,0.30)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.stroke();
    // recessed inner well
    const ix = f.x + f.pad * 0.45, iy = f.y + f.pad * 0.45;
    const iw = f.w - f.pad * 0.9, ih = f.h - f.pad * 0.9;
    this._roundRect(ctx, ix, iy, iw, ih, rad * 0.8);
    ctx.fillStyle = 'rgba(20,26,38,0.22)';
    ctx.fill();
  }

  // A faint recessed well for a slot whose packet queue is exhausted (no packet to show).
  _emptyPacket(ctx, tl) {
    const w = tl.r * 2.0, x = tl.x - tl.r, y = tl.y - tl.r;
    this._roundRect(ctx, x, y, w, w, w * 0.2);
    ctx.fillStyle = 'rgba(12,16,24,0.28)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.stroke();
  }

  // One MONO-COLOR packet tile: its color's CandyTrayPackets art (fallback: a clean light tray
  // with that color's candies in a grid) + a remaining-count badge. `packet.state==='releasing'`
  // adds a bright pulsing rim so the player sees which packet is currently emptying.
  _packetTile(ctx, tl, packet) {
    const col = COLORS[packet.color];
    const remaining = Math.max(0, packet.count - packet.releasedCount);
    const releasing = packet.state === 'releasing';
    const box = tl.r * 2;

    // releasing pulse: a soft glowing rounded backing behind the tile
    if (releasing) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 110);
      ctx.save();
      this._roundRect(ctx, tl.x - tl.r - 2, tl.y - tl.r - 2, box + 4, box + 4, box * 0.22);
      ctx.fillStyle = `rgba(255,236,170,${0.18 + 0.22 * pulse})`;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(255,236,170,${0.5 + 0.4 * pulse})`;
      ctx.stroke();
      ctx.restore();
    }

    const art = this.packetImgs[col && col.art];
    if (imgReady(art)) {
      // fit the cropped tray art within the tile box, preserving aspect, centered
      this._drawFitContain(ctx, art, tl.x, tl.y, box * 0.98, 1);
    } else {
      this._packetTileFallback(ctx, tl, col, remaining);
    }

    // remaining-count badge (top-right corner of the tile)
    const bx = tl.x + tl.r - tl.r * 0.18, by = tl.y - tl.r + tl.r * 0.18;
    const br = Math.max(8, tl.r * 0.34);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = THEME.text;
    ctx.font = `600 ${Math.round(br * 1.15)}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(remaining), bx, by + 1);
  }

  // Draw a cropped image's content, preserving aspect, fit WITHIN a box of side `box`,
  // centered at (cx, cy).
  _drawFitContain(ctx, im, cx, cy, box, alpha = 1) {
    const bb = im._bbox || { sx: 0, sy: 0, sw: im.naturalWidth, sh: im.naturalHeight };
    const a = bb.sw / bb.sh;
    const dw = a >= 1 ? box : box * a;
    const dh = a >= 1 ? box / a : box;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(im, bb.sx, bb.sy, bb.sw, bb.sh, cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.restore();
  }

  // Procedural mono-color packet tile, used only until the tray art loads: a light rounded
  // tray with a recessed well and that one color's candies laid out in a neat grid.
  _packetTileFallback(ctx, tl, col, remaining) {
    const c = col || { base: '#9aa6bd', light: '#c6cfde', dark: '#5a647a', shape: 'round' };
    const w = tl.r * 2, x = tl.x - tl.r, y = tl.y - tl.r, rad = tl.r * 0.22;
    // tray body tinted by the color
    this._roundRect(ctx, x, y, w, w, rad);
    const g = ctx.createLinearGradient(x, y, x, y + w);
    g.addColorStop(0, c.light);
    g.addColorStop(1, c.base);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.dark;
    ctx.stroke();
    // recessed well
    const inset = tl.r * 0.16;
    this._roundRect(ctx, x + inset, y + inset, w - inset * 2, w - inset * 2, rad * 0.7);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fill();
    // mono-color candies in a grid (count = remaining, capped for sanity)
    const show = Math.min(remaining, PACKET.fallbackMaxCandies);
    if (show > 0) {
      const cols = show <= 1 ? 1 : show <= 4 ? 2 : 3;
      const rows = Math.ceil(show / cols);
      const cell = (w - inset * 2) / Math.max(cols, rows);
      const miniR = cell * 0.4;
      const gw = cols * cell, gh = rows * cell;
      const ox = tl.x - gw / 2 + cell / 2, oy = tl.y - gh / 2 + cell / 2;
      for (let k = 0; k < show; k++) {
        const cc = k % cols, rr = Math.floor(k / cols);
        this._candy(ctx, ox + cc * cell, oy + rr * cell, miniR, c, { shape: c.shape });
      }
    }
  }

  _drawMarbles(ctx, state) {
    const L = state.layout;
    for (const m of state.marbles) {
      const col = COLORS[m.colorKey];
      const shape = col.shape;
      if (m.state === 'riding') {
        const rr = m.rr || L.R;
        const x = L.cx + Math.cos(m.angle) * rr;
        const y = L.cy + Math.sin(m.angle) * rr;
        this._candy(ctx, x, y, L.marbleR, col, { roll: m.roll, shape });
      } else {
        // entering (falling onto loop) or dropping (falling into bin)
        const squash = m.state === 'dropping' ? 1 - 0.12 * Math.sin(m.t * Math.PI) : 1;
        this._candy(ctx, m.x, m.y, L.marbleR, col, { scale: squash, shape });
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
    // a heavy dark vignette would muddy the bright candy background — keep it gentle there
    g.addColorStop(1, this.bgReady ? 'rgba(0,0,0,0.16)' : THEME.bgVignette);
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
    ctx.fillText(`candies  ${beltN} / ${RULES.loopCapacity}`, 22, 40);
    ctx.fillText(`ω        ${omega.toFixed(2)} rad/s`, 22, 60);
    const seat = state && state.canSeat;
    ctx.fillStyle = seat ? '#9fe8b0' : '#e8855f';
    ctx.fillText(`seating  ${seat ? 'ON (auto-flow)' : 'OFF (spinning)'}`, 22, 80);
    ctx.restore();
  }

  // ======================================================================
  //  PUZZLE render path (packet -> center -> jars / tray). Reuses the candy,
  //  particle, feeder-panel and art primitives above.
  // ======================================================================

  // ---- small shared primitives ----
  _glassBox(ctx, x, y, w, h, rad, c0, c1, stroke) {
    this._roundRect(ctx, x, y, w, h, rad);
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, c0);
    g.addColorStop(1, c1);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }

  _ghostSlot(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.stroke();
  }

  // ---- the dispenser frame (drawn to exactly fill its layout box so colliders line up) ----
  _drawDispenser(ctx, state) {
    const d = state.layout.dispenser;
    if (!d) return;
    const b = d.box;
    if (this.dispenserReady) {
      ctx.drawImage(this.dispenserImg, b.x, b.y, b.w, b.h);
    } else {
      // placeholder until the PNG loads
      this._roundRect(ctx, b.x, b.y, b.w, b.h, Math.min(b.w, b.h) * 0.08);
      ctx.fillStyle = 'rgba(120,110,80,0.18)';
      ctx.fill();
    }
  }

  // ---- candy rack inside the dispenser's inner rectangle (one candy per cell) ----
  _drawPacketsPuzzle(ctx, state) {
    const L = state.layout;
    const slots = state.packets.slots;
    for (let i = 0; i < slots.length; i++) {
      const tl = L.packets[i];
      if (!tl) continue;
      const color = slots[i].color;
      if (!color) continue; // empty cell — nothing drawn (the rack thins out as candies fall)
      const col = COLORS[color];
      const box = tl.r * 2;
      // a candy still BEHIND another (blocked by the dispenser-stack rule) is dimmed, so the
      // tappable front-row candies read as the live ones.
      ctx.globalAlpha = state._dispenseBlocked(i) ? 0.42 : 1;
      // each cell IS a candy: blit its art (procedural candy stands in until the sheet loads)
      if (!this._blitCandySprite(ctx, col, tl.x, tl.y, box * 0.98)) {
        this._candy(ctx, tl.x, tl.y, tl.r * 0.82, col, { shape: col && col.shape });
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---- center holding container ----
  _drawCenterBox(ctx, state) {
    const b = state.layout.center;
    const x = b.x - b.w / 2, y = b.y - b.h / 2;
    if (this.holdingTrayReady) {
      // newholdingtray.png has wide transparent margins — blit only its opaque tray region
      // (CENTER.artCrop) so the open tray fills the box. Candies pile on its floor (no grooves).
      const img = this.holdingTrayImg, iw = img.naturalWidth, ih = img.naturalHeight, C = CENTER.artCrop;
      ctx.drawImage(img, C.x * iw, C.y * ih, C.w * iw, C.h * ih, x, y, b.w, b.h);
      return;
    }
    // procedural fallback: a shallow open tray (no wells — candies settle naturally on the floor)
    const rad = Math.min(b.w, b.h) * 0.14;
    this._glassBox(ctx, x, y, b.w, b.h, rad, 'rgba(120,140,170,0.20)', 'rgba(60,72,96,0.16)', 'rgba(255,255,255,0.22)');
    const ip = b.pad * 0.5;
    this._roundRect(ctx, x + ip, y + ip, b.w - 2 * ip, b.h - 2 * ip, rad * 0.78);
    ctx.fillStyle = 'rgba(12,16,24,0.30)';
    ctx.fill();
  }

  // ---- bottom jars ----
  // Source rect (px) of a Jar/jars.png frame given its fractional box.
  _jarSrc(frame) {
    const im = this.jarImg, iw = im.naturalWidth, ih = im.naturalHeight;
    return [frame.x * iw, frame.y * ih, frame.w * iw, frame.h * ih];
  }

  // Closing-animation state for a completed jar (null if it isn't completing). `lidCy` is the
  // descending lid's centre Y, `alpha` fades the jar out at the end, `scale` gives a soft pop.
  _jarClose(state, jar, bl) {
    if (!jar.complete) return null;
    const d = JAR.close;
    const t = state._time - (jar._clearStart || 0);
    const drop = clamp01(t / d.lidDropMs);
    const ed = 1 - Math.pow(1 - drop, 3); // ease-out
    const fade = clamp01((t - d.lidDropMs - d.holdMs) / d.fadeMs);
    const jarTop = bl.y - bl.h / 2;
    const restCy = jarTop + bl.h * 0.16;   // where the lid seats over the rim
    const startCy = restCy - bl.h * 0.75;  // drops from above
    return { lidCy: startCy + (restCy - startCy) * ed, alpha: 1 - fade, scale: 1 + 0.1 * fade };
  }

  _drawJarsPuzzle(ctx, state) {
    const geom = state.layout.jarQueue;
    if (!geom) return;
    // Each lane is a queue: draw up to maxVisible jars, the front (slot 0) at the bottom. Draw
    // BACK-TO-FRONT so the larger, opaque active jar sits on top of its previews.
    for (let lane = 0; lane < geom.laneCount; lane++) {
      const visible = state.jars.lanes[lane].filter((j) => !j.removed).slice(0, geom.maxVisible);
      for (let s = visible.length - 1; s >= 0; s--) this._drawOneJar(ctx, state, visible[s]);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // Draw a single jar of a queue lane. The front (active) jar is full size + opaque with a fading
  // target indicator; preview jars are scaled + faded and show only the body + a color indicator
  // (so the player can read the upcoming colors). Candies pile at the bottom — no wells, no count.
  _drawOneJar(ctx, state, jar) {
    const bl = state._jarBox(jar);
    const col = COLORS[jar.colorKey] || { base: '#888' };
    const close = this._jarClose(state, jar, bl);
    const baseA = jar._previewAlpha != null ? jar._previewAlpha : 1;
    const preview = (jar._slot || 0) > 0;
    const alpha = (close ? close.alpha : 1) * baseA;
    const sc = close ? close.scale : 1;

    // jar BODY (open-jar frame), centred + scaled for the pop, faded for previews / on removal
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(bl.x, bl.y);
    ctx.scale(sc, sc);
    if (this.jarReady) {
      ctx.drawImage(this.jarImg, ...this._jarSrc(JAR.sheet.open), -bl.w / 2, -bl.h / 2, bl.w, bl.h);
    } else {
      const rad = Math.min(bl.w, bl.h) * 0.16;
      this._roundRect(ctx, -bl.w / 2, -bl.h / 2, bl.w, bl.h, rad);
      ctx.fillStyle = 'rgba(150,200,230,0.30)';
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    if (jar.complete) return; // sealing: no ghost wells / indicator / count

    // glass-bowl geometry (where candies + the target indicator live)
    const gl = state._jarGlass(jar);
    // TARGET INDICATOR: a ghosted candy of the jar's color — shown on EVERY visible jar so the
    // upcoming queue colors are readable; on the active jar it fades as the jar fills.
    const fillFrac = jar.candies.length / Math.max(1, jar.capacity);
    const indR = Math.min(gl.gw, gl.gh) * 0.34;
    ctx.globalAlpha = (preview ? 0.7 : 0.55 * (1 - fillFrac)) * baseA;
    if (ctx.globalAlpha > 0.02) this._candy(ctx, gl.cx, gl.cy, indR, col, { shape: col.shape });
    ctx.globalAlpha = 1;

    // active jar: just the body + fading color indicator; candies fall in and rest at the bottom
    // (no capacity wells, no fill count).
  }

  // ---- jar lids (closing animation), drawn AFTER candies so the lid covers the sealed candies ----
  _drawJarLids(ctx, state) {
    if (!this.jarReady) return;
    for (let i = 0; i < state.jars.jars.length; i++) {
      const jar = state.jars.jars[i];
      if (!jar.complete || jar.removed) continue;
      const bl = state._jarBox(jar);
      const close = this._jarClose(state, jar, bl);
      const src = this._jarSrc(JAR.sheet.lid);
      const lidW = bl.w * 1.06;
      const lidH = lidW * (src[3] / src[2]); // preserve the lid's aspect
      ctx.save();
      ctx.globalAlpha = close.alpha;
      ctx.translate(bl.x, close.lidCy);
      ctx.scale(close.scale, close.scale);
      ctx.drawImage(this.jarImg, ...src, -lidW / 2, -lidH / 2, lidW, lidH);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // Render-time soft-body deformation for a candy. With a wobbleFreq it OSCILLATES squash↔stretch
  // (signed cosine of wPhase: starts compressed at impact, then a damped rebound/jiggle); without
  // one it's a pure compression that relaxes. null if not deforming.
  _squashOf(c) {
    if (!c || !c.wAmp) return null;
    const k = c.wobbleFreq ? c.wAmp * Math.cos(c.wPhase || 0) : c.wAmp;
    if (Math.abs(k) < 0.004) return null;
    return { amp: k, ang: c.wAng || 0 };
  }

  // ---- candies (resting then animating, so movers draw on top) ----
  _drawCandies(ctx, state) {
    const all = state._allCandies();
    const draw = (c) => {
      // candies sealed inside a removed jar are gone; ones in a closing jar fade with it
      if (c.where === 'jar' && c.jar) {
        if (c.jar.removed) return;
        if (c.jar.complete) {
          const close = this._jarClose(state, c.jar, state._jarBox(c.jar));
          ctx.globalAlpha = close ? close.alpha : 1;
        }
      }
      const p = state.candyScreenPos(c);
      const r = state.candyRadius(c);
      const col = COLORS[c.colorKey];
      // resting center candies keep the orientation they tumbled to (restAngle) + finish any landing
      // jiggle/squash; jar/tray candies sit upright and undeformed.
      const sq = c.where === 'center' ? this._squashOf(c) : null;
      if (col) this._candy(ctx, p.x, p.y, r, col, { scale: state.candyPop(c), shape: col.shape, angle: c.restAngle || 0, squash: sq });
      ctx.globalAlpha = 1;
    };
    for (const c of all) if (!c.anim) draw(c);
    for (const c of all) if (c.anim) draw(c);
  }

  // ---- candies spilling through the dispenser (physics transit objects) ----
  _drawTransit(ctx, state) {
    for (const c of state.transit) {
      const col = COLORS[c.colorKey];
      if (!col) continue;
      this._candy(ctx, c.x, c.y, c.r, col, { shape: col.shape, angle: c.angle || 0, squash: this._squashOf(c) });
    }
  }

  // ---- debug: stroke the dispenser colliders so the DISPENSER fractions can be tuned ----
  _drawDispenserDebug(ctx, state) {
    const d = state.layout.dispenser;
    if (!d) return;
    const C = d.colliders, IR = C.innerRect;
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(80,230,140,0.85)';
    ctx.strokeRect(IR.left, IR.top, IR.right - IR.left, IR.bottom - IR.top);
    ctx.strokeStyle = 'rgba(255,120,120,0.9)';
    ctx.beginPath();
    ctx.moveTo(IR.left, C.funnelTopY); ctx.lineTo(C.pathLeft, C.funnelBotY);   // left slant
    ctx.moveTo(IR.right, C.funnelTopY); ctx.lineTo(C.pathRight, C.funnelBotY); // right slant
    ctx.moveTo(C.pathLeft, C.funnelBotY); ctx.lineTo(C.pathLeft, C.exitY);     // chute walls
    ctx.moveTo(C.pathRight, C.funnelBotY); ctx.lineTo(C.pathRight, C.exitY);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,180,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(C.pathLeft, C.exitY); ctx.lineTo(C.pathRight, C.exitY);         // exit line
    ctx.stroke();
    ctx.restore();
  }

  // ---- HUD (level name + candies-to-sort) ----
  _drawHudPuzzle(ctx, state) {
    const L = state.layout;
    const band = L.hudH;
    if (!band) return;
    const cyP = band * 0.52;
    const padX = Math.max(L.w * 0.04, 12);
    const pillH = Math.min(band * 0.62, 36);
    const fontPx = Math.round(pillH * 0.42);
    ctx.font = `600 ${fontPx}px -apple-system, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const pill = (text, anchorX, align) => {
      const tw = ctx.measureText(text).width;
      const w = tw + pillH * 1.0;
      const x = align === 'left' ? anchorX : anchorX - w;
      this._roundRect(ctx, x, cyP - pillH / 2, w, pillH, pillH / 2);
      ctx.fillStyle = 'rgba(20,24,33,0.66)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.stroke();
      ctx.fillStyle = THEME.text;
      ctx.textAlign = 'left';
      ctx.fillText(text, x + pillH * 0.5, cyP + 1);
    };
    const name = (state.levelDef && state.levelDef.name) || 'Level';
    pill(name.toUpperCase(), padX, 'left');
    pill(`★ ${state.candiesToSort()}`, L.w - padX, 'right');
    ctx.textAlign = 'left';
  }

  _drawDebugPuzzle(ctx, state) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    this._roundRect(ctx, 10, 10, 210, 90, 8);
    ctx.fill();
    ctx.fillStyle = '#9fe8b0';
    ctx.font = '600 13px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(`FPS       ${this.fps.toFixed(0)}`, 22, 20);
    ctx.fillText(`to sort   ${state.candiesToSort()}`, 22, 40);
    ctx.fillText(`center    ${state.center.count()}/${state.center.capacity}`, 22, 60);
    ctx.fillText(`phase     ${state.phase}`, 22, 80);
    ctx.restore();
  }
}
