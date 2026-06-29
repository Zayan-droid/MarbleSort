# Candy Sort — Demo Level Fix Prompts (for Claude Code)

Paste these into Claude Code (VS Code terminal) **one at a time**, top to bottom.
Commit after each so you can roll back. Every prompt ends by running `node smoketest.mjs`
as a regression gate. Claude Code will auto-read `CLAUDE.md` for architecture context.

Priority order: **1 and 2 are the headliners** (they change whether this is a game).
3–8 are polish.

---

## 1. Make the demo level actually require sorting (BIGGEST gameplay fix)

```text
In src/config.js, LEVELS[0] ("Warm Up") is the active demo level (ACTIVE_LEVEL = 0).
Its 16 jars are arranged as a Latin square across 4 lanes, so at every moment the four
ACTIVE front jars are four DIFFERENT colors. That means every color is almost always
collectable, the center buffer (cap 6) is never needed, and the "stuck" loss is
unreachable — the level plays itself with no decisions.

Redesign LEVELS[0] so the player must use the center as a real buffer and sequence their
taps: at times a dropped color should have NO active jar and have to WAIT in the center,
and careless play should be able to get stuck. Approaches: cluster same-color jars so
multiple lane-fronts share a color, reduce how many colors are simultaneously active, or
stagger lane depths so 1–2 colors are temporarily unavailable.

Hard constraints (see validateLevel in src/game/levelValidator.js and CLAUDE.md):
- Keep it WINNABLE: total packet candies per color === total jar capacity per color.
- Center capacity stays 6; there is NO storage tray (center is the only buffer).
- packet count stays 3..15.
- Keep ALL changes in config (don't touch engine logic or the dormant conveyor code).

Then PROVE it: add a scratch script (or extend smoketest.mjs) that (a) plays the level to
a win with sensible greedy+buffer play, and (b) demonstrates a state where a color must
wait in the center, so buffering is genuinely exercised. Run `node smoketest.mjs` and
report results, then explain the new lane layout in 3-4 lines.
```

---

## 2. Verify & fix jar transparency / halos (BIGGEST visual risk)

```text
The bottom jars are blitted from Jar/jars.png using FIXED fractional source rects
(JAR.sheet.open / JAR.sheet.lid in src/config.js; drawn in src/render/renderer.js via
_jarSrc, _drawOneJar, _drawJarLids). I suspect jars.png has a baked dark/gradient
background instead of clean alpha — with up to ~12 jars on screen, each could show a faint
rectangular halo over the bright candy background.

First VERIFY: inspect Jar/jars.png and report whether the open-jar and lid frames (regions
given by JAR.sheet.open / JAR.sheet.lid) have transparent backgrounds or baked-in pixels
(check the alpha channel around the jar).

If baked in:
1. Alpha-trim + clean the frames. Reuse the existing alpha-bbox approach (_measureContent /
   _loadArt already crop other art) so the jar draws from its tight alpha bbox, not the raw
   fractional rect. If there are semi-opaque background pixels, knock low-alpha pixels to 0
   on an offscreen canvas at load time and draw from that cleaned canvas.
2. Add a subtle canvas drop shadow under each jar (NOT baked into art) so it still grounds.

If the PNG is already clean alpha: instead tighten JAR.sheet.open/lid so no neighboring-jar
pixels bleed in, and tell me no halo fix was needed.

Keep tunables in src/config.js. Run `node smoketest.mjs` and confirm it passes. Don't touch
the dormant conveyor code.
```

---

## 3. Restyle the in-game HUD to match the candy theme

```text
The in-game HUD (_drawHudPuzzle in src/render/renderer.js) draws dark translucent pills
("CANDY SORT" left, "★ <count>" right) that clash with the bright pastel candy scene.
Restyle them to fit the theme: light/frosted translucent pills with a soft candy-colored
border and gentle shadow, still readable over the bright background, rounded and playful.
Put the colors/opacities in a small HUD style block in src/config.js (keep it tunable
there) rather than hardcoding in the renderer. Don't change the text content or layout
logic — only the look. Run `node smoketest.mjs` to confirm nothing broke.
```

---

## 4. Give seated candies depth (contact shadow + gloss)

```text
Seated candies (in the center tray and in jars) render flat: _seatCandy / _drawCandies in
src/render/renderer.js blit the sprite with no contact shadow, while the procedural _candy
fallback has a shadow + specular gloss. Add a soft elliptical contact shadow beneath seated
SPRITE candies (like the one _candy draws) and a faint top specular highlight so they feel
grounded and glossy. Expose shadow/gloss strength as tunables in RENDER (src/config.js).
Make sure tumbling/transit candies and the rolling angle still render correctly. Verify
with `node smoketest.mjs`.
```

---

## 5. De-clutter the cap-2 jar interiors

```text
With cap-2 jars, each jar shows a large ghosted target-candy indicator (~34% of the bowl,
in _drawOneJar, src/render/renderer.js) PLUS the 2 real candies — it looks cluttered and
sparse at the same time. Improve it: shrink the indicator, draw it behind the candies, and
fade it out faster as the active jar fills; consider showing the full indicator only on
PREVIEW jars and just a small color dot on the active jar. Keep indicator size/alpha as
tunables in JAR (src/config.js). Preview jars must stay clearly color-readable. Verify with
`node smoketest.mjs`.
```

---

## 6. Pick a cohesive candy set + fix "yellow" reading as orange

```text
Candies are blitted from newcandy/newcandies.png via per-color spriteRect:[x,y,w,h] pixel
boxes in COLORS (src/config.js). The demo level uses red, yellow (aliased to amber), blue,
green. Two problems: (1) the picked candies come from a grab-bag sheet mixing flat-vector
and shaded-realistic styles, so the set looks incoherent; (2) "yellow" is aliased to amber
and reads orange, not yellow.

Open newcandy/newcandies.png, list the distinct candies with their pixel bounding boxes,
and propose a cohesive set of 4–5 candies in ONE consistent art style — including a
genuinely yellow one. Update the spriteRect values, and either remap the `yellow` alias or
give yellow its own COLORS entry, so the demo level reads as a coordinated set. Re-measure
boxes from the actual art (don't guess). Show me before/after, and verify `node
smoketest.mjs` passes.
```

---

## 7. Smooth the chute → tray handoff (no candy "pop")

```text
Candies spill through the dispenser funnel and exit at DISPENSER.path.exitY (0.94), then
get handed to the separate tray basin (CENTER.basin, set in src/game/puzzle.js resize()).
If the chute exit and the tray basin aren't aligned, candies can visibly pop/teleport
between the painted chute mouth and the tray as they fall. Press D in-app to see the
colliders.

Check the alignment between the chute exit line and the tray basin walls/floor, and adjust
DISPENSER.path / DISPENSER.funnel and/or CENTER.basin (and the center placement in resize())
so the candy stream is continuous from chute to pile with no visible jump. Keep all geometry
as config fractions. Confirm the tumble still settles cleanly and `node smoketest.mjs`
passes.
```

---

## 8. Fix the dead in-game hint text (quick win)

```text
In index.html, the in-game hint bar (#hint, the one always visible during play — NOT the
start overlay) still says "tap the tray to stash / retrieve" and mentions a storage tray
that no longer exists. The real game (see CLAUDE.md): tap a rack candy → one candy tumbles
into the center holding tray → it auto-routes into matching active jars; the center (cap 6)
is the only buffer. Rewrite ONLY the #hint text to describe the current controls accurately
and concisely. Leave the start overlay alone. Decide whether to keep "D for debug" in a
player-facing hint and note your choice.
```
