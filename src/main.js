// main.js — bootstrap + main loop for the packet → center → jars / tray puzzle.
//
// Wires the event bus to audio + haptics so every event's visual, audio, and haptic feedback
// lands on the SAME frame. There is no conveyor / dial: the loop is simply
//   state.update(dt) -> audio.update -> renderer.render
// (The conveyor GameState + Dial are kept dormant in game/state.js and game/input.js.)

import { bus, EV } from './core/events.js';
import { ACTIVE_LEVEL, LEVELS, AUDIO } from './config.js';
import { PuzzleGame } from './game/puzzle.js';
import { setupTapInput } from './game/input.js';
import { Renderer } from './render/renderer.js';
import { audio } from './audio/audio.js';
import { haptics } from './haptics/haptics.js';

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const statusEl = document.getElementById('status');
const startBtn = document.getElementById('startBtn');

const state = new PuzzleGame();
const renderer = new Renderer(canvas);

// --- layout / resize ---------------------------------------------------------
function doResize() {
  const { w, h } = renderer.resize();
  state.resize(w, h);
}
let resizePending = false;
function scheduleResize() {
  if (resizePending) return;
  resizePending = true;
  requestAnimationFrame(() => { resizePending = false; doResize(); });
}
window.addEventListener('resize', scheduleResize);
window.addEventListener('orientationchange', scheduleResize);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', scheduleResize);
  window.visualViewport.addEventListener('scroll', scheduleResize);
}
doResize();

// --- input: tap packets / jars / tray ----------------------------------------
setupTapInput(canvas, {
  getLayout: () => state.layout,
  onPacketTap: (i) => state.onPacketTapped(i),
  onJarTap: (id) => state.onJarTapped(id),
  onFirstGesture: () => audio.ensureStarted(),
});

// --- event bus -> sensory channels (same-frame feedback) ---------------------
bus.on(EV.CANDY_RELEASE, ({ angle }) => {
  // a candy tumbled out of an opened packet — punchy pop + strong haptic + sparkle (renderer)
  audio.pop(Math.cos(angle || 0));
  haptics.release();
});
bus.on(EV.MARBLE_CLINK, ({ angle, intensity }) => {
  // soft settle as a candy lands in the center / tray
  audio.clink(Math.cos(angle || 0), intensity);
});
bus.on(EV.MARBLE_SEAT, ({ pan }) => {
  // a candy settled into a jar
  audio.seat(pan || 0);
  haptics.seat();
});
bus.on(EV.MOVE_INVALID, () => {
  // rejected move (wrong color jar / full tray)
  audio.warning();
  haptics.warning();
});
bus.on(EV.BOX_CLEAR, ({ comboIndex = 1, clutch = false, multiplier = false } = {}) => {
  // a jar completed — the feel-layer escalates with the cascade (combo), the pressure (clutch),
  // and a multiplier candy landing the final slot.
  audio.clear({ comboIndex, clutch, multiplier });
  haptics.clear({ comboIndex, clutch, multiplier });
});
bus.on(EV.GAME_WIN, () => endGame(true));
bus.on(EV.GAME_LOSE, () => endGame(false));

// --- start / restart ---------------------------------------------------------
let running = false;

function startGame() {
  audio.ensureStarted();
  overlay.classList.add('hidden');
  running = true;
}

function restart() {
  state.loadLevel(ACTIVE_LEVEL);
  doResize();
  overlay.classList.add('hidden');
  statusEl.textContent = '';
  running = true;
}

function endGame(won) {
  running = false;
  const def = LEVELS[ACTIVE_LEVEL];
  statusEl.textContent = won ? '✦ Level Cleared ✦' : 'Stuck';
  overlay.querySelector('h1').textContent = won ? 'NICE' : 'STUCK';
  overlay.querySelector('p').textContent = won
    ? `You filled every jar in "${def.name}".`
    : 'No jar can take the candies in the center and the tray is full. Plan which packets you open.';
  startBtn.textContent = 'Play Again';
  overlay.classList.remove('hidden');
}

startBtn.addEventListener('click', () => {
  if (state.phase === 'win' || state.phase === 'lose') restart();
  else startGame();
});

// --- debug / utility keys ----------------------------------------------------
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'd') renderer.debug = !renderer.debug;
  else if (k === 'm') audio.setMuted(!audio.muted);
  else if (k === 'h') haptics.setEnabled(!haptics.enabled);
  else if (k === 'r') restart();
});

// --- main loop ---------------------------------------------------------------
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05; // clamp after tab switches / hitches

  if (running) {
    state.update(dt);
    audio.update(dt, 0, state.activity); // no belt spin -> speed 0 (beds idle)
  }

  renderer.render(state, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.CANDYSORT = { state, audio, haptics, renderer, bus };
