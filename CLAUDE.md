# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Candy Sort** — an ASMR candy-sorting browser game. The ACTIVE game is a tap-driven
**packet-management puzzle**:

- **TOP:** a candy-machine DISPENSER (`candyDispenser/candyDispenser.png`) — its inner rectangle is
  FILLED with a RACK of individual candies (a grid SPANNING the whole inner rect; candy size = its
  cell × `DISPENSER.rackCandyFill`). The grid is RESPONSIVE: `resize()` picks the `DISPENSER.rackGrids`
  candidate with the most near-SQUARE cells for the current cavity — tall portrait phones get 6×6 (so
  candies fill the cavity instead of clustering at the top), wide screens get 11×3. The rack slots are
  re-dealt (`PacketQueueManager.relayout`) when the chosen cell count changes, preserving the candies
  still to dispense. Keep every grid's `cols` NOT a multiple of the 4-colour count, or the round-robin
  rack lines up monochrome columns and the buffer puzzle collapses. `_dispenseBlocked` / the rack
  layout read the live `this._rackCols`/`this._rackRows`, not the config constants.
  Tapping a candy drops THAT ONE candy, which tumbles (physics) down the diagonal slants and through
  the central chute into the holding tray below; the emptied cell refills from the supply queue.
- **CENTER:** a holding tray — the main decision space — candies pile on its floor (capacity 6).
- **BOTTOM:** target jars, arranged as **4 QUEUE LANES** filling a ~80%-wide × ~30%-tall area
  centred near the bottom (`JAR.queue` + the BottomJarQueueLayout in `PuzzleGame`). Each lane shows
  up to 3 jars (front + 2 previews; fewer if the lane has fewer left → normally 12 jars on screen).
  Only the FRONT jar of a lane is ACTIVE/collectable — it accepts ONE color up to its capacity, then
  completes (its LID drops on, closing animation from `Jar/jars.png`), is removed, and the lane
  SHIFTS FORWARD so the next jar becomes active (a hidden jar, if any, appears at the back). The
  jars behind the front are read-only previews (smaller + faded, shown only so the queue is readable).

There is **NO storage tray** — the CENTER holding tray (capacity 6) is the only buffer.

**ONE TAP DROPS ONE CANDY, FRONT-FIRST.** The player taps candies in the rack; each drops a single
candy that tumbles into the holding tray and PILES. A candy can only be dispensed once the candy
directly IN FRONT of it — the next one toward the chute, i.e. one row DOWN in its column — has been
removed, so each column empties bottom-up (blocked candies are dimmed; `tappableSlots()` lists the
live ones). The player may rain several down at once, but only while the tray pipeline (candies
falling + already in the tray) stays within the center's capacity, so the tray never overflows. Once the pile SETTLES the game AUTO-ROUTES it: matching candies flow into
any accepting ACTIVE jar (greedily, across same-color front jars); a color whose jar isn't currently
active simply WAITS in the center until a lane advances and opens it. Win by filling every jar; LOSE
only when the center holds candies no active jar will take and there's no way to make progress (no
candies left to drop, or the center is full so none can be dropped to complete a jar and advance a
lane). (The manual `onJarTapped` intent still exists and works — auto-routing just fires it for you
the instant the tray settles — so a tap on a jar remains a harmless, optional override.)
The priority after correct gameplay is *sensory feel*: synchronized audio, visual, and haptic
feedback. Vanilla JS + HTML5 Canvas, Vite, fully synthesized Web Audio (no audio files). Candies
blit from one PNG spritesheet (`newcandy/newcandies.png`, a non-uniform candy collage — each color
picks a pixel box from it via `COLORS[key].spriteRect`); the SAME candy art is used everywhere a
candy shows — including the packet tiles, so the dispenser reads as a rack full of candies. The
container, jars and tray are drawn procedurally (glossy glass), and the dispenser is one PNG. **No
physics engine**: every move
is an eased tween EXCEPT the packet→center spill, which runs a tiny self-contained custom funnel
sim (`src/game/dispenser.js`) — purpose-built circle/line collision, NOT a library — that carries
the candies all the way down to TUMBLE AND PILE on the open holding tray's floor (no grooves).

> **The round CONVEYOR / flywheel-DIAL game is RETIRED but kept DORMANT.** `src/game/state.js`
> (`GameState`), `src/game/traySlots.js`, the old `src/game/packets.js`, the `Dial` +
> `setupInput()` in `src/game/input.js`, and the `_drawLoop`/`_drawBins`/`_drawMarbles`/old
> `_drawPackets`/`_drawHud`/`_drawDebug` methods in `renderer.js` are still on disk but NO LONGER
> WIRED UP. The conveyor-only config constants (`DIAL`/`LOOP`/`RADIAL`/`MARBLE`/`SEAT`/`RULES`/`BIN`
> and the old `PACKET` streaming fields) remain for them. Don't delete them unless asked; don't
> route new gameplay through them.

(Internal identifiers in the DORMANT code are still "marble"-flavored; the shared event names
`EV.MARBLE_SEAT` / `EV.MARBLE_CLINK` / `EV.BOX_CLEAR` are reused by the active game for continuity
with the audio/haptic wiring. Don't rename them.)

## Commands

```bash
npm run dev        # Vite dev server at http://localhost:5173 (click "Tap to Play" — audio needs a gesture)
npm run build      # static bundle into dist/
npm run preview    # serve the built bundle
node smoketest.mjs # headless verification of the puzzle logic; exits non-zero on failure
```

There is no test framework, linter, or typechecker configured. `smoketest.mjs` is the regression
check: it drives the real `PuzzleGame` (no browser APIs needed) and asserts the full loop — tap a
rack candy → ONE candy tumbles + piles in the tray → auto-routes to its active jar → all jars
complete → WIN (the shipped 16-jar / 4-lane level, played with no storage buffer) — plus the
tray-pipeline cap (a drop beyond the center capacity is rejected), the center-buffer wait/route
(an unroutable color waits in the center, then routes when its lane advances), stuck detection,
`validateLevel`, jar-queue structure, and responsive layout across a size matrix. Run it after
changing anything in `src/game/` or `src/config.js`.

In-app keys: `D` debug overlay (FPS / to-sort / center / tray / phase), `M` mute, `H` toggle
haptics, `R` restart.

## Architecture (active puzzle)

The main loop (`src/main.js`) runs each frame: `state.update(dt)` → `audio.update(dt, 0, activity)`
→ `renderer.render(state, dt)`. No dial / belt speed is involved.

**`PuzzleGame` is the orchestrator** (`src/game/puzzle.js`). It owns three logical managers (center,
jars, packets) + a layout + a dt-accumulated clock `_time` (ms). All timing (fall stagger, move
tweens) runs off `_time` — NO `performance.now()` in game logic — so the headless sim can fast-forward.

**Candies are objects that LIVE in a container and carry a transient tween.** A candy is
`{ id, colorKey, where:'center'|'jar', jar, slot, anim, ... }`. Logical rules read
container membership IMMEDIATELY on a tap (a candy belongs to its destination the instant a move is
decided); `anim = { fromX, fromY, startTime, dur, kind }` is purely cosmetic. `candyScreenPos(c)`
eases from `anim.fromX/Y` to the candy's LIVE rest slot (derived from layout each frame, so a
resize never strands an in-flight candy); `_restPos`/`candyRadius` resolve by `where`. On a tween's
start (`kind:'fall'`) it emits `CANDY_RELEASE`; on arrival it emits `MARBLE_SEAT` (into a jar) or a
soft `MARBLE_CLINK` (center/tray landings).

**The candy dispenser is a small custom funnel sim that flows straight into the tray**
(`src/game/dispenser.js`). The `candyDispenser.png` is purely visual and is drawn to EXACTLY fill
its layout box, so the colliders — authored in `config.js` `DISPENSER` as FRACTIONS of that box —
line up with the art. `computeDispenserColliders(box, cfg)` builds the inner-rectangle walls, the
two diagonal slant segments, the vertical chute walls, and the exit line; `DispenserPhysics.step(
transit, dt, now)` runs sub-stepped gravity + candy/candy circle collisions + slide-and-bounce. Past
the chute exit the SAME sim keeps going against the **tray basin** (`this.physics.basin`: the holding
tray's inner walls + floor, set each `resize()` from `CENTER.basin` fractions of the center box) so
the candies TUMBLE IN AND PILE — there are no grooves. `PuzzleGame` owns `this.transit` (the
spilling candies, plain `{x,y,vx,vy,r,...}` physics objects) and `this._releasing` (the input lock).
`onPacketTapped` spawns ONE candy at the tapped rack cell with a gentle deterministic nudge toward
the chute (no `Math.random`, so the funnel reliably delivers and the smoketest is reproducible); it
is gated so `transit + center.count() < center.capacity` (the player may tap several but never
overflows the tray). Candies are NOT
removed at the chute — `update()` watches the pile via `_traySettled()` (all candies in the basin and
moving below `CENTER.settle.speedFracH` of box height for `holdMs`; `maxMs` is a hang-guard) and then
`_depositTray()` hands the whole batch to the center container, each frozen at its physics resting
spot recorded as box fractions (`restFx`/`restFy`, so a resize keeps the pile in place). `_releasing`
clears on deposit; `_idle()` (no spill + no lock + no tweens) gates win/lose. Physics is confined to
the dispenser+tray basin only — every other move stays tween-based. Press `D` in-game to stroke the
colliders for tuning the `DISPENSER` fractions.

**The three managers** (logic only — geometry lives in `PuzzleGame.resize()`):
- `CenterContainerManager` (`center.js`): the candies currently in the center (cap 6) — the ONLY
  buffer. `isEmpty`, `hasRoom`, `add`, `removeMatching(color, max)`, `takeAll`, `colorsPresent`.
- `JarManager` (`jars.js`): jars `{ id, colorKey, capacity, candies, complete, removed, lane,
  laneOrder }`, distributed round-robin into `laneCount` (≤4) `lanes` (each a queue). `frontJar(lane)`
  / `isActive(jar)` / `activeJars()` expose the lane fronts — `accepts` / `anyAccepts` only allow the
  ACTIVE (front) jar of a lane. Plus `roomIn`, `add`, `allComplete`. Built from `level.jars`.
- `PacketQueueManager` (`packetQueue.js`): the dispenser's CANDY RACK. It flattens the level's mono
  `packets` into a flat queue of INDIVIDUAL candies, INTERLEAVED round-robin across the colors (so
  the rack shows a mix, deterministically), and fills `slots` (a grid, capacity `rackCols×rackRows`)
  from it. `consume(slotIndex)` hands over ONE candy's color and refills that slot from the queue.

**Intents** (`PuzzleGame.onPacketTapped` / `onJarTapped`) enforce the rules: tap a rack candy to drop
ONE candy (gated by the tray pipeline AND the front-first rule `_dispenseBlocked` — a candy behind
another can't be tapped → `MOVE_INVALID`); send matching candies center→jar up to the ACTIVE jar's
room (preview jar / wrong color / full → `MOVE_INVALID`).

**`_autoRoute()` is what makes it single-tap.** Called each `update()` (after jar completions,
before `_checkEnd`) but it acts ONLY on a fully-settled, idle table (`!_releasing && !transit &&
_allSettled`) so it never fires mid-tween or fights a spill. When the center holds settled candies
it fills every accepting ACTIVE jar (greedy, across same-color front jars, reusing the same
tweens/events as `onJarTapped`). Any candy whose color has no active jar just stays in the center,
waiting for a lane to advance and open it (there is no storage tray to park it). Each pass that
moves anything returns and lets it settle before the next, which keeps multi-step routing staggered
and avoids re-firing. The manual `onJarTapped` intent is unchanged and still callable (an optional
early override).

Jar completion + `BOX_CLEAR` fire once a jar is full AND its candies have settled — this sets
`jar.complete` and starts the closing animation; once it finishes (`JAR.close` ms later)
`_resolveJarCompletions` sets `jar.removed` (the renderer then stops drawing the jar + its candies).
A completed/removed jar still counts as complete for the win check. **Win** =
packets empty + center empty + all jars complete. **Lose (stuck)** = center non-empty, no ACTIVE jar
accepts any center color, AND no way to progress (no packets left to drop, or the center is full so
none can be dropped to complete a jar and advance a lane). Both are checked only when everything has
settled (`_allSettled`).

**Event bus is the spine of "feel."** `src/core/events.js` exposes a singleton `bus` + `EV`
constants. `puzzle.js` only *emits*; `main.js` wires each event to audio + haptics; `renderer.js`
subscribes for particle bursts/sparkles. `emit()` is synchronous, so one event's visual + audio +
haptic land on the same frame. Active events: `CANDY_RELEASE` (packet opened → pop + haptic +
sparkle), `MARBLE_SEAT` (candy into a jar → seat SFX + haptic), `MARBLE_CLINK` (soft settle),
`MOVE_INVALID` (rejected move → warning SFX + haptic), `BOX_CLEAR` (jar complete → chime + haptic),
`GAME_WIN`/`GAME_LOSE`.

**Renderer** (`src/render/renderer.js`): `render(state, dt)` draws bg → dispenser → candy rack
(`_drawPacketsPuzzle` — one candy per filled cell via `_blitCandySprite`) → center holding tray
(`_drawCenterBox`) → jar queues (`_drawJarsPuzzle` iterates the lanes and draws each visible jar
back-to-front via `_drawOneJar`; the active front jar + previews show a color indicator; candies
pile at the jar bottom — no wells, no count) → candies
(`_drawCandies`, resting then animating so movers draw on top) → jar lids (`_drawJarLids` — the
descending closing lids, on top of the candies they seal) → spilling candies (`_drawTransit`)
→ particles → vignette → HUD → debug. Jars draw from the open-jar frame of `Jar/jars.png`
(`JAR.sheet.open`); on completion `_jarClose` animates the `JAR.sheet.lid` dropping on, then fades
the jar out. Containers are procedural glass (`_glassBox` + `_ghostSlot`
capacity wells); candies use the shared `_candy` / `_blitCandySprite` spritesheet primitive. Image loading, particles, `_candy`/`_seatCandy`,
`_drawFitContain`, `_roundRect` are all reused from the dormant code.

**Audio** is a static node graph built on first gesture (`audio.ensureStarted`); one-shot voices
(`pop`/`clink`/`seat`/`clear`/`warning`) are created per event. The active game calls
`audio.update(dt, 0, activity)` — speed 0 keeps the rumble/whir beds idle. **Haptics**
(`src/haptics/haptics.js`) are named events (`release`/`seat`/`clear`/`warning`), feature-detected,
no-op where `navigator.vibrate` is absent.

## Conventions specific to this repo

- **`src/config.js` is the single home for every tunable "feel" number** and for `LEVELS`. The
  active puzzle uses `CENTER` (capacity 6, open tray + basin/settle tunables), `JAR` (sizing,
  capacity, `queue` lane layout), `ANIM` (tween durations + fall stagger), plus the shared
  `COLORS`/`COLOR_ALIASES`/`THEME`/`AUDIO`/`HAPTICS`/`RENDER`/`ART`/`HUD`/`PACKET` (grid layout
  fields). Tune behavior here, not in module code.
- **Adding a level** = push to `LEVELS` and set `ACTIVE_LEVEL`. A level is
  `{ name, packetSlots, packets:[{id?, color, shape?, count}], jars:[{id?, color, shape?, capacity}],
  centerContainer:{capacity} }`. A `packet` is just a per-color SUPPLY group (its `count` candies are
  flattened into the rack), so `count` is any `>= 1`. Jars are distributed round-robin into 4 queue
  lanes (`lane = index % 4`); order them so each lane reads well. There is NO storage buffer, so the
  level must be winnable with only the center (cap 6) as a buffer — a robust pattern is keeping every
  color's jars reachable as lanes advance (e.g. a cyclic/Latin-square color order). Rules
  `validateLevel` warns about: 3–15 packets, count >= 1, center capacity 6, and total packet candies
  per color === total jar capacity per color (winnable). `color` may be a `COLOR_ALIASES` name
  (e.g. `yellow` → `amber`). Use `??` (not `||`) when reading capacities so a deliberate `0` sticks.
- **Candies are drawn from a spritesheet, with a procedural fallback** (`renderer._candy` →
  `_blitCandySprite`). The sheet (`newcandy/newcandies.png`) is a non-uniform collage, so each color
  names its candy by PIXEL box: `COLORS[key].spriteRect = [x,y,w,h]` (measured from the art); the
  blit fits that rect aspect-preserved into the candy's draw box. The SAME blit draws packet tiles
  (`_drawPacketsPuzzle` rack cells), the spilled/piling balls, and jar contents. Add a candy color = add a
  `COLORS` entry (`base/light/dark`, `spriteRect:[x,y,w,h]`, `shape`) and reference its key from a
  level's `packets`/`jars`. If the candy sheet changes, re-measure each `spriteRect`.
- **Layout** (`PuzzleGame.resize()`): HUD band → DISPENSER (top, sized as a screen fraction) →
  CENTER holding tray centred at `cx` under the dispenser's chute exit → the bottom JAR-QUEUE area
  (`JAR.queue.areaWFrac × areaHFrac` of the screen) pinned along the bottom, with the center placed
  ABOVE it and the dispenser height clamped so the chute leaves room for the holding tray between
  them. `_buildJarQueueGeom` derives the lane x-centres + active/preview jar sizes; `_refreshJarSlots`
  (on resize + every frame) assigns each visible jar its slot box, eases it toward target
  (`JAR.queue.slideTauMs`, the lane shift-forward animation), and fills `layout.jars` with the
  ACTIVE front-jar hit-boxes for input. The candy rack
  (`rackCols×rackRows` cells) SPANS the dispenser's inner rectangle (cells tile the whole cavity; a
  candy fills its cell). All sizes scale with the smaller
  screen dimension (px floors); coordinates are CSS pixels and the renderer scales by devicePixelRatio.
  Position helpers (`jarSlotPos`/`jarCandyR`) derive live from the layout; center candies have NO
  fixed slots — `centerRestPos(c)` resolves each one's own `restFx`/`restFy` (fractions of the box,
  set by the physics pile-up). The dispenser colliders live in `layout.dispenser`; the tray basin in
  `physics.basin`.
- **The holding tray is an OPEN tray, no grooves** (`containers/newholdingtray.png`). The PNG has
  wide transparent margins, so `_drawCenterBox` blits only its opaque region (`CENTER.artCrop`, a
  source-rect crop) to fill the box; `CENTER.aspect` (≈3.879) matches that opaque region. Candies
  rest by physics piling on the floor, NOT on wells. The inner walls + floor the funnel sim collides
  against are `CENTER.basin` (`left`/`right`/`floor` fractions of the box) — re-measure these (and
  `artCrop`/`aspect`) if the tray art changes. Settle feel is `CENTER.settle` + `ANIM.autoRouteDelayMs`.
- **Tuning the dispenser**: the `DISPENSER` config holds the collider geometry as fractions of the
  drawn PNG box (`innerRect`/`funnel`/`path`) plus physics tunables (`gravity`/`restitution`/
  `friction`/`damping`/`burstSpeed`/`substeps`/`candyRFrac`/`stuckMs`, plus the surface realism
  `wallFrictionMul`/`floorFrictionMul`/`spinAirDamp`/`rollGrip`). If a candy clips a border or
  the slants don't guide cleanly, adjust those fractions (press `D` to see the colliders) — speeds
  scale by dispenser width off `DISPENSER._refW`. Geometry was authored to the current art; if the
  PNG changes, re-tune the fractions and the `DISPENSER_ASPECT` constant in `puzzle.js`/`smoketest`.
- **Per-candy REAL physics**: each `COLORS[key].physics = { material, restitution, friction, mass,
  roll, jiggle, wobbleFreq, wobbleDamp, bump, airDrag, squashMax? }` models that candy's real
  material — red = STRICT **jelly** (gelatin: does NOT roll, barely bounces, grips where it lands,
  and QUIVERS with a big lightly-damped elastic jiggle; a little `bump` gives an irregular settle);
  amber/green = wrapped **hard** candy (lively, slick, rolls); blue = fluffy sponge **cake**
  (light/floaty via `airDrag`, soft catch + tiny rebound, COMPRESSES ~8–18% capped by `squashMax`
  then RECOVERS over ~0.3s with only 1–2 DAMPED jiggles — `wobbleFreq` with a HIGH `wobbleDamp`, so
  it's neither dead like clay nor endless like jelly); purple = **hard** pinwheel (bounciest,
  slickest). The soft-body fields drive a deformation/squash (rendered by `_candy`'s `squash` opt —
  oscillating when `wobbleFreq` is set, capped by `squashMax`) + bump kicks; `advanceWobble`
  (exported from `dispenser.js`) decays/oscillates it and is run both by the funnel sim (transit) and
  by `PuzzleGame` for settled center candies, so a landing jiggle/squash finishes after it rests. `onPacketTapped` stamps these
  onto the spilled candy; `DispenserPhysics` applies them: **gravity is mass-independent** (real
  acceleration), **mass** drives collision momentum (mass-weighted impulse + separation) and air
  drag (`damping/mass`), **restitution** is the candy's own bounce off rigid walls and the MIN of
  the pair in candy↔candy hits, **friction** is real **Coulomb** friction (μ·N) on the slant + tray
  floor (a slick candy slides far, a tacky one stops dead), and **roll** spins the sprite (ω=v/r) so
  hard candies visibly roll while gummies/slabs don't. The dispenser walls/slants are smooth (low
  `wallFrictionMul`) so everything still funnels; the tray floor uses full material friction so the
  pile-up shows the differences. `_depositTray` freezes each candy's `restAngle` (resting tumble
  orientation) and emits a material-tuned landing clink (hard = bright, soft = dull). The renderer's
  `_candy` takes an `angle` (transit uses live `c.angle`, settled center candies use `restAngle`).
  Defaults for a color without a `physics` block: `CANDY_PHYSICS_DEFAULT`.
- **Input is pure taps** (`setupTapInput` in `input.js`): a single pointerdown is hit-tested
  against rack candy cells (top), then the ACTIVE front-jar hit-boxes (`layout.jars`) and routed to
  the matching intent. No dragging.
- **Time is all `_time`-based** in the active game (no wall clock), so `smoketest.mjs` steps
  `update(dt)` until `_allSettled()` and everything — including the fall/move tweens and win/lose —
  reproduces deterministically.
