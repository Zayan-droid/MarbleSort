// Headless smoke test: angular-track model + radial physics + dump-all release.
import { GameState } from './src/game/state.js';
import { bus, EV } from './src/core/events.js';
import { DIAL, BIN, RULES, SEAT } from './src/config.js';

// Bin-clear hold is a wall-clock timer (correct in-game); neutralize for the fast sim.
BIN.clearHoldMs = 0;

const counts = { clink: 0, seat: 0, clear: 0, drop: 0, win: 0, lose: 0, warn: 0 };
bus.on(EV.MARBLE_CLINK, () => counts.clink++);
bus.on(EV.MARBLE_SEAT, () => counts.seat++);
bus.on(EV.BOX_CLEAR, () => counts.clear++);
bus.on(EV.MARBLE_DROP, () => counts.drop++);
bus.on(EV.GAME_WIN, () => counts.win++);
bus.on(EV.GAME_LOSE, () => counts.lose++);
bus.on(EV.JAM_WARNING, () => counts.warn++);

const dt = 1 / 60;
let ok = true;
const fail = (msg) => { console.error('FAIL:', msg); ok = false; };

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function channelEscape(state) {
  let worst = 0;
  for (const m of state.marbles) {
    if (m.state !== 'riding') continue;
    const over = Math.max(0, m.rr - (state.layout.outerR - state.layout.marbleR + 0.5),
      (state.layout.innerR + state.layout.marbleR - 0.5) - m.rr);
    worst = Math.max(worst, over);
  }
  return worst;
}

// ---- Part 1: dump one tray at a time (whole stack) -> ride -> seat -> WIN ----
{
  const state = new GameState();
  state.resize(900, 1000);
  const omega = DIAL.baseSpeed; // calm: not "spinning", so queued dumps place
  const total = state.trays.reduce((n, t) => n + t.stack.length, 0);

  // change-1 contract: tapping dumps the WHOLE stack at once (not one ball)
  state.tapTray(0);
  state.update(dt, omega, false);
  if (state.marbles.length !== state.levelDef.trays[0].length) {
    fail(`tap did not dump the whole tray (placed ${state.marbles.length})`);
  }

  let trayPtr = 0, maxTravel = 0, maxEscape = 0, maxDropOff = 0;
  const entry = new Map();
  for (let f = 0; f < 60 * 300; f++) {
    state.update(dt, omega, false);
    maxEscape = Math.max(maxEscape, channelEscape(state));
    for (const m of state.marbles) {
      if (m.state === 'riding') {
        if (!entry.has(m.id)) entry.set(m.id, m.angle);
        let d = Math.abs(m.angle - entry.get(m.id));
        d = Math.min(d, Math.PI * 2 - d);
        maxTravel = Math.max(maxTravel, d);
      } else if (m.state === 'dropping') {
        // the rendered position must stay on the detach->bin path; a stale entry
        // point would put it far off-segment (the one-frame opposite-side ghost)
        maxDropOff = Math.max(maxDropOff, distToSeg(m.x, m.y, m.fromX, m.fromY, m.toX, m.toY));
      }
    }
    // when the loop has drained, dump the next non-empty tray
    if (state.marbles.length === 0) {
      while (trayPtr < state.trays.length && state.trays[trayPtr].stack.length === 0) trayPtr++;
      if (trayPtr < state.trays.length) state.tapTray(trayPtr);
    }
    if (state.phase !== 'playing') { console.log(`part1 ended f=${f} (${(f * dt).toFixed(1)}s) phase=${state.phase}`); break; }
  }
  console.log('events:', counts);
  console.log('max ride before seating:', maxTravel.toFixed(2), 'rad | max channel escape:', maxEscape.toFixed(2), 'px');
  console.log('max drop-off render offset (ghost check):', maxDropOff.toFixed(2), 'px');
  if (maxDropOff > 1) fail(`a dropping ball rendered ${maxDropOff.toFixed(1)}px off its path (opposite-side ghost)`);
  if (counts.drop !== total) fail(`dropped ${counts.drop}/${total}`);
  if (counts.seat !== total) fail(`seated ${counts.seat}/${total}`);
  if (counts.clear === 0) fail('no bin cleared');
  if (maxTravel < 0.8) fail('marbles did not visibly ride');
  if (counts.win !== 1) fail('did not win');
  if (maxEscape > 0.6) fail(`a ball left the channel by ${maxEscape.toFixed(2)}px`);
}

// ---- Part 2: spin gate (place only after calm) + centrifugal fling-out ------
{
  const state = new GameState();
  state.resize(900, 1000);
  // queue two trays, then SPIN: nothing should place while spinning
  state.tapTray(0);
  state.tapTray(1);
  const omegaFast = DIAL.maxSpeed * 0.8;
  for (let f = 0; f < 60 * 1.0; f++) state.update(dt, omegaFast, true); // actively spinning
  if (state.marbles.length !== 0) fail(`balls placed while spinning (${state.marbles.length} on loop)`);

  // stop spinning; balls must NOT place until ~placeDelay of calm has passed.
  // (placeDelay is wall-clock; here we just confirm they DO place once calm.)
  let placed = 0;
  for (let f = 0; f < 60 * 2.0; f++) {
    state.update(dt, DIAL.baseSpeed, false);
    placed = Math.max(placed, state.marbles.length + state.bins.reduce((n, b) => n + b.filled, 0));
  }
  if (placed === 0) fail('balls never placed after spinning stopped');

  // now spin fast again and confirm centrifugal fling-out, still clamped
  let maxRr = 0, maxEscape = 0;
  const L = state.layout;
  const room = (L.outerR - L.marbleR) - L.R;
  for (let f = 0; f < 60 * 2; f++) {
    state.update(dt, omegaFast, true);
    maxEscape = Math.max(maxEscape, channelEscape(state));
    for (const m of state.marbles) if (m.state === 'riding') maxRr = Math.max(maxRr, m.rr);
  }
  const flung = maxRr - L.R;
  console.log(`part2 gate+fling: placed-while-spinning=0 ok | max outward ${flung.toFixed(1)}px of ${room.toFixed(1)}px | escape ${maxEscape.toFixed(2)}px`);
  if (maxRr > 0 && flung < room * 0.5) fail('balls did not fling outward under fast spin');
  if (maxEscape > 0.6) fail(`fast spin ejected a ball by ${maxEscape.toFixed(2)}px`);
}

// ---- Part 4: drop-off gate (no seating while spinning; only 1s after auto-flow) --
{
  const state = new GameState();
  state.resize(900, 1000);
  const base = DIAL.baseSpeed * DIAL.baseDirection;

  // place a tray's worth of balls (release gate opens after ~0.5s of calm)
  state.tapTray(0);
  for (let f = 0; f < 48; f++) state.update(dt, base, false);

  // Phase A: spin HARD for 2s — balls pass their bin repeatedly but must NOT seat
  const sA = counts.seat;
  for (let f = 0; f < 120; f++) state.update(dt, DIAL.maxSpeed, true);
  const seatsWhileSpinning = counts.seat - sA;

  // Phase B: belt resumes auto-flow — seating must start only after the 1s gate
  const sB = counts.seat;
  const tB = state._time;
  let firstSeatDelay = -1;
  for (let f = 0; f < 60 * 16; f++) {
    state.update(dt, base, false);
    if (firstSeatDelay < 0 && counts.seat > sB) firstSeatDelay = state._time - tB;
  }
  const seatsInB = counts.seat - sB;
  console.log(`part4 gate: seats-while-spinning=${seatsWhileSpinning}, first-seat-after-autoflow=${firstSeatDelay.toFixed(0)}ms (gate ${SEAT.autoFlowDelayMs}ms), seats-in-autoflow=${seatsInB}`);
  if (seatsWhileSpinning !== 0) fail(`a ball seated while spinning (${seatsWhileSpinning})`);
  if (seatsInB === 0) fail('no ball seated even after auto-flow resumed');
  if (firstSeatDelay >= 0 && firstSeatDelay < SEAT.autoFlowDelayMs - 20) {
    fail(`ball seated ${firstSeatDelay.toFixed(0)}ms after auto-flow (< ${SEAT.autoFlowDelayMs}ms gate)`);
  }
}

// ---- Part 3: responsive layout across sizes / aspect ratios ----------------
{
  const state = new GameState();
  const sizes = [
    [320, 480], [360, 640], [390, 844], [414, 896],
    [640, 360], [844, 390], [896, 414],
    [768, 1024], [1024, 768], [820, 1180],
    [1280, 800], [1440, 900], [1920, 1080],
    [1080, 1920], [2560, 1080], [3440, 1440],
  ];
  let worst = '';
  for (const [w, h] of sizes) {
    const L = state.resize(w, h);
    const tol = 1.0;
    const checks = [
      ['R sane', L.R > 20 && Number.isFinite(L.R)],
      ['loop in screen X', L.cx - L.outerR >= -tol && L.cx + L.outerR <= w + tol],
      ['loop in screen Y', L.cy - L.outerR >= -tol && L.cy + L.outerR <= h + tol],
      ['loop clears tray row', L.cy - L.outerR >= L.trayRowY - tol],
      ['loop clears bin row', L.cy + L.outerR <= L.binRowY + tol],
      ['channel has radial room', L.trackW - 2 * L.marbleR > 1],
      ['trays on screen', L.trays.every((t) => t.x - t.r >= -tol && t.x + t.r <= w + tol && t.y > 0 && t.y < h)],
      ['bins on screen', L.bins.every((b) => b.x - b.r >= -tol && b.x + b.r <= w + tol && b.y > 0 && b.y < h)],
    ];
    for (const [name, pass] of checks) if (!pass) { worst = `${w}x${h}: ${name}`; fail(`layout @ ${w}x${h}: ${name}`); }
  }
  console.log(`part3 responsive: ${sizes.length} sizes checked` + (worst ? ` (first failure ${worst})` : ' — all valid'));
}

console.log(ok ? 'SMOKE TEST OK' : 'SMOKE TEST FAILED');
process.exit(ok ? 0 : 1);
