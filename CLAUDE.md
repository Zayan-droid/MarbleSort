# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Whirl** — an ASMR marble-sorting browser game. Three stacked zones: a tray ROW across the
top dispenses colored marbles, a round CONVEYOR loop in the middle carries them, and a bin
ROW across the bottom collects matching colors. The player spins the loop (a flywheel dial)
with their thumb. The priority after correct gameplay is *sensory feel*: synchronized audio,
visual, and haptic feedback. Vanilla JS + HTML5 Canvas, Vite, fully synthesized Web Audio
(no audio files), procedural Canvas graphics (no image files). No physics engine.

## Commands

```bash
npm run dev        # Vite dev server at http://localhost:5173 (click "Tap to Play" — audio needs a gesture)
npm run build      # static bundle into dist/
npm run preview    # serve the built bundle
node smoketest.mjs # headless verification of core logic (drop→ride→seat→clear→win); exits non-zero on failure
```

There is no test framework, linter, or typechecker configured. `smoketest.mjs` is the
regression check: it drives the real `GameState` (no browser APIs needed) and asserts the
full gameplay loop — including that marbles visibly RIDE (~π radians from top entry to bottom
bin) and never reach a non-finite position. Run it after changing `state.js`.

In-app keys: `D` debug overlay (FPS / marble count / ω), `M` mute, `H` toggle haptics, `R` restart.

## Architecture

The main loop (`src/main.js`) runs this order every frame:
`dial.update(dt)` → `state.update(dt, ω)` → `audio.update` + `haptics.spinRumble` → `renderer.render`.

**The conveyor is an AUTHORITATIVE ANGULAR-TRACK MODEL, not physics** (`src/game/state.js`).
This is the most important design decision — an earlier Matter.js tangential-force version
flung marbles off the track and was deleted. Each on-loop marble owns an `angle`; while
`riding`, `state.update` advances it by `ω · dt · jitter` and the renderer draws it at
`(cx + cos·R, cy + sin·R)`, so it always visibly travels around the ring. Marble lifecycle:
`entering` (a fall tween from the tray onto the loop) → `riding` → `dropping` (a fall tween
into a bin) → seated (moved into `bin.seated`). Entry angle is the loop's TOP arc beneath each
tray; a bin's drop point is the loop's BOTTOM arc above it. Drop-off fires when a riding
marble's angle is within `BIN.captureArcDeg` of a matching, non-full bin. `_resolveJostle` is
deterministic light spacing (keeps marbles from overlapping, emits `MARBLE_CLINK` on a fresh
bump) — it is feel-only; the angular position stays authoritative. Do NOT reintroduce a
physics engine to carry marbles.

**Event bus is the spine of "feel."** `src/core/events.js` exposes a singleton `bus` and the
`EV` name constants. `state.js` only *emits*; `main.js` wires each event to its audio + haptic
handlers, and `renderer.js` subscribes for particle bursts. Because `emit()` invokes handlers
synchronously, a single event's visual + audio + haptic land on the same frame — that synchrony
is the whole point. To add a sensory moment: add an `EV` constant, emit it from `state.js`,
subscribe in `main.js` (audio/haptics) and/or `renderer.js`. (Note: the bin-clear event is
still named `EV.BOX_CLEAR` for continuity with the sensory wiring.)

**The dial is a flywheel** (`Dial` in `src/game/input.js`). While dragging it tracks the
pointer's angular velocity 1:1; on release `angularVel` is preserved and decays toward base
speed via friction. Load (marble count, set each frame as `dial.load`) eases the decay so a
loaded dial coasts longer. `state.js` reads `dial.angularVel` as the single source of truth for
belt speed — it never owns it.

**Audio is a static node graph** built once on first user gesture (`audio.ensureStarted`):
`voices/beds → busLowpass → (dry + convolver/wet) → compressor → master → out`. Continuous
beds (rumble/whir/pad) are persistent nodes whose params are retargeted in `audio.update`;
one-shot voices (clink/seat/clear/warning) are created per event. Each voice is an isolated
method so a real sample can replace one without touching the graph. Clinks are stereo-panned
by loop angle and throttled to avoid machine-gunning.

**Haptics is a deliberate abstraction** (`src/haptics/haptics.js`): named events only
(`tick`/`seat`/`clear`/`warning`/`spinRumble`), feature-detected, no-op where
`navigator.vibrate` is absent (iOS Safari). Keep game code calling named methods so it can
later remap to native rich haptics (Capacitor / Core Haptics) without changes.

## Conventions specific to this repo

- **`src/config.js` is the single home for every tunable "feel" number** — inertia, friction,
  detents, ride-speed jitter, audio gains, haptic intensities — and for `LEVELS`. Tune behavior
  there, not in module code. Add a level by pushing to `LEVELS` and setting `ACTIVE_LEVEL`; a
  level is just `bins` (fixed colors, left→right) + `trays` (color stacks, left→right).
- **Layout is three stacked zones**, recomputed from canvas size in `GameState.resize()`: the
  loop ride radius `R` is fit between the tray row (`TRAY.rowYFrac`) and bin row (`BIN.rowYFrac`)
  and capped by `LOOP.radiusFracCap`. Coordinates are CSS pixels; the renderer scales the
  context by devicePixelRatio.
- **Time sources differ on purpose.** Marble advance and tweens use the frame `dt`; the tray
  release cooldown (`TRAY.releaseCooldownMs`) and bin-clear hold (`BIN.clearHoldMs`) use
  wall-clock `performance.now()`. These are identical in the real game but diverge in any
  faster-than-real-time headless sim — `smoketest.mjs` neutralizes both. Keep this in mind
  before "fixing" a wall-clock timer.
