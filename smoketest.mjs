// Headless smoke test for the candy-rack -> dispenser funnel -> tray -> jars / storage puzzle.
// Drives the real PuzzleGame (no browser APIs) and asserts: ONE TAP DROPS ONE CANDY (no teleport,
// the tray pipeline caps at the center capacity), candies tumble + PILE in the tray, then AUTO-
// ROUTE (matching candies flow into a jar, or park in the storage tray when no jar takes them, and
// a placeable parked group auto-retrieves), the full win loop, stuck detection, level validation,
// and responsive layout. Exits non-zero on failure.

import { PuzzleGame } from './src/game/puzzle.js';
import { validateLevel } from './src/game/levelValidator.js';
import { bus, EV } from './src/core/events.js';
import { LEVELS, DISPENSER, SCORING, CENTER } from './src/config.js';

const counts = { clink: 0, seat: 0, clear: 0, release: 0, win: 0, lose: 0, invalid: 0 };
const resetCounts = () => Object.keys(counts).forEach((k) => { counts[k] = 0; });
bus.on(EV.MARBLE_CLINK, () => counts.clink++);
bus.on(EV.MARBLE_SEAT, () => counts.seat++);
bus.on(EV.BOX_CLEAR, () => counts.clear++);
bus.on(EV.CANDY_RELEASE, () => counts.release++);
bus.on(EV.GAME_WIN, () => counts.win++);
bus.on(EV.GAME_LOSE, () => counts.lose++);
bus.on(EV.MOVE_INVALID, () => counts.invalid++);

// FEEL-LAYER metadata on BOX_CLEAR (additive — must NOT change event counts or win/lose). Tracks the
// combo/clutch/multiplier fields so we can assert the cascade carries escalating combo metadata.
const feel = { payloads: 0, maxCombo: 0, badIndex: false, maxPourStreak: 0, maxRowStreak: 0 };
const resetFeel = () => { feel.payloads = 0; feel.maxCombo = 0; feel.badIndex = false; feel.maxPourStreak = 0; feel.maxRowStreak = 0; };
bus.on(EV.BOX_CLEAR, (p) => {
  feel.payloads++;
  const ci = p.comboIndex;
  if (!Number.isInteger(ci) || ci < 1 || ci > SCORING.combo.maxLink) feel.badIndex = true;
  else feel.maxCombo = Math.max(feel.maxCombo, ci);
  if (Number.isInteger(p.pourStreak)) feel.maxPourStreak = Math.max(feel.maxPourStreak, p.pourStreak);
  if (Number.isInteger(p.rowStreak)) feel.maxRowStreak = Math.max(feel.maxRowStreak, p.rowStreak);
});

const dt = 1 / 60;
let ok = true;
const fail = (msg) => { console.error('FAIL:', msg); ok = false; };

// Step update() until the table is QUIESCENT (idle AND auto-routing has nothing left to do) or
// game over. Auto-routing fires a beat (ANIM.autoRouteDelayMs) AFTER the table goes idle, so we
// must keep stepping through idle frames — only return once idle has held long enough that no
// further auto-route move is pending.
function settle(state, max = 9000) {
  let stable = 0;
  for (let i = 0; i < max; i++) {
    state.update(dt);
    if (state.phase !== 'playing') return;
    if (state._idle()) { if (++stable > 40) return; } else stable = 0;
  }
}

// Tap ONE currently-tappable (front-of-column) candy if the tray pipeline has room. Returns true
// if a candy dropped. The front-first rule means only the candies with nothing in front of them
// (state.tappableSlots()) can be dispensed.
function tapFront(state) {
  if (state.transit.length + state.center.count() >= state.center.capacity) return false;
  const t = state.tappableSlots();
  return t.length ? state.onPacketTapped(t[0]) : false;
}

// SMART play (models a competent player with no storage buffer): drop only a candy whose color an
// ACTIVE jar can still take, beyond what's already heading there — so the center never fills with
// candies no jar will accept. Falls back to a plain front tap only when nothing routable is
// available (a deliberate "wait" move) so the loop can always make progress.
function activeRoom(state, color) {
  let room = 0;
  for (const j of state.jars.activeJars()) if (j.colorKey === color) room += state.jars.roomIn(j);
  return room;
}
function committed(state, color) {
  let n = 0;
  for (const c of state.transit) if (c.colorKey === color) n++;
  for (const c of state.center.candies) if (c.colorKey === color) n++;
  return n;
}
function tapSmart(state) {
  if (state.transit.length + state.center.count() >= state.center.capacity) return false;
  for (const i of state.tappableSlots()) {
    const color = state.packets.slots[i].color;
    if (activeRoom(state, color) - committed(state, color) > 0) return state.onPacketTapped(i);
  }
  return false;
}

// A dedicated ALL-ROUTABLE level for the dispenser/pipeline mechanic tests (partA, partC): its four
// lane fronts are four DIFFERENT colors AND each color's active jar is roomy (capacity 8), so EVERY
// front-row candy has an active jar and a full tray (up to 6) of ANY colour mix auto-routes the
// moment it settles — regardless of how the rack grid interleaves colours. This keeps partA/partC
// testing the funnel + pipeline + auto-route mechanic independent of the SHIPPED level 0, which
// deliberately leaves some colours unroutable (buffered) — that buffering behaviour is covered by
// partB/partE/partJ instead. (One jar per colour, one per lane, so all four are active at once.)
const ROUTABLE_LEVEL = {
  name: 'Routable (mechanic test)',
  packetSlots: 6,
  packets: [
    { color: 'red', count: 8 }, { color: 'yellow', count: 8 },
    { color: 'blue', count: 8 }, { color: 'green', count: 8 },
  ],
  jars: [
    { color: 'red',    capacity: 8 }, { color: 'yellow', capacity: 8 },
    { color: 'blue',   capacity: 8 }, { color: 'green',  capacity: 8 },
  ],
  centerContainer: { capacity: 6 },
};
const ROUTABLE_IX = LEVELS.push(ROUTABLE_LEVEL) - 1;

// ---- Part A: ONE tap drops ONE candy; the tray pipeline caps at the center capacity ----
{
  resetCounts();
  const state = new PuzzleGame();
  state.loadLevel(ROUTABLE_IX);
  state.resize(900, 1000);

  const first = state.tappableSlots()[0];
  if (first === undefined) fail('partA: there should be tappable (front) candies');
  if (!state.onPacketTapped(first)) fail('partA: a front candy should drop');
  if (state.center.count() !== 0) fail('partA: candy TELEPORTED into the center on tap');
  if (state.transit.length !== 1) fail(`partA: one tap should drop exactly 1 candy, got ${state.transit.length}`);
  if (counts.release !== 1) fail(`partA: expected 1 CANDY_RELEASE, got ${counts.release}`);
  // a candy still BEHIND another cannot be tapped
  const blocked = state.packets.slots.findIndex((s, i) => s.color && state._dispenseBlocked(i));
  if (blocked >= 0 && state.onPacketTapped(blocked) !== false) fail('partA: a candy behind another must not be tappable');
  // you may rain several down at once — but only up to the holding tray's capacity in flight
  let dropped = 1;
  while (tapFront(state)) dropped++;
  if (dropped !== state.center.capacity) fail(`partA: pipeline should cap at center capacity ${state.center.capacity}, dropped ${dropped}`);
  if (state.transit.length !== state.center.capacity) fail(`partA: ${state.center.capacity} candies should be in flight, got ${state.transit.length}`);

  // they funnel in over time (a genuine in-flight phase), PILE in the tray (peaking at capacity),
  // then AUTO-ROUTE drains them into their matching jars.
  let sawInFlight = false, maxCenter = 0, stable = 0;
  for (let i = 0; i < 9000; i++) {
    state.update(dt);
    if (state.transit.length > 0 && state.center.count() < state.center.capacity) sawInFlight = true;
    maxCenter = Math.max(maxCenter, state.center.count());
    if (state.center.count() > state.center.capacity) fail('partA: center exceeded capacity');
    if (state.phase !== 'playing') break;
    if (state._idle()) { if (++stable > 40) break; } else stable = 0;
  }
  if (!sawInFlight) fail('partA: no in-flight phase — candies appear to teleport');
  if (maxCenter !== state.center.capacity) fail(`partA: only ${maxCenter}/${state.center.capacity} candies piled in the tray`);
  if (state._releasing) fail('partA: release lock did not clear after the candies landed');
  if (state.transit.length !== 0) fail('partA: candies stuck in the dispenser');
  if (!state.center.isEmpty()) fail(`partA: center should auto-drain, still holds ${state.center.count()}`);
  if (counts.seat !== state.center.capacity) fail(`partA: ${state.center.capacity} candies should auto-route into jars, seated ${counts.seat}`);
  console.log('partA dispenser: one tap = one front candy; the pile caps at the tray capacity, then auto-routes');
}

// ---- Part B: tap front candies one at a time -> auto-sort -> WIN (level 0) ---------
{
  resetCounts();
  resetFeel();
  const state = new PuzzleGame();
  state.resize(900, 1000);
  const totalCandies = state.packets.remainingCandies(); // 32 individual candies
  const totalJars = state.jars.jars.length;              // 16 (4 lanes × 4 deep)

  // SMART single-tap play (the center is the ONLY buffer now — no storage tray): only drop a candy
  // an active jar can take, let auto-route drain it, and let completed jars advance their lanes.
  // Repeat until the rack is empty and every jar is filled.
  let guard = 0;
  while (state.phase === 'playing' && guard++ < 800) {
    let any = false;
    while (tapSmart(state)) any = true;
    // if nothing routable is droppable but the table is idle with packets left, make a wait-move
    if (!any && state._idle() && state.packets.hasRemainingPackets()) any = tapFront(state);
    settle(state);
    if (!any && state._idle()) break; // nothing left to do
  }

  console.log('events:', counts);
  if (state.phase !== 'win') fail(`partB did not win (phase=${state.phase})`);
  if (counts.win !== 1) fail(`win fired ${counts.win} times`);
  if (counts.lose !== 0) fail('lose fired during a winnable game');
  if (counts.release !== totalCandies) fail(`released ${counts.release}/${totalCandies}`);
  if (counts.seat !== totalCandies) fail(`seated ${counts.seat}/${totalCandies}`);
  if (counts.clear !== totalJars) fail(`cleared ${counts.clear}/${totalJars} jars`);
  // FEEL-LAYER: every completion carried combo metadata, indices stayed in [1, maxLink], and at
  // least one real CASCADE (combo >= 2) occurred — the dopamine moment the layer recognizes.
  if (feel.payloads !== counts.clear) fail(`partB combo metadata missing on ${counts.clear - feel.payloads} clears`);
  if (feel.badIndex) fail('partB comboIndex out of [1, maxLink]');
  if (feel.maxCombo < 2) fail(`partB no cascade detected (maxCombo=${feel.maxCombo})`);
  // DIRECTIONAL SWEEP: _autoRoute's pour-lane preference should follow one lane to exhaustion, so at
  // least one held same-lane sweep (>= 2 consecutive completions in one lane) must occur.
  if (feel.maxPourStreak < 2) fail(`partB no held same-lane sweep detected (maxPourStreak=${feel.maxPourStreak})`);
  console.log(`partB win: ${totalCandies} candies tapped one-by-one, ${totalJars} jars filled (no storage); maxCombo=${feel.maxCombo}, maxPourStreak=${feel.maxPourStreak}, maxRowStreak=${feel.maxRowStreak}`);
}

// ---- partK: multiplier-candy plumbing (feel-layer; additive, no gameplay change) ----------------
// The `special` flag is deterministic (every SCORING.multiplier.everyN-th candy in the flattened
// queue) and must survive consume(): rack/queue holds specials, consume hands the flag over.
{
  const state = new PuzzleGame();
  state.resize(900, 1000);
  const specials = state.packets.slots.filter((s) => s.special).length
    + state.packets.queue.filter((q) => q.special).length;
  if (specials < 1) fail('partK: no special (multiplier) candies flagged in the rack queue');
  const si = state.packets.slots.findIndex((s) => s.special);
  if (si >= 0) {
    const out = state.packets.consume(si);
    if (!out || out.special !== true) fail('partK: consume() lost the special flag');
  }
  const ni = state.packets.slots.findIndex((s) => s.color && !s.special);
  if (ni >= 0) {
    const out = state.packets.consume(ni);
    if (!out || out.special !== false) fail('partK: a non-special candy was reported special');
  }
  console.log(`partK multiplier: ${specials} special candies flagged; consume() carries the flag`);
}

// ---- Part C: one candy per tap drains into its jar; the pipeline caps ----
{
  resetCounts();
  const state = new PuzzleGame();
  state.loadLevel(ROUTABLE_IX); // all-routable fronts (see ROUTABLE_LEVEL): the dropped candy always routes
  state.resize(900, 1000);
  const f = state.tappableSlots()[0];
  const fColor = state.packets.slots[f].color;
  state.onPacketTapped(f); // one front candy
  if (state.transit.length !== 1) fail('partC: tapping a candy should drop exactly one');
  settle(state);
  const fJar = state.jars.jars.find((j) => j.colorKey === fColor);
  if (!state.center.isEmpty()) fail(`partC: center should auto-drain after the candy lands, holds ${state.center.count()}`);
  if (fJar.candies.length !== 1) fail(`partC: the one candy should route to its jar, got ${fJar.candies.length}`);
  // the smart-player cap (tapFront self-limits to capacity in flight):
  let n = 0;
  while (tapFront(state)) n++;
  if (n !== state.center.capacity) fail(`partC: smart cap should be ${state.center.capacity}, dropped ${n}`);
  // STRICT PIPELINE CAP: once the pipeline (falling + in-tray) hits capacity, further taps are
  // hard pre-blocked so the tray never overflows (the shipped design; CENTER.overfill is dormant).
  let extra = 0, s;
  while ((s = state.tappableSlots()[0]) !== undefined && state.onPacketTapped(s)) extra++;
  if (extra !== 0) fail(`partC: pipeline at capacity should refuse further taps, accepted ${extra}`);
  if (state.transit.length + state.center.count() !== state.center.capacity) fail('partC: pipeline should sit exactly at capacity');
  settle(state);
  if (state.center.count() > state.center.capacity) fail(`partC: center left over capacity (${state.center.count()})`);
  console.log('partC: one tap drops one candy that drains; pipeline strict-caps at capacity (tray never overflows)');
}

// ---- Part D: the FRONT-FIRST rule — a candy unlocks only once the one in front is dispensed ----
{
  resetCounts();
  const state = new PuzzleGame();
  state.resize(900, 1000);
  // Column 0 is the slots r*cols for r = 0..rows-1 (row 0 = back/top, last row = front/bottom,
  // toward the chute). Derive them from the LIVE responsive grid (resize() picks 11×3 or 6×6) so
  // this stays correct whichever grid was chosen for this size.
  const cols = state._rackCols, rows = state._rackRows;
  const BACK = 0, FRONT = (rows - 1) * cols, NEXT = (rows - 2) * cols; // NEXT = one behind the front
  if (!state._dispenseBlocked(BACK)) fail('partD: a back candy must start blocked');
  if (!state._dispenseBlocked(NEXT)) fail('partD: the candy behind the front must start blocked');
  if (state._dispenseBlocked(FRONT)) fail('partD: the front (bottom) candy must be tappable');
  if (state.onPacketTapped(BACK) !== false) fail('partD: tapping a blocked candy must be rejected');
  if (counts.invalid !== 1) fail('partD: a blocked tap should signal MOVE_INVALID');
  state.onPacketTapped(FRONT); // dispense the front candy of the column
  settle(state);
  if (state._dispenseBlocked(NEXT)) fail('partD: after the front goes, the next candy must unlock');
  if (rows > 2 && !state._dispenseBlocked(BACK)) fail('partD: the back candy stays blocked until the ones ahead go');
  console.log('partD front-first: a candy unlocks only once the one in front of it is dispensed');
}

// ---- Part E: the center is the ONLY buffer — an unroutable color WAITS, then routes ----
{
  resetCounts();
  // 5 jars → lanes (index % 4): lane 0 holds jar0 (front) + jar4 (behind). Put RED only at the BACK
  // of lane 0 so red has NO active jar at the start — a dropped red must WAIT in the center until the
  // blue in front of it completes and lane 0 advances. Balanced: blue 2, red/green/amber 1 each.
  const lvl = {
    name: 'Center Buffer',
    packets: [{ color: 'blue', count: 2 }, { color: 'green', count: 1 },
              { color: 'amber', count: 1 }, { color: 'red', count: 1 }],
    jars: [
      { id: 'b0', color: 'blue',  capacity: 1 }, // lane 0 FRONT
      { id: 'g',  color: 'green', capacity: 1 }, // lane 1
      { id: 'a',  color: 'amber', capacity: 1 }, // lane 2
      { id: 'b1', color: 'blue',  capacity: 1 }, // lane 3
      { id: 'r',  color: 'red',   capacity: 1 }, // lane 0 BEHIND b0 — red's only jar, starts a preview
    ],
    centerContainer: { capacity: 6 },
  };
  LEVELS.push(lvl);
  const ix = LEVELS.length - 1;
  const st = new PuzzleGame();
  st.loadLevel(ix);
  st.resize(900, 1000);
  if (st.jars.isActive(st.jars.jarById('r'))) fail('partE: red (behind the blue in its lane) should start as a preview');

  // drop the lone RED first — no active red jar → it must WAIT in the center (not vanish, not lose)
  const redSlot = st.tappableSlots().find((i) => st.packets.slots[i].color === 'red');
  st.onPacketTapped(redSlot);
  settle(st);
  if (!st.center.colorsPresent().includes('red')) fail('partE: an unroutable red must WAIT in the center (no storage)');
  if (st.phase !== 'playing') fail(`partE: a candy waiting in the center is not a loss (phase=${st.phase})`);

  // now drop a BLUE → routes into lane 0's front jar b0, which completes → lane 0 advances to red jar r
  const blueSlot = st.tappableSlots().find((i) => st.packets.slots[i].color === 'blue');
  st.onPacketTapped(blueSlot);
  // step long enough for b0 to fill+complete+close (jar close animation) and the lane to advance,
  // then for the waiting red to auto-route into the now-active jar r.
  for (let i = 0; i < 2500; i++) { st.update(dt); if (st.jars.jarById('r').candies.length > 0) break; }
  if (st.jars.jarById('r').candies.length !== 1) fail(`partE: after lane 0 advanced, the waiting red should route into jar r, got ${st.jars.jarById('r').candies.length}`);
  if (st.center.colorsPresent().includes('red')) fail('partE: the waiting red should have left the center once its jar opened');
  LEVELS.pop();
  console.log('partE buffer: an unroutable color waits in the center, then auto-routes when its lane advances');
}

// ---- Part F: stuck detection without a buffer (center fills with an unplaceable color) ----
{
  resetCounts();
  const dead = {
    name: 'Dead End',
    packetSlots: 2,
    packets: [{ color: 'red', count: 6 }],
    jars: [{ color: 'blue', capacity: 6 }], // no red jar at all -> red can never be placed
    centerContainer: { capacity: 6 },
  };
  LEVELS.push(dead);
  const idx = LEVELS.length - 1;
  const state = new PuzzleGame();
  state.loadLevel(idx);
  state.resize(900, 1000);
  // rain reds into the center until it is full; with no jar + no storage + nothing left to drop, stuck.
  let ended = false;
  for (let i = 0; i < 4000; i++) {
    while (tapFront(state)) { /* fill the center */ }
    state.update(dt);
    if (state.phase !== 'playing') { ended = true; break; }
  }
  if (!ended || state.phase !== 'lose') fail(`partF: stuck state should LOSE (phase=${state.phase})`);
  if (counts.lose !== 1) fail('partF: GAME_LOSE should have fired once');
  LEVELS.pop();
  console.log('partF stuck: center fills with an unplaceable color and there is no jar/buffer → loss');
}

// ---- Part G: level validation ----------------------------------------------
{
  if (validateLevel(LEVELS[0]) !== true) fail('partG: shipped level 0 should validate');
  const bad = {
    name: 'Unbalanced',
    packets: [{ color: 'red', count: 6 }, { color: 'red', count: 6 }, { color: 'red', count: 6 }],
    jars: [{ color: 'red', capacity: 6 }], // supply 18 vs demand 6
    centerContainer: { capacity: 6 },
  };
  console.log('partG (expected warnings for the unbalanced level below):');
  if (validateLevel(bad) !== false) fail('partG: unbalanced level should fail validation');
  console.log('partG validation: balanced level passes, unbalanced level flagged');
}

// ---- Part I: jar QUEUE lanes — structure of the shipped 16-jar level (4×4) ----
// (partB already drives this level to a full win, exercising lane advancement end-to-end.)
{
  const state = new PuzzleGame();   // level 0: 16 jars across 4 lanes (4 deep)
  state.resize(900, 1000);
  if (state.jars.laneCount !== 4) fail(`partI: expected 4 lanes, got ${state.jars.laneCount}`);
  if (state.jars.activeJars().length !== 4) fail(`partI: expected 4 active (front) jars, got ${state.jars.activeJars().length}`);
  for (const a of state.jars.activeJars()) {
    if (!state.jars.isActive(a)) fail('partI: activeJars() returned a non-front jar');
  }
  // up to maxVisible (3) jars show per lane → normally 12 visible at once on this level
  const maxVis = state.layout.jarQueue.maxVisible;
  let visible = 0;
  for (const lane of state.jars.lanes) visible += Math.min(maxVis, lane.length);
  if (visible !== 12) fail(`partI: expected 12 visible jars (4 lanes × 3), got ${visible}`);
  // a preview (non-front) jar must reject a direct tap — previews are read-only
  const preview = state.jars.jars.find((j) => !state.jars.isActive(j));
  if (!preview) fail('partI: the 16-jar level should have preview jars behind the fronts');
  else if (state.onJarTapped(preview.id) !== false) fail('partI: a preview jar must not collect candies');
  console.log('partI queues: 16 jars across 4 lanes, 12 visible, only the 4 fronts active/collectable');
}

// ---- Part J: the shipped level 0 FORCES buffering — greedy+buffer wins using the center, ----
// ----         and careless "tap everything" play gets STUCK (proves the redesign). ----------
{
  // (a) Sensible play: greedy-route what an active jar takes, buffer the rest in the center.
  resetCounts();
  const state = new PuzzleGame();
  state.resize(900, 1000);
  // At the start three lane-fronts are red + one blue, so GREEN and YELLOW have no active jar.
  const startFronts = state.jars.activeJars().map((j) => j.colorKey).sort();
  const startColors = new Set(startFronts);
  if (startColors.size >= 4) fail(`partJ: redesign should NOT start with 4 different active colors (got ${[...startColors]})`);
  const collectableAtStart = new Set(state.jars.activeJars().map((j) => j.colorKey));
  const allColors = new Set(state.packets.slots.map((s) => s.color).filter(Boolean));
  const mustWait = [...allColors].filter((c) => !collectableAtStart.has(c));
  if (mustWait.length < 1) fail('partJ: at least one supplied color should have NO active jar at the start (must wait)');

  let guard = 0, maxCenter = 0;
  const waited = new Set(); // colors that at some point sat in the center with no active jar to take them
  while (state.phase === 'playing' && guard++ < 800) {
    let any = false;
    while (tapSmart(state)) any = true;
    if (!any && state._idle() && state.packets.hasRemainingPackets()) any = tapFront(state);
    settle(state);
    maxCenter = Math.max(maxCenter, state.center.count());
    for (const c of state.center.colorsPresent()) if (!state.jars.anyAccepts(c)) waited.add(c);
    if (!any && state._idle()) break;
  }
  if (state.phase !== 'win') fail(`partJ: greedy+buffer play should WIN (phase=${state.phase})`);
  if (maxCenter < 2) fail(`partJ: the center buffer should genuinely be used (peak only ${maxCenter})`);
  if (waited.size < 1) fail('partJ: no color ever had to WAIT in the center — buffering not exercised');

  // (b) Careless play: dump the first tappable candy every time, no thought → should get STUCK.
  resetCounts();
  const dumb = new PuzzleGame();
  dumb.resize(900, 1000);
  let g2 = 0;
  while (dumb.phase === 'playing' && g2++ < 800) {
    let any = false;
    while (tapFront(dumb)) any = true; // greedily dump everything
    settle(dumb);
    if (!any && dumb._idle()) break;
  }
  if (dumb.phase !== 'lose') fail(`partJ: careless tap-everything play should be able to get STUCK (phase=${dumb.phase})`);

  console.log(`partJ buffer: level 0 starts with active colors {${startFronts.join(',')}}, forces {${mustWait.join(',')}} to wait; greedy+buffer wins (center peak ${maxCenter}/6, waited: ${[...waited].join(',')}), careless play gets stuck`);
}

// ---- Part H: responsive layout across sizes / aspect ratios ----------------
{
  const state = new PuzzleGame();
  const sizes = [
    [320, 480], [360, 640], [390, 844], [414, 896],
    [640, 360], [844, 390], [896, 414],
    [768, 1024], [1024, 768], [820, 1180],
    [1280, 800], [1440, 900], [1920, 1080],
    [1080, 1920], [2560, 1080], [3440, 1440],
  ];
  const tol = 1.0;
  let worst = '';
  for (const [w, h] of sizes) {
    const L = state.resize(w, h);
    const d = L.dispenser, b = d.box, IR = d.colliders.innerRect, c = L.center;
    const boxOnScreen = (B) => B.x - B.w / 2 >= -tol && B.x + B.w / 2 <= w + tol
      && B.y - B.h / 2 >= -tol && B.y + B.h / 2 <= h + tol;
    const jarsTop = Math.min(...L.jars.map((bb) => bb.y - bb.h / 2));
    const checks = [
      ['dispenser on screen', b.x >= -tol && b.x + b.w <= w + tol && b.y >= -tol && b.y + b.h <= h + tol],
      ['dispenser at top', b.y <= h * 0.12 + tol],
      // sized by screen fraction (~96% × ~62%); width may shrink only to stay on screen,
      // height only to preserve the center+jars tail below the chute.
      ['dispenser width <= 96%', b.w / w <= 0.96 + 0.001],
      ['dispenser height <= 62%', b.h / h <= 0.62 + 0.001],
      ['inner rect within dispenser', IR.left >= b.x - tol && IR.right <= b.x + b.w + tol && IR.top >= b.y - tol && IR.bottom <= b.y + b.h + tol],
      // The rack now SPREADS down into the funnel (tapered rows), so candies live within the full
      // inner-rect WIDTH but extend vertically from IR.top down to ~rackBottomFrac of the box.
      ['packets within rack region', L.packets.every((t) => t.x - t.r >= IR.left - tol && t.x + t.r <= IR.right + tol && t.y - t.r >= IR.top - tol && t.y + t.r <= b.y + DISPENSER.rackBottomFrac * b.h + tol)],
      ['center finite + on screen', Number.isFinite(c.w) && c.w > 4 && boxOnScreen(c)],
      ['center below dispenser top', c.y - c.h / 2 >= b.y - tol],
      ['center above jars', c.y + c.h / 2 <= jarsTop + tol],
      ['jars on screen', L.jars.every((bb) => boxOnScreen(bb))],
    ];
    for (const [name, pass] of checks) if (!pass) { worst = `${w}x${h}: ${name}`; fail(`layout @ ${w}x${h}: ${name}`); }
  }
  console.log(`partH responsive: ${sizes.length} sizes checked` + (worst ? ` (first failure ${worst})` : ' — all valid'));
}

console.log(ok ? 'SMOKE TEST OK' : 'SMOKE TEST FAILED');
process.exit(ok ? 0 : 1);
