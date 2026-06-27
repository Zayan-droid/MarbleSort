# Candy Sort — Product Requirements Document

**Version:** 1.0 (v1 scope)
**Genre:** Hyper-casual sorting puzzle
**Platform:** Mobile (iOS / Android), portrait. HTML5 + Matter.js prototype for iteration.
**Based on:** VOODOO's *Marble Sort* core loop, re-themed and re-controlled.

---

## 1. Summary

Candy Sort is a hyper-casual candy-themed sorting game. Candies drop from packets at the top, land on a round conveyor the player spins by hand, and get delivered into matching trays on the left and right. It keeps Marble Sort's satisfying sort-and-clear loop and adds three things that make it its own game:

1. A candy theme with squishy candy physics.
2. Candies released **one at a time** with strong tactile feedback (tap = one, hold = a stream).
3. A **round conveyor the player rotates by hand** to steer candies toward their trays.

---

## 2. Design goals

- One-handed, pick-up-and-play, ASMR-satisfying.
- Differentiate from Marble Sort through theme, tactile control, and the player-spun conveyor.
- Maximize "juice" — every action carries haptics, sound, and VFX.
- Keep cognitive load low. This is a hyper-casual game, not a thinking game.

---

## 3. Players & platform

- **Audience:** broad casual mobile players (the Marble Sort / Color Switch crowd).
- **Primary platform:** mobile, portrait orientation.
- **Prototype:** HTML5 + Matter.js in the browser for fast iteration.

---

## 4. Screen layout

Three regions, portrait (reference: hand sketch).

- **Top — Candy Hopper.** A funnel holding the candy packets (default 6, in 2 rows of 3). A funnel neck channels released candies down to the conveyor.
- **Center — Round Conveyor.** A circular ring belt. Candies ride its surface. The player spins it clockwise or anticlockwise.
- **Left & Right — Tray Columns.** Vertical stacks of trays flanking the conveyor. Each tray wants one candy type.

---

## 5. Core gameplay loop

1. Player releases candies from packets (tap = one, hold = a stream).
2. Candies fall down the funnel onto the round conveyor with real candy physics.
3. Player spins the conveyor to carry candies toward the side holding the matching tray.
4. A candy near its matching tray leaves the belt and drops into the tray.
5. A tray with 3 matching candies clears and scores.
6. Clear all the level's trays to win. Let the conveyor overflow and you lose.

---

## 6. Elements

### 6.1 Candy packets (sources)

- Sit in the hopper at the top. Each packet holds a stack of one candy type (default 9 candies).
- **Tap:** releases exactly **one** candy, from the **bottom-right** of the packet. One strong haptic pulse + pop SFX + small release VFX.
- **Tap-and-hold:** releases candies one at a time in sequence, each with its own haptic pulse, VFX, and SFX, until the player lets go or the packet empties.
- This replaces Marble Sort's "tap = dump all 9." The player meters their own supply. It is the main pacing control and the main source of tactile satisfaction.

### 6.2 Candies

- Each candy has a **type** (color + shape — e.g., gummy, jelly, lollipop). Type decides which tray it belongs in.
- Candies have weight and squish. They tumble and settle with candy physics (see §8).

### 6.3 Round conveyor

- A ring-shaped belt in the center. Candies sit on the ring surface and travel around it.
- **Player-controlled rotation:** the player drags/spins the conveyor. Direction of drag sets clockwise vs anticlockwise. The ring carries momentum and eases to a stop when released.
- **Limited capacity:** the ring holds a fixed number of candies (slots). If it fills and a new candy has nowhere to go, the conveyor jams → lose (Marble Sort overflow rule).

### 6.4 Trays (destinations)

- Vertical columns on the left and right of the ring. Each tray wants one candy type (default 3 slots).
- Some trays may start as **"?"** (type hidden until the first candy enters) — optional, carried over from the original.
- **Auto-collect:** when a candy on the ring rotates close to a matching tray, it leaves the ring and drops into the tray. The player's job is to spin the ring so candies meet their trays.
- A tray with 3 matching candies clears (VFX + SFX + haptic) and scores. Cleared trays may be replaced by a new target (level-dependent), same as the original.

---

## 7. Controls

- **Tap a packet** → release one candy.
- **Hold a packet** → stream candies one by one.
- **Drag on the conveyor** → spin it clockwise/anticlockwise (with momentum).
- Candies **auto-deposit** into matching trays (no tap needed).

That is the entire control set. One-handed, no menus during play.

---

## 8. Physics requirements

Two distinct models.

- **Falling (packet → conveyor): real physics.** Use Matter.js. Candies fall under gravity, tumble, bounce, and settle exactly like Marble Sort's marbles. This phase must feel identical to the original's drop feel.
- **On the conveyor: deterministic angular track.** Once a candy lands on the ring, it snaps onto a circular track and is driven by a single angular value (the conveyor's rotation). Each candy holds a fixed radius and an angle; every frame the conveyor's rotation updates all their angles. This keeps the ring stable and predictable (no physics jitter) and makes "candy near tray" trivial to detect.
- **Transition:** when a falling candy hits the ring (collision), it is captured onto the nearest free track slot and leaves the physics simulation.
- **Deposit:** when a track candy reaches a matching tray's zone, it leaves the track and animates into the tray.

This split — real physics for the fall, deterministic angles for the ring — is the recommended architecture.

---

## 9. Feedback / juice

Every event gets haptics + sound + VFX. Minimum set:

| Event | Haptic | SFX | VFX |
|---|---|---|---|
| Tap release (1 candy) | strong single pulse | candy "pop" | sparkle at packet mouth |
| Hold stream (each candy) | pulse per candy | rapid pops | sparkle per candy |
| Candy lands on ring | light tap (optional) | soft clink / squish | small squish / dust |
| Candy rolls on ring | — | subtle rolling / ASMR loop | — |
| Candy enters tray | light tap | satisfying "plop" | candy settle |
| Tray clears (3 collected) | strong pulse | bright chime / jingle | burst + score popup |
| Conveyor overflow (lose) | long buzz | fail sound | screen feedback |

Haptics are a core pillar. The prototype uses the Web Vibration API (Android web only; iOS Safari has no web haptics, so a native build is needed for full haptics on iOS).

---

## 10. Win / lose / economy

- **Win a level:** clear all required trays / sort all candies.
- **Lose:** the conveyor fills with candies that can't be placed (overflow), same as Marble Sort.
- **Closed economy (important):** for each candy type, total candies released = (number of trays for that type) × (tray capacity). Everything comes out even — no leftover candies, no empty slots. This is the satisfaction of the original; preserve it.

---

## 11. Art direction

Bright candy-factory look. Glossy, colorful candies, each type visually distinct by color **and** shape. Squishy, tactile feel. Clean, readable, friendly. Strong "satisfying" polish on every interaction.

---

## 12. Audio direction

Upbeat, light, ASMR-leaning. Candy pops, clinks, rolling sounds, cheerful clears. Sound should make the one-by-one release and the tray clears feel great.

---

## 13. Tunable parameters (config.js)

All in one config file. At minimum:

- `candyTypesCount`, `packetsCount`, `candiesPerPacket`
- `trayCapacity`, `traysPerSide`, `trayTargets`, `mysteryTrayChance`
- `conveyorRadius`, `conveyorSlotCount`, `conveyorMaxAngularSpeed`, `conveyorFriction` (momentum decay)
- `gravity`, `candyRestitution` (bounce), `candyDensity`, `candySize`
- `holdStreamInterval` (ms between candies while holding)
- `depositProximityAngle` (how close a candy must be to a tray to deposit)
- `hapticPatterns` per event
- `scoring` values

Changing any value here should change the game with no other code edits.

---

## 14. Out of scope for v1 / future enhancements

Documented but **not** in v1 (v1 = candy base + original Marble Sort):

- **Color-switch gate** on the conveyor — candies change type as they pass a gate. Strong "gifted dopamine" engine. Lead candidate for v2.
- **Overload chains** — a clearing tray sets off its neighbors.
- **Horizontal row bonus** — a full row of trays clears together.

Flag if any of these should move into v1.

---

## 15. Success metrics

D1 / D7 retention, average session length, levels per session, ad-view rate. Standard hyper-casual KPIs.