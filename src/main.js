// main.js — bootstrap + main loop. Wires the event bus to audio + haptics so
// every event's visual, audio, and haptic feedback lands on the SAME frame.
//
// The conveyor is the AUTHORITATIVE angular-track model in GameState (no Matter):
//   dial.update(dt)  ->  state.update(dt, dial.angularVel)  ->  render
// dial.angularVel (base auto-spin + the player's flick) is the belt speed every
// riding marble advances by.

import { bus, EV } from './core/events.js';
import { DIAL, ACTIVE_LEVEL, LEVELS } from './config.js';
import { GameState } from './game/state.js';
import { Dial, setupInput } from './game/input.js';
import { Renderer } from './render/renderer.js';
import { audio } from './audio/audio.js';
import { haptics } from './haptics/haptics.js';

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const statusEl = document.getElementById('status');
const startBtn = document.getElementById('startBtn');

const state = new GameState();
const dial = new Dial();
const renderer = new Renderer(canvas);

// --- layout / resize ---------------------------------------------------------
function doResize() {
  const { w, h } = renderer.resize();
  state.resize(w, h);
}
// coalesce bursts of resize events (orientation flip, mobile URL bar) to one per frame
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

// --- input -------------------------------------------------------------------
setupInput(canvas, dial, {
  getLayout: () => state.layout,
  onTrayTap: (i) => state.tapTray(i),
  onFirstGesture: () => audio.ensureStarted(),
});

// --- event bus -> sensory channels (same-frame feedback) ---------------------
bus.on(EV.MARBLE_CLINK, ({ angle, intensity }) => {
  audio.clink(Math.cos(angle), intensity);
});
bus.on(EV.MARBLE_DROP, ({ angle }) => {
  // a marble released from a tray — light tap feedback
  audio.clink(Math.cos(angle), 0.4);
  haptics.tick();
});
bus.on(EV.DIAL_DETENT, ({ speed }) => {
  audio.clink(0, 0.18 + Math.min(Math.abs(speed) / 10, 0.25)); // soft click
  haptics.tick();
});
bus.on(EV.MARBLE_SEAT, ({ pan }) => {
  audio.seat(pan || 0);
  haptics.seat();
});
bus.on(EV.BOX_CLEAR, () => {
  audio.clear();
  haptics.clear();
});
bus.on(EV.JAM_WARNING, () => {
  audio.warning();
  haptics.warning();
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
  dial.angularVel = DIAL.baseSpeed * DIAL.baseDirection;
  state.beltAngle = 0;
  overlay.classList.add('hidden');
  statusEl.textContent = '';
  running = true;
}

function endGame(won) {
  running = false;
  const def = LEVELS[ACTIVE_LEVEL];
  statusEl.textContent = won ? '✦ Level Cleared ✦' : 'Loop Jammed';
  overlay.querySelector('h1').textContent = won ? 'NICE' : 'JAMMED';
  overlay.querySelector('p').textContent = won
    ? `You sorted every marble in "${def.name}".`
    : 'The loop overflowed. Spin faster and sort marbles before they pile up.';
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
    dial.load = state.beltCount();
    dial.update(dt);
    state.update(dt, dial.angularVel, dial.dragging);

    audio.update(dt, dial.angularVel, state.activity);
    haptics.spinRumble(dial.angularVel);
    bus.emit(EV.DIAL_SPIN, { speed: dial.angularVel });
  }

  renderer.render(state, dial, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.WHIRL = { state, dial, audio, haptics, renderer, bus };
