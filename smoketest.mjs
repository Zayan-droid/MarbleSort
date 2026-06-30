// Headless smoke test for the candy PACKET-TRAY → dispenser funnel → holding tray → jars puzzle.
// Drives the real PuzzleGame (no browser APIs) and asserts: ONE TAP BURSTS a packet's whole batch
// (PACKET.packetSize candies) which tumble + PILE in the holding tray, then AUTO-ROUTE into matching
// active jars (or wait in the center when no jar takes them); the OVERFLOW GATE (a burst past the tray
// capacity PILES at the chute gate and is admitted as the tray frees, conserving candies); no front-first blocking;
// the full win loop; stuck detection; level validation; jar-queue structure; responsive layout.
// Exits non-zero on failure.

import { PuzzleGame } from './src/game/puzzle.js';
import { validateLevel } from './src/game/levelValidator.js';
import { bus, EV } from './src/core/events.js';
import { LEVELS, DISPENSER, SCORING, CENTER, PACKET } from './src/config.js';

const PSIZE = PACKET.packetSize;   // candies per packet tray (the burst size)

const counts = { clink: 0, seat: 0, clear: 0, release: 0, win: 0, lose: 0, invalid: 0 };
const resetCounts = () => Object.keys(counts).forEach((k) => { counts[k] = 0; });
bus.on(EV.MARBLE_CLINK, () => counts.clink++);
bus.on(EV.MARBLE_SEAT, () => counts.seat++);
bus.on(EV.BOX_CLEAR, () => counts.clear++);
bus.on(EV.CANDY_RELEASE, () => counts.release++);
bus.on(EV.GAME_WIN, () => counts.win++);
bus.on(EV.GAME_LOSE, () => counts.lose++);
bus.on(EV.MOVE_INVALID, () => counts.invalid++);

// FEEL-LAYER metadata on BOX_CLEAR (additive — must NOT change event counts or win/lose).
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
// game over. Auto-routing fires a beat AFTER idle, so keep stepping through idle frames.
function settle(state, max = 12000) {
  let stable = 0;
  for (let i = 0; i < max; i++) {
    state.update(dt);
    if (state.phase !== 'playing') return;
    // a STUCK board stays 'playing' through the lose-reveal grace (ANIM.loseRevealMs); keep stepping
    // while that timer is pending so the eventual lose is observed instead of returning on bare idle.
    if (state._idle() && state._stuckSince == null) { if (++stable > 40) return; } else stable = 0;
  }
}

// ---- play helpers (packet-tray model) ----
const pktColor = (state, i) => { const s = state.packets.slots[i]; return s && s.packet ? s.packet.color : null; };
const roomForBatch = (state) => state.center.capacity - (state.transit.length + state.center.count());
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
// CARELESS: tap the first packet whenever the tray isn't already full (may over-fill → roll back).
function tapAny(state) {
  if (state.transit.length + state.center.count() >= state.center.capacity) return false;
  const t = state.tappableSlots();
  return t.length ? state.onPacketTapped(t[0]) : false;
}
// SMART: tap a packet whose colour an ACTIVE jar can take the WHOLE batch of (so it never overflows).
function tapSmart(state) {
  if (roomForBatch(state) < PSIZE) return false;
  for (const i of state.tappableSlots()) {
    const color = pktColor(state, i);
    if (activeRoom(state, color) - committed(state, color) >= PSIZE) return state.onPacketTapped(i);
  }
  return false;
}
// WAIT MOVE: when nothing routable, park a batch in the center buffer (only if it fits, no overflow).
function tapWait(state) {
  if (roomForBatch(state) < PSIZE) return false;
  const t = state.tappableSlots();
  return t.length ? state.onPacketTapped(t[0]) : false;
}
// Total candies in the system (supply + falling + waiting at the gate + in the tray + rolling back) —
// conserved always.
const totalCandies = (state) => state.packets.remainingCandies() + state.transit.length
  + state.waiting.length + state.center.count() + state.rejecting.length;

// An ALL-ROUTABLE level for the mechanic tests (partA): four DIFFERENT lane-front colours, each with
// a roomy active jar, so a burst of any colour routes the instant it settles. One tray (count PSIZE)
// per colour, one jar per lane (all four active at once).
const ROUTABLE_LEVEL = {
  name: 'Routable (mechanic test)',
  packetSlots: 6,
  packets: [
    { color: 'red', count: PSIZE }, { color: 'yellow', count: PSIZE },
    { color: 'blue', count: PSIZE }, { color: 'green', count: PSIZE },
  ],
  jars: [
    { color: 'red', capacity: PSIZE }, { color: 'yellow', capacity: PSIZE },
    { color: 'blue', capacity: PSIZE }, { color: 'green', capacity: PSIZE },
  ],
  centerContainer: { capacity: 6 },
};
const ROUTABLE_IX = LEVELS.push(ROUTABLE_LEVEL) - 1;

// ---- Part A: ONE tap BURSTS a packet (PSIZE candies) that funnel, pile, then auto-route ----
{
  resetCounts();
  const state = new PuzzleGame();
  state.loadLevel(ROUTABLE_IX);
  state.resize(900, 1000);

  const first = state.tappableSlots()[0];
  if (first === undefined) fail('partA: there should be tappable packet trays');
  const col0 = pktColor(state, first);
  if (!state.onPacketTapped(first)) fail('partA: tapping a packet should burst it');
  if (state.center.count() !== 0) fail('partA: candies TELEPORTED into the center on tap');
  if (state.transit.length !== PSIZE) fail(`partA: one tap should burst ${PSIZE} candies, got ${state.transit.length}`);
  if (counts.release !== PSIZE) fail(`partA: expected ${PSIZE} CANDY_RELEASE, got ${counts.release}`);

  // they funnel in over time (a genuine in-flight phase), PILE in the tray, then AUTO-ROUTE into the
  // matching jar (cap PSIZE → it completes).
  let sawInFlight = false, maxCenter = 0, stable = 0;
  for (let i = 0; i < 12000; i++) {
    state.update(dt);
    if (state.transit.length > 0 && state.center.count() < PSIZE) sawInFlight = true;
    maxCenter = Math.max(maxCenter, state.center.count());
    if (state.phase !== 'playing') break;
    if (state._idle()) { if (++stable > 40) break; } else stable = 0;
  }
  if (!sawInFlight) fail('partA: no in-flight phase — candies appear to teleport');
  if (maxCenter < 1) fail('partA: candies never piled in the tray');
  if (maxCenter > state.center.capacity) fail(`partA: center exceeded capacity (${maxCenter})`);
  if (state._releasing) fail('partA: release lock did not clear after the candies landed');
  if (state.transit.length !== 0) fail('partA: candies stuck in the dispenser');
  if (!state.center.isEmpty()) fail(`partA: center should auto-drain, still holds ${state.center.count()}`);
  if (counts.seat !== PSIZE) fail(`partA: ${PSIZE} candies should auto-route into the ${col0} jar, seated ${counts.seat}`);
  console.log(`partA dispenser: one tap bursts ${PSIZE} candies that funnel, pile, then auto-route into their jar`);
}

// ---- Part C: OVERFLOW GATE — a burst past capacity PILES at the chute gate and is admitted as the
//             tray frees (nearest the entrance first); candies are conserved and the tray never
//             exceeds capacity, until everything routes and the level WINS ----
{
  resetCounts();
  // red supply 9 (three trays of 3) into ONE roomy red jar (cap 9, routable). Burst all three trays
  // before anything settles: the tray takes 6, the surplus 3 must WAIT at the gate (not roll back, not
  // vanish), then get admitted as auto-route drains the tray into the jar.
  const ovf = {
    name: 'Overflow Gate',
    packetSlots: 3,
    packets: [{ color: 'red', count: PSIZE }, { color: 'red', count: PSIZE }, { color: 'red', count: PSIZE }],
    jars: [{ color: 'red', capacity: 3 * PSIZE }],
    centerContainer: { capacity: 6 },
  };
  LEVELS.push(ovf);
  const ix = LEVELS.length - 1;
  const state = new PuzzleGame();
  state.loadLevel(ix);
  state.resize(900, 1000);
  // conservation total = unsorted (supply+falling+waiting+tray) + sorted (in jars, incl. removed) —
  // invariant at 9 every frame, even mid-pour (a candy poured center→jar moves atomically).
  const totalAll = (s) => totalCandies(s) + s.jars.jars.reduce((n, j) => n + j.candies.length, 0);
  const total0 = totalAll(state);
  // Burst THREE trays (9 candies) before letting them settle. roomNow caps the admitted at the tray
  // capacity (6), so exactly 3 candies overflow to the gate queue (state.waiting) right away.
  for (let k = 0; k < 3; k++) { const t = state.tappableSlots(); if (t.length) state.onPacketTapped(t[0]); }
  if (state.transit.length !== state.center.capacity) fail(`partC: tray should admit exactly capacity (${state.center.capacity}) in flight, got ${state.transit.length}`);
  if (state.waiting.length !== 3 * PSIZE - state.center.capacity) fail(`partC: the surplus should WAIT at the gate, got ${state.waiting.length}`);
  let conserved = true, maxSettledCenter = 0, sawWaiting = false;
  for (let i = 0; i < 12000 && state.phase === 'playing'; i++) {
    state.update(dt);
    if (totalAll(state) !== total0) conserved = false;           // never created/destroyed
    if (state.waiting.length > 0) sawWaiting = true;             // the queue genuinely held candies
    if (state.center.count() > state.center.capacity) maxSettledCenter = state.center.count();  // never overflows
  }
  if (!conserved) fail('partC: overflow did not conserve candies (supply+falling+waiting+tray drifted)');
  if (!sawWaiting) fail('partC: the surplus never registered as waiting at the gate');
  if (maxSettledCenter > 0) fail(`partC: the tray exceeded capacity (${maxSettledCenter}) — the gate must hold the surplus out`);
  if (state.waiting.length !== 0) fail(`partC: every waiting candy should eventually be admitted, ${state.waiting.length} left`);
  if (state.phase !== 'win') fail(`partC: the overflow level should WIN once the queue drains (phase=${state.phase})`);
  LEVELS.pop();
  console.log('partC overflow gate: a burst past capacity piles at the gate, then is admitted as the tray frees (conserved, never over capacity, → WIN)');
}

// ---- Part D: NO front-first blocking — every packet tray is tappable ----
{
  resetCounts();
  const state = new PuzzleGame();
  state.resize(900, 1000);
  const withPacket = state.packets.slots.map((s, i) => i).filter((i) => state.packets.slots[i].packet);
  const tappable = state.tappableSlots();
  if (tappable.length !== withPacket.length) fail(`partD: every filled tray should be tappable (${tappable.length}/${withPacket.length})`);
  if (state._dispenseBlocked(withPacket[0])) fail('partD: packet trays must not be front-first blocked');
  if (!state.onPacketTapped(withPacket[withPacket.length - 1])) fail('partD: any packet tray should be tappable');
  console.log('partD: packet trays have no front-first stacking — any tray can be opened');
}

// ---- Part B: tap packet trays -> auto-sort -> WIN (level 0) ----
{
  resetCounts();
  resetFeel();
  const state = new PuzzleGame();
  state.resize(900, 1000);
  const total = state.packets.remainingCandies(); // 48 individual candies
  const totalJars = state.jars.jars.length;        // 16 (4 lanes × 4 deep)

  // SMART play: open only packets an active jar can take the whole batch of (no overflow); when
  // nothing routable, park a batch in the center buffer; let auto-route drain + advance the lanes.
  let guard = 0;
  while (state.phase === 'playing' && guard++ < 3000) {
    let any = false;
    while (tapSmart(state)) any = true;
    if (!any && state._idle() && state.packets.hasRemainingPackets()) any = tapWait(state);
    settle(state);
    if (!any && state._idle()) break;
  }

  console.log('events:', counts);
  if (state.phase !== 'win') fail(`partB did not win (phase=${state.phase})`);
  if (counts.win !== 1) fail(`win fired ${counts.win} times`);
  if (counts.lose !== 0) fail('lose fired during a winnable game');
  if (counts.release !== total) fail(`released ${counts.release}/${total}`);
  if (counts.seat !== total) fail(`seated ${counts.seat}/${total}`);
  if (counts.clear !== totalJars) fail(`cleared ${counts.clear}/${totalJars} jars`);
  if (feel.payloads !== counts.clear) fail(`partB combo metadata missing on ${counts.clear - feel.payloads} clears`);
  if (feel.badIndex) fail('partB comboIndex out of [1, maxLink]');
  if (feel.maxCombo < 2 && feel.maxPourStreak < 2 && feel.maxRowStreak < 2) fail(`partB no cascade/sweep detected (combo=${feel.maxCombo}, pour=${feel.maxPourStreak}, row=${feel.maxRowStreak})`);
  console.log(`partB win: ${total} candies in ${total / PSIZE} packet bursts, ${totalJars} jars filled; maxCombo=${feel.maxCombo}, maxPourStreak=${feel.maxPourStreak}, maxRowStreak=${feel.maxRowStreak}`);
}

// ---- partK: multiplier JAR — a ~1-in-6 SEEDED random pick (feel-layer; no gameplay change) ----
{
  resetCounts();
  // (a) the pick is deterministic (seeded hash, not Math.random) → two fresh games flag IDENTICAL
  //     jars; it flags some of level 0; and candies no longer carry the flag.
  const s0 = new PuzzleGame(); s0.resize(900, 1000);
  const s0b = new PuzzleGame(); s0b.resize(900, 1000);
  const flagsA = s0.jars.jars.map((j) => !!j.multiplier);
  const flagsB = s0b.jars.jars.map((j) => !!j.multiplier);
  if (flagsA.join(',') !== flagsB.join(',')) fail('partK: the multiplier pick must be reproducible (seeded, not Math.random)');
  const flagged = flagsA.filter(Boolean).length;
  if (flagged < 1) fail('partK: the ~1-in-6 pick flagged no jars in level 0 (bump SCORING.multiplier.seed)');
  if (s0.packets.getActivePackets().some((p) => p.hasSpecial)) fail('partK: candies must no longer carry the special (multiplier) flag');

  // (b) EVERY multiplier jar (explicit + any random) pays multiplier on completion; normal jars don't.
  const mulFlags = [];
  const off = bus.on(EV.BOX_CLEAR, (p) => mulFlags.push(!!p.multiplier));
  const lvl = {
    name: 'Multiplier Jar',
    packetSlots: 3,
    packets: [{ color: 'red', count: PSIZE }, { color: 'blue', count: PSIZE }, { color: 'green', count: PSIZE }],
    jars: [
      { id: 'm', color: 'red', capacity: PSIZE, multiplier: true },  // explicit ×N jar
      { id: 'n', color: 'blue', capacity: PSIZE },                    // jar (may also be a random ×N)
      { id: 'g', color: 'green', capacity: PSIZE },                   // jar (may also be a random ×N)
    ],
    centerContainer: { capacity: 6 },
  };
  LEVELS.push(lvl);
  const ix = LEVELS.length - 1;
  const st = new PuzzleGame();
  st.loadLevel(ix);
  st.resize(900, 1000);
  if (!st.jars.jarById('m').multiplier) fail('partK: an explicit multiplier:true jar should be flagged');
  const mulJars = st.jars.jars.filter((j) => j.multiplier).length;
  let guard = 0;
  while (st.phase === 'playing' && guard++ < 60) { for (const i of st.tappableSlots()) st.onPacketTapped(i); settle(st); }
  off();
  if (st.phase !== 'win') fail(`partK: the multiplier level should win (phase=${st.phase})`);
  if (mulFlags.length !== st.jars.jars.length) fail(`partK: every jar should complete once (got ${mulFlags.length}/${st.jars.jars.length})`);
  const mTrue = mulFlags.filter(Boolean).length;
  if (mTrue !== mulJars) fail(`partK: multiplier completions (${mTrue}) should equal the multiplier jars (${mulJars})`);
  LEVELS.pop();
  console.log(`partK multiplier JAR: ~1-in-6 seeded pick flagged ${flagged}/${s0.jars.jars.length} in level 0 (reproducible); completing a ×${SCORING.multiplier.value} jar fires multiplier`);
}

// ---- Part E: the center is the ONLY buffer — an unroutable color WAITS, then routes ----
{
  resetCounts();
  // 5 single-candy packets; 5 jars cap 1 → lanes (index % 4). RED's only jar (r) sits BEHIND the blue
  // in lane 0, so a dropped red has no active jar and must WAIT in the center until lane 0 advances.
  const lvl = {
    name: 'Center Buffer',
    packets: [{ color: 'blue', count: 1 }, { color: 'blue', count: 1 }, { color: 'green', count: 1 },
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

  // burst the lone RED first — no active red jar → it must WAIT in the center (not vanish, not lose)
  const redSlot = st.tappableSlots().find((i) => pktColor(st, i) === 'red');
  st.onPacketTapped(redSlot);
  settle(st);
  if (!st.center.colorsPresent().includes('red')) fail('partE: an unroutable red must WAIT in the center (no storage)');
  if (st.phase !== 'playing') fail(`partE: a candy waiting in the center is not a loss (phase=${st.phase})`);

  // now burst a BLUE → routes into lane 0's front jar b0, which completes → lane 0 advances to red jar r
  const blueSlot = st.tappableSlots().find((i) => pktColor(st, i) === 'blue');
  st.onPacketTapped(blueSlot);
  for (let i = 0; i < 2500; i++) { st.update(dt); if (st.jars.jarById('r').candies.length > 0) break; }
  if (st.jars.jarById('r').candies.length !== 1) fail(`partE: after lane 0 advanced, the waiting red should route into jar r, got ${st.jars.jarById('r').candies.length}`);
  if (st.center.colorsPresent().includes('red')) fail('partE: the waiting red should have left the center once its jar opened');
  LEVELS.pop();
  console.log('partE buffer: an unroutable color waits in the center, then auto-routes when its lane advances');
}

// ---- Part F: stuck detection — the center fills with an unplaceable color and there is no jar ----
{
  resetCounts();
  const dead = {
    name: 'Dead End',
    packetSlots: 2,
    packets: [{ color: 'red', count: PSIZE }, { color: 'red', count: PSIZE }],
    jars: [{ color: 'blue', capacity: 2 * PSIZE }], // no red jar at all -> red can never be placed
    centerContainer: { capacity: 6 },
  };
  LEVELS.push(dead);
  const idx = LEVELS.length - 1;
  const state = new PuzzleGame();
  state.loadLevel(idx);
  state.resize(900, 1000);
  let ended = false;
  for (let i = 0; i < 6000; i++) {
    while (tapAny(state)) { /* fill the center with reds */ }
    state.update(dt);
    if (state.phase !== 'playing') { ended = true; break; }
  }
  if (!ended || state.phase !== 'lose') fail(`partF: stuck state should LOSE (phase=${state.phase})`);
  if (counts.lose !== 1) fail('partF: GAME_LOSE should have fired once');
  LEVELS.pop();
  console.log('partF stuck: center fills with an unplaceable color and there is no jar/buffer → loss');
}

// ---- Part G: level validation ----
{
  if (validateLevel(LEVELS[0]) !== true) fail('partG: shipped level 0 should validate');
  const bad = {
    name: 'Unbalanced',
    packets: [{ color: 'red', count: PSIZE }, { color: 'red', count: PSIZE }, { color: 'red', count: PSIZE }],
    jars: [{ color: 'red', capacity: PSIZE }], // supply 3*PSIZE vs demand PSIZE
    centerContainer: { capacity: 6 },
  };
  console.log('partG (expected warnings for the unbalanced level below):');
  if (validateLevel(bad) !== false) fail('partG: unbalanced level should fail validation');
  console.log('partG validation: balanced level passes, unbalanced level flagged');
}

// ---- Part I: jar QUEUE lanes — structure of the shipped 16-jar level (4×4) ----
{
  const state = new PuzzleGame();   // level 0: 16 jars across 4 lanes (4 deep)
  state.resize(900, 1000);
  if (state.jars.laneCount !== 4) fail(`partI: expected 4 lanes, got ${state.jars.laneCount}`);
  if (state.jars.activeJars().length !== 4) fail(`partI: expected 4 active (front) jars, got ${state.jars.activeJars().length}`);
  for (const a of state.jars.activeJars()) {
    if (!state.jars.isActive(a)) fail('partI: activeJars() returned a non-front jar');
  }
  const maxVis = state.layout.jarQueue.maxVisible;
  let visible = 0;
  for (const lane of state.jars.lanes) visible += Math.min(maxVis, lane.length);
  if (visible !== 12) fail(`partI: expected 12 visible jars (4 lanes × 3), got ${visible}`);
  const preview = state.jars.jars.find((j) => !state.jars.isActive(j));
  if (!preview) fail('partI: the 16-jar level should have preview jars behind the fronts');
  else if (state.onJarTapped(preview.id) !== false) fail('partI: a preview jar must not collect candies');
  console.log('partI queues: 16 jars across 4 lanes, 12 visible, only the 4 fronts active/collectable');
}

// ---- Part J: level 0 starts with limited active colours — greedy PACKET CHOICE wins, ----
// ----         careless tap-everything dumping gets STUCK. ----
// (In the packet-tray model the player CHOOSES which colour to open, so a careful player routes only
// what fits and rarely needs the center buffer — the skill is packet selection, not the buffering the
// old front-first rack forced. The center is still a buffer, proven by partE; careless dumping of
// mono-colour packets with no active jar floods it and loses.)
{
  // (a) Sensible play: open only packets an active jar can take a full batch of.
  resetCounts();
  const state = new PuzzleGame();
  state.resize(900, 1000);
  const startFronts = state.jars.activeJars().map((j) => j.colorKey).sort();
  const startColors = new Set(startFronts);
  if (startColors.size >= 4) fail(`partJ: level 0 should NOT start with 4 different active colors (got ${[...startColors]})`);
  const collectableAtStart = new Set(startFronts);
  const allColors = new Set(state.packets.slots.map((_, i) => pktColor(state, i)).filter(Boolean));
  const mustWait = [...allColors].filter((c) => !collectableAtStart.has(c));
  if (mustWait.length < 1) fail('partJ: at least one supplied color should have NO active jar at the start');

  let guard = 0, maxCenter = 0;
  while (state.phase === 'playing' && guard++ < 3000) {
    let any = false;
    while (tapSmart(state)) any = true;
    if (!any && state._idle() && state.packets.hasRemainingPackets()) any = tapWait(state);
    settle(state);
    maxCenter = Math.max(maxCenter, state.center.count());
    if (!any && state._idle()) break;
  }
  if (state.phase !== 'win') fail(`partJ: greedy packet-choice play should WIN (phase=${state.phase})`);

  // (b) Careless play: dump the first tappable packet every time, no thought → should get STUCK.
  resetCounts();
  const dumb = new PuzzleGame();
  dumb.resize(900, 1000);
  let g2 = 0;
  while (dumb.phase === 'playing' && g2++ < 3000) {
    let any = false;
    while (tapAny(dumb)) any = true; // greedily dump everything
    settle(dumb);
    if (!any && dumb._idle()) break;
  }
  if (dumb.phase !== 'lose') fail(`partJ: careless tap-everything play should be able to get STUCK (phase=${dumb.phase})`);

  console.log(`partJ: level 0 starts active {${startFronts.join(',')}}, with {${mustWait.join(',')}} not yet collectable; greedy packet-choice wins (center peak ${maxCenter}/6), careless dumping gets stuck`);
}

// ---- Part H: responsive layout across sizes / aspect ratios ----
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
      ['dispenser width <= 96%', b.w / w <= 0.96 + 0.001],
      ['dispenser height <= 62%', b.h / h <= 0.62 + 0.001],
      ['inner rect within dispenser', IR.left >= b.x - tol && IR.right <= b.x + b.w + tol && IR.top >= b.y - tol && IR.bottom <= b.y + b.h + tol],
      // packet TRAYS sit inside the inner rectangle (the cavity above the funnel mouth)
      ['packets within inner rect', L.packets.every((t) => t.x - t.r >= IR.left - tol && t.x + t.r <= IR.right + tol && t.y - t.r >= IR.top - tol && t.y + t.r <= IR.bottom + tol)],
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
