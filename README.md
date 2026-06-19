# Whirl

An ASMR marble-sorting game with a player-controlled **spin-dial conveyor**. Drop
colored marbles onto a circular loop, spin the dial with your thumb, and let them
ride into matching colored boxes. Three of a color clears the box; jam the loop and
it's game over.

Vanilla JS + HTML5 Canvas, Matter.js physics, fully synthesized Web Audio (no audio
files), procedural Canvas graphics (no image files), and a feature-detected haptics
abstraction. Everything is self-contained.

## Run

```bash
npm install
npm run dev      # open the printed http://localhost:5173 URL
```

Click **Tap to Play** (a user gesture is required to start the audio engine).

`npm run build` produces a static bundle in `dist/`.

## How to play

- **Spin the dial** — drag anywhere on the loop (mouse or touch). It has flywheel
  inertia: flick it and it coasts, then decays back to a gentle base speed. The more
  marbles on the loop, the heavier it feels. Spinning moves marbles along faster and
  shakes loose stragglers.
- **Tap a tray** (top) to drop its next marble onto the loop.
- A marble riding past a **matching box** (bottom) with an open slot drops in. Fill all
  3 slots to **clear** the box (burst + chime); it resets empty.
- **Lose** if the loop fills past capacity. **Win** by clearing every marble.

### Keys
- `D` — toggle the debug overlay (FPS / marble count / angular velocity)
- `M` — mute audio · `H` — toggle haptics · `R` — restart

## Architecture

| File | Responsibility |
|------|----------------|
| `src/config.js` | **All** tunable constants + the level definitions |
| `src/core/events.js` | Central event bus — fires a moment's visual+audio+haptic on the same frame |
| `src/game/physics.js` | Matter.js world + circular-conveyor tangential-velocity logic |
| `src/game/state.js` | Game state, layout, level, seating, win/lose |
| `src/game/input.js` | Pointer/touch → flywheel dial + tray taps |
| `src/render/renderer.js` | Canvas drawing: loop, marbles, boxes, trays, particles, motion blur |
| `src/audio/audio.js` | Procedural Web Audio synthesis, stereo panning, reverb, ambient bed |
| `src/haptics/haptics.js` | Vibration abstraction (named events, feature-detected, no-op fallback) |

### Adding a level
Push another object to `LEVELS` in `src/config.js` (a list of box colors and tray
stacks) and set `ACTIVE_LEVEL`. Every "feel" number — inertia, friction, detents,
grip, audio levels, haptic intensities — lives in `config.js`.

### Extending the sensory channels
- **Audio**: each synth voice is an isolated factory in `audio.js`; swap any one for a
  real sample without touching the rest of the graph.
- **Haptics**: `haptics.js` exposes named events (`tick`, `seat`, `clear`, `warning`,
  `spinRumble`) so it can later remap to native rich haptics (Capacitor / Core Haptics)
  without changing game code.

## Dev check
`node smoketest.mjs` runs the core physics + state logic headlessly and asserts the
full drop → seat → clear → win loop fires.
