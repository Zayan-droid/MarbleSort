// config.js — ALL tunable constants live here.
// Tweak feel, difficulty, colors, audio levels, and haptic intensities in one place.

export const COLORS = {
  // Candy palette (bright, glossy). The renderer blits each type from the candy spritesheet
  // (`newcandy/newcandies.png`, a non-uniform collage), so each color carries `spriteRect:
  // [x,y,w,h]` — the candy's PIXEL bounding box in that sheet (measured from the art). The blit
  // fits that rect, aspect-preserved, into the candy's draw box, and is used EVERYWHERE a candy
  // is drawn (packet tiles, the spilled/piling balls, jar contents, the jar target indicator).
  // `base/light/dark` still tint particle bursts + the procedural fallback (drawn only until the
  // sheet loads); `shape` is that fallback's silhouette. `art`/`groove` feed the DORMANT tray code.
  // physics: real material behaviour for the funnel/tray sim. Common: restitution (bounce), friction
  // (slide/grip), mass (momentum + air drag), roll (does it spin like a disc). Soft-body extras:
  //   jiggle     — how much the candy DEFORMS per impact (0 = rigid)
  //   wobbleFreq — oscillation rate of an ELASTIC jiggle (rad/s); 0 = no oscillation (plastic squash)
  //   wobbleDamp — how fast a deformation settles back (per s); low = wobbles long, high = soft/quick
  //   bump       — surface unevenness: lateral + angular KICK on each firm contact (0 = smooth)
  //   airDrag    — extra air resistance (1 = normal; >1 = floaty, falls slower)
  // red = STRICT JELLY (gelatin): does NOT roll like a disc — it deforms, barely bounces (energy
  // goes into the wobble, not rebound), grips where it lands (high friction → translation dies fast),
  // and QUIVERS — a big, fast, lightly-damped jiggle that keeps oscillating for a moment after it
  // rests. A little surface unevenness (low `bump`) gives an irregular settle, not a clean spin.
  red:    { base: '#f0524f', light: '#ff9b97', dark: '#9e2b2c', shape: 'round',   spriteRect: [64, 1082, 107, 106], art: 'red',    groove: { w: 0.60, h: 0.215 }, physics: { material: 'jelly', restitution: 0.12, friction: 0.64, mass: 1.20, roll: false, jiggle: 0.55, wobbleFreq: 34, wobbleDamp: 4.2, bump: 0.22, airDrag: 1.0 } },
  amber:  { base: '#f7b53d', light: '#ffd79a', dark: '#a06a14', shape: 'oval',    spriteRect: [59, 625, 126, 123],  art: 'mango',  groove: { w: 0.60, h: 0.26 },  physics: { material: 'hard',  restitution: 0.48, friction: 0.10, mass: 0.85, roll: true,  jiggle: 0,    wobbleFreq: 0,  wobbleDamp: 0,   bump: 0,    airDrag: 1.0 } },
  green:  { base: '#5fc878', light: '#bdf0c4', dark: '#2f6b40', shape: 'square',  spriteRect: [55, 289, 122, 121],  art: 'green',  groove: { w: 0.46, h: 0.205 }, physics: { material: 'hard',  restitution: 0.48, friction: 0.10, mass: 0.85, roll: true,  jiggle: 0,    wobbleFreq: 0,  wobbleDamp: 0,   bump: 0,    airDrag: 1.0 } },
  // blue = FLUFFY SPONGE CAKE: not jelly, not rubber. On impact it COMPRESSES first and ABSORBS the
  // hit (tiny rebound, restitution ~0.15 — a candy landing on it is caught softly, energy sinks into
  // the foam), RECOVERS slowly with only 1–2 small damped jiggles (high `wobbleDamp`, modest freq),
  // and SETTLES. Squash is gentle (8–18%, `squashMax`); medium-high friction so candies don't skate;
  // light + floaty descent (high `airDrag`) like air-filled sponge.
  blue:   { base: '#5aa6f5', light: '#a9d2ff', dark: '#26568f', shape: 'pill',    spriteRect: [1107, 294, 95, 90],  art: 'blue',   groove: { w: 0.66, h: 0.180 }, physics: { material: 'cake',  restitution: 0.15, friction: 0.72, mass: 0.55, roll: false, jiggle: 0.5,  wobbleFreq: 26, wobbleDamp: 7.0, bump: 0,    airDrag: 2.4, squashMax: 0.18 } },
  purple: { base: '#b274f0', light: '#dcc2ff', dark: '#5d3b8f', shape: 'diamond', spriteRect: [211, 298, 120, 97],  art: 'purple', groove: { w: 0.56, h: 0.220 }, physics: { material: 'hard',  restitution: 0.55, friction: 0.06, mass: 1.05, roll: true,  jiggle: 0,    wobbleFreq: 0,  wobbleDamp: 0,   bump: 0,    airDrag: 1.0 } },
};

// Default candy material if a color omits `physics` (a neutral, mildly bouncy rigid candy).
export const CANDY_PHYSICS_DEFAULT = { material: 'hard', restitution: 0.35, friction: 0.18, mass: 1.0, roll: true, jiggle: 0, wobbleFreq: 0, wobbleDamp: 0, bump: 0, airDrag: 1.0 };

// Friendly color names from level data that map onto a real COLORS key (so a level can
// say `yellow` and reuse amber's art). resolveColor() in traySlots.js / state.js applies it.
export const COLOR_ALIASES = {
  yellow: 'amber',
};

export const THEME = {
  bg: '#0b0d12',
  bgVignette: 'rgba(0,0,0,0.55)',
  track: '#262b36',
  trackEdge: '#161a22',
  trackHighlight: 'rgba(255,255,255,0.06)',
  trayBody: '#2c3240',
  trayRim: '#3c4658',
  binRim: '#3a4250',
  text: '#dfe4ec',
  zoneLabel: '#5d677a',
};

export const DIAL = {
  baseSpeed: 0.5,         // rad/s — gentle auto-rotate of the belt (sign = CCW positive)
  baseDirection: 1,       // 1 = CCW, -1 = CW
  // Inertia / load. Effective inertia = inertiaBase + inertiaPerMarble * marbleCount
  inertiaBase: 1.0,
  inertiaPerMarble: 0.16,
  // Friction pulling a free-spinning dial back toward base speed (per second).
  // Higher load => slower decay (loaded flywheel coasts longer).
  decayBase: 2.6,
  decayLoadRelief: 0.06,  // decay /= (1 + relief * marbleCount)
  // Drag tracking. responsiveness=1 -> perfectly 1:1; load lowers it slightly for "weight".
  dragResponsiveness: 0.92,
  dragLoadDrag: 0.012,    // responsiveness -= this * marbleCount (clamped)
  maxSpeed: 7.0,          // rad/s clamp
  detents: 48,            // angular notches around the full circle
  detentMaxRate: 26,      // max detent ticks fired per second (anti machine-gun)
};

export const LOOP = {
  // The round conveyor is sized by SCREEN HEIGHT (the hero element), then derives its belt
  // thickness from the inner/outer ratio. resize() may shrink it below outerDiamFrac only
  // when the screen is too narrow to also fit a 1-tray gap + the minimum visible trays.
  outerDiamFrac: 0.62,    // target OUTER conveyor diameter as a frac of screen HEIGHT
  outerDiamMin: 0.60,     // clamp the target into the 60%–65%-of-height band
  outerDiamMax: 0.65,
  innerDiamFrac: 0.585,   // INNER empty-circle diameter as a frac of the OUTER diameter (55%–62%)
  minOuterRadiusPx: 70,   // hard floor for the outer radius on ultra-narrow screens
  marginFrac: 0.04,       // gap kept between the loop's OUTER rail and the tray/bin rows
};

// Radial (centrifugal) physics — the "marbles in a spinning bowl" feel. The angular
// TRANSPORT stays authoritative (see state.js); this only governs each ball's distance
// from the loop center, between the inner rail (innerR) and the HARD outer rail (outerR).
export const RADIAL = {
  centrifugalGain: 1.0,   // outward accel = gain * omega^2 * r  (faster spin -> flung out harder)
  settleStiffness: 26,    // spring (per s^2 per px) pulling a ball back to the track centerline at rest
  damping: 5.0,           // radial velocity damping per second (kills jelly wobble)
  restitution: 0.42,      // bounce when a ball slams a rail
  railClinkMinSpeed: 34,  // |radial speed| (px/s) at a rail hit above which a clack fires
  rollScale: 1.0,         // visual spin: roll rate = rollScale * tangential_speed / ballRadius
};

export const MARBLE = {
  radiusFrac: 0.028,      // fraction of min(width,height)
  minRadiusPx: 12,
  speedJitter: 0.12,      // +/- per-marble ride-speed variation (drives jostle/clinks)
  packFactor: 0.94,       // min angular gap = 2*r*packFactor / R (marbles can't overlap)
  entryDurationMs: 240,   // fall time from a tray down onto the loop
  // Anti-strobe: cap the per-frame angular step so a fast spin / low frame rate
  // can't make a ball "jump" a visible gap (which reads as a faint ghost down the
  // track). Expressed as multiples of the ball radius of on-track travel per frame.
  maxStepRadii: 1.8,
};

export const HUD = {
  // Reserved top band (a fraction of HEIGHT) so nothing collides with the HUD.
  // The packet row sits directly under it. Simple level/coins pills are drawn here.
  topInsetFrac: 0.07,
};

export const TRAY = {
  // SOURCE PACKETS (code `trays`): one centered horizontal ROW under the HUD band,
  // every packet the same size. Art: CandyTrayPackets/<color>_candy. Resolved in resize().
  sizeFrac: 0.072,        // packet "radius" as frac of min(w,h)
  minSizePx: 28,          // floor so packets stay tappable on small screens
  spreadAimFrac: 1.12,    // preferred row span as a multiple of loop diameter
};

export const BIN = {
  // COLLECTION TRAYS (code `bins`): two symmetric vertical COLUMNS flanking the loop.
  // Each tray's ART is drawn preserving its own aspect (renderer auto-crops transparent
  // padding) at a shared HEIGHT, so mismatched source art never squishes. Per-color
  // `traySizeMul` can enlarge one tray. Art: Trays/<color>_tray. Resolved in resize().
  heightFrac: 0.255,        // base tray height as frac of min(w,h) (may shrink to fit a column)
  minHeightPx: 96,          // preferred floor so trays stay readable
  minTrayWidthPx: 30,       // HARD floor on tray box width so minVisible trays can always fit
  columnWidthFrac: 0.78,    // column box width as a frac of tray height (trays are uniform 0.75 aspect)
  colVPadFrac: 0.008,       // vertical gap between stacked collection trays (frac of min(w,h)) — tight
  // Grooves: the art has 3 wells centered at ~0.27 / 0.50 / 0.73 of tray height. A seated
  // candy is cropped to its sprite content and scaled to fill `candyGrooveFill` of the
  // groove cavity (preserving aspect), centered on the groove.
  slotSpreadFrac: 0.23,     // groove vertical centers = 0.5 ± this (× tray height)
  grooveWidthFrac: 0.58,    // FALLBACK cavity width (frac of drawn tray WIDTH) if a color omits `groove`
  grooveHeightFrac: 0.215,  // FALLBACK cavity height (frac of drawn tray HEIGHT)
  candyGrooveFill: 0.9,     // seated candy fills this fraction of its groove cavity
  candyRadiusFrac: 0.108,   // fallback seated-candy radius (procedural, frac of tray height)
  slots: 3,                 // DEFAULT tray capacity (overridable per tray via level data)
  captureArcDeg: 18,        // angular half-window at the tray's drop point where a candy detaches
  dropDurationMs: 300,      // fall time from the loop down into the tray
  clearHoldMs: 200,         // duration of the full tray's pop-out (scale up + fade) before it clears
  clearPopScale: 0.24,      // extra scale at the peak of the clear pop-out
  // Each physical slot owns a QUEUE of upcoming trays (different colors). They are laid out
  // as a clean, NON-OVERLAPPING horizontal line per slot: the active tray sits nearest the
  // loop, and the upcoming trays line up FULL-SIZE outward toward the screen edge — a proper
  // waiting line, not a stacked deck. `resize()` shows as many as fully fit on screen (up to
  // maxVisible), shrinking the loop where there's room so at least a few trays are visible.
  queue: {
    maxVisible: 4,          // target trays shown per slot incl. the active one (cap)
    minVisible: 3,          // ALWAYS show at least this many per slot (shrinks trays/dial to fit)
    gapFrac: 0.04,          // gap between adjacent trays in a queue line, as a frac of tray width (tight)
    alpha: 1,               // upcoming trays are fully visible (no fade)
    slideTauMs: 90,         // smoothing time-constant for trays sliding forward on a shift
  },
};

export const ART = {
  // Blit scale factors for the image assets, each relative to the element's layout box.
  candyFill: 1.22,        // spritesheet candy blit size vs the candy's 2r box
  packetFill: 1.10,       // source-packet art size vs the packet's 2r box
  trayFill: 1.0,          // collection-tray art size vs the tray's box (1.0 = exact, so grooves align)
};

export const RULES = {
  loopCapacity: 14,       // max marbles riding the loop before game over (jam)
  warnAt: 11,             // belt count at which "jam imminent" warnings fire
};

export const PACKET = {
  // TOP SOURCE PACKETS — finite, MONO-COLOR trays drawn from a queue (see packets.js). Marble
  // Sort style: each packet is ONE color only, holding `count` candies of that color. They sit
  // in a clean GRID inside a light "feeder" panel across the top (a machine input area, not
  // floating cards). A single TAP releases that packet's whole batch onto the loop ONE AT A
  // TIME (a short stream, driven by state._time); the emptied packet is then replaced by the
  // next queued packet. Tapping a packet is disabled while it is releasing.
  slotCount: 9,            // default number of top packet slots SHOWN (a level may override via packetSlots)
  releaseIntervalMs: 120,  // gap between streamed candies while a tapped packet empties
  autoChunk: 6,            // fallback only: candies per auto-derived packet when a level omits topPacketQueue
  // feeder-grid layout (all sizes scale with the smaller screen dimension, px floors):
  columns: 3,              // preferred grid columns in portrait (Marble-Sort style); rows = ceil(slots/cols)
  maxRows: 3,              // cap on grid rows (more rows ⇒ smaller tiles)
  tileFrac: 0.092,         // target packet-tile size as a frac of min(w,h)
  minTilePx: 34,           // preferred floor so tiles stay tappable
  maxTilePx: 96,           // cap so tiles never get huge on big screens
  gapFrac: 0.016,          // gap between tiles, as a frac of min(w,h)
  padFrac: 0.016,          // feeder-panel inner padding, as a frac of min(w,h)
  vBudgetFrac: 0.42,       // feeder panel won't grow taller than this fraction of screen height
  fallbackMaxCandies: 9,   // mono candies drawn inside a tile when its tray art hasn't loaded yet
};

export const SEAT = {
  // A ball can only drop OFF the belt into a bin once the belt has FULLY returned
  // to auto-flow — the player isn't spinning AND the flywheel has decayed back to
  // base speed — and has stayed that way for autoFlowDelayMs. While the player
  // spins (or the dial is still coasting), balls just keep riding.
  autoFlowDelayMs: 250,   // hold auto-flow this long before drop-offs are allowed
  autoFlowEpsilon: 0.12,  // |omega - baseSpeed*dir| under this (and not dragging) = "fully auto flow"
};

export const AUDIO = {
  master: 0.85,
  masterLowpassHz: 6500,
  reverbWet: 0.22,
  reverbSeconds: 1.4,
  reverbDecay: 3.2,
  clinkGain: 0.5,
  clinkThrottleMs: 28,
  clinkMaxPerFrame: 2,
  clinkBaseHz: 880,
  clinkPitchJitter: 0.32,
  clinkDecay: 0.13,
  rumbleGain: 0.5,
  rumbleCutoffMin: 180,
  rumbleCutoffMax: 1400,
  rumbleSpeedRef: 6.0,
  whirGain: 0.12,
  whirThreshold: 1.2,
  whirBaseHz: 220,
  seatGain: 0.6,
  seatHz: 150,
  seatDecay: 0.22,
  // Punchy candy "pop" on release: a short bandpassed noise burst + a quick tonal blip.
  popGain: 0.5,
  popHz: 540,
  popQ: 2.2,
  popDecay: 0.085,
  clearGain: 0.32,
  clearNotes: [523.25, 659.25, 783.99, 1046.5],
  clearStepMs: 70,
  padGain: 0.06,
  padSwell: 0.05,
  padNotes: [130.81, 196.0, 261.63],
  warnGain: 0.18,
  warnHz: 320,
};

export const HAPTICS = {
  enabled: true,
  tickMs: 12,
  seatMs: 28,
  warningMs: 40,
  candyRelease: 40,       // strong single pulse on a candy release (tap / stream)
  clearPattern: [22, 40, 22, 40, 30],
  rumbleMinIntervalMs: 60,
  rumbleMaxIntervalMs: 140,
  rumbleMinPulse: 6,
  rumbleMaxPulse: 16,
  rumbleSpeedRef: 6.0,
};

export const RENDER = {
  marbleShadow: 'rgba(0,0,0,0.35)',
  specular: 'rgba(255,255,255,0.9)',
  particleCount: 22,
  particleLifeMs: 620,
  vignette: 0.55,
  // Seated sprite-candy grounding (center tray + jars): blitted candies are otherwise flat, so a
  // soft elliptical CONTACT SHADOW is drawn beneath them + a faint TOP GLOSS on top — matching the
  // shadow/specular the procedural _candy fallback already has. Only SEATED candies use these;
  // tumbling/transit candies keep the subtler default shadow (and no gloss) so they don't drag a
  // ground shadow through the air. Tune strength here.
  candyShadow: {
    alpha: 0.30,    // contact-shadow opacity (0 = disable the seated contact shadow)
    scaleX: 0.86,   // shadow half-width  as a multiple of the candy radius r
    scaleY: 0.30,   // shadow half-height as a multiple of r (flatter ⇒ reads as more grounded)
    offsetY: 0.86,  // shadow centre below the candy centre (× r) — sits at the candy's base
  },
  candyGloss: 0.22, // top specular-highlight opacity on seated sprite candies (0 = disable)
};

// ---- NEW MECHANIC TUNABLES (packet -> center -> jars) ---------
// The active game is the tap-driven packet puzzle (see src/game/puzzle.js). These
// govern its layout + feel. The conveyor constants above (DIAL/LOOP/RADIAL/MARBLE/
// SEAT/RULES/BIN) are kept DORMANT for the retired belt code in state.js.

// CENTER holding container — the main decision space. An OPEN tray (containers/newholdingtray.png):
// candies TUMBLE in off the dispenser chute and PILE on its floor (no fixed grooves).
export const CENTER = {
  capacity: 6,            // candies it can hold (one packet's worth)
  cols: 3, rows: 2,       // (fallback grid metrics only; the live tray uses physics piling)
  // box = the OPAQUE tray region of newholdingtray.png (the art has wide transparent margins, so
  // `artCrop` below blits only that region). 1408×363 opaque -> aspect ≈ 3.879.
  aspect: 3.879,
  // source-rect crop (fractions of the 1672×941 PNG) of the opaque tray — drawn to fill the box.
  artCrop: { x: 0.078, y: 0.276, w: 0.842, h: 0.386 },
  heightFracOfMid: 0.84,  // box height as a frac of the middle band height
  maxHeightFrac: 0.34,    // and never taller than this frac of min(w,h)
  padFrac: 0.12,          // inner padding as a frac of box width (fallback only)
  candyCellFill: 0.46,    // candy radius as a frac of the smaller grid-cell dimension (fallback)
  // The cream BASIN interior, MEASURED from the cropped tray art as fractions of the drawn box
  // (left/right = inner walls as frac of WIDTH, floor = inner floor as frac of HEIGHT). The funnel
  // sim continues past the chute into this basin so candies bounce off these walls/floor and pile.
  basin: { left: 0.104, right: 0.876, floor: 0.719 },
  // candies are considered SETTLED (and handed to the container) once every one is in the basin and
  // moving slower than `speedFracH` of the box height per second for `holdMs`. `maxMs` is only a
  // hang-guard: the natural calm-settle (~4s for a full packet) fires well before it.
  settle: { speedFracH: 0.20, holdMs: 130, maxMs: 6000 },
  // seated / in-transit candy radius as a frac of box HEIGHT — capped to still clear the chute.
  candyRadiusFracH: 0.15,
  // TILT: while the tray pours into a jar it TIPS toward that jar (see ANIM.pour). The tray art and
  // the candies still resting in it rotate together around a pivot near the tray's base. Cosmetic.
  tilt: { maxRad: 0.17, tauMs: 95, pivotYFrac: 0.62 },
};

// BOTTOM jars — target containers, one color each, arranged as 4 QUEUE LANES along the bottom
// (see JAR.queue + BottomJarQueueLayout in puzzle.js). The FRONT jar of each lane is the active,
// collectable jar; the jars behind it are read-only previews. Art is the OPEN-jar frame of
// Jar/jars.png; when the active jar fills, the LID drops on (closing animation), the jar is
// removed, and the lane shifts forward so the next jar becomes active.
export const JAR = {
  defaultCapacity: 6,
  heightFrac: 0.2,        // (legacy single-row sizing) jar box height as a frac of min(w,h)
  minHeightPx: 104,
  aspect: 0.90,           // open-jar frame aspect (Jar/jars.png), w/h ≈ 201/224
  gapFrac: 0.028,         // (legacy) gap between jars as a frac of min(w,h)
  bottomMarginFrac: 0.03,
  cols: 3,                // candy columns inside a jar (rows = ceil(capacity/cols))
  candyCellFill: 0.44,
  // BOTTOM JAR-QUEUE LAYOUT. The bottom collection area is a box ~areaWFrac × areaHFrac of the
  // screen, centred near the bottom, split into `lanes` vertical queues. Each lane shows up to
  // `maxVisible` jars (front + previews); if a lane has fewer remaining, only those show. The
  // front jar (slot 0) sits at the TOP, full size + opaque (active); previews stack downward below
  // it, scaled by `previewScale` and faded to `previewAlpha`. On a completion the lane slides forward
  // (smoothed by `slideTauMs`) and a hidden jar (if any) appears at the back.
  queue: {
    lanes: 4,             // number of jar queues across the bottom
    maxVisible: 3,        // jars shown per lane (front + 2 previews) when that many remain
    minVisible: 3,        // target minimum visible per lane (informational; capped by maxVisible)
    areaWFrac: 0.80,      // bottom area width as a frac of screen width
    areaHFrac: 0.26,      // bottom area height as a frac of screen height (trimmed from 0.30 to give
                          // the taller dispenser room above the holding tray)
    bottomMarginFrac: 0.02, // gap below the area as a frac of screen height
    laneGapFrac: 0.03,    // gap between lanes as a frac of the area width
    vGapFrac: 0.03,       // gap between stacked jars as a frac of the area height
    previewScale: 0.8,    // preview jars are this fraction of the active jar's size
    previewAlpha: 0.6,    // and faded to this alpha (still readable)
    slideTauMs: 110,      // smoothing time-constant for jars sliding forward on a shift
  },
  // The clear glass bowl of the open-jar frame where candies (and the target indicator) sit, as
  // fractions of the jar box (cx/cy = center, w/h = size). Re-tune if the jar art changes.
  glass: { cx: 0.5, cy: 0.6, w: 0.64, h: 0.56 },
  // frames inside Jar/jars.png, as fractions of the 1536×1024 sheet. The PNG has CLEAN alpha (the
  // background is fully transparent; the ~42% semi-opaque pixels are the translucent GLASS body, not
  // a halo), so these are the jars' tight alpha bounding boxes — verified against the alpha channel,
  // with no neighbouring-jar pixels inside the rect (the open jar ends at x≈206px, its neighbour
  // only starts at x≈229px). No de-haloing / alpha-trim is needed at load time.
  sheet: {
    open: { x: 0.0039, y: 0.2012, w: 0.1309, h: 0.2197 }, // empty open jar — the INITIAL look
    lid:  { x: 0.0234, y: 0.0430, w: 0.1367, h: 0.1006 }, // the lid alone — drops on to close
  },
  // closing animation when a jar fills: the lid drops on, holds, then the sealed jar fades away
  // and the jar is REMOVED. Times are ms off the dt-accumulated clock (jar._clearStart).
  close: { lidDropMs: 360, holdMs: 150, fadeMs: 340 },
};

// Movement tweens (eased, off the dt-accumulated clock) — used for every move EXCEPT the
// packet -> center spill, which runs the small custom funnel sim below (see dispenser.js).
export const ANIM = {
  fallDurMs: 360,         // (legacy) packet -> center fall, now only the chute -> slot handoff
  fallStaggerMs: 70,      // delay between successive candies of one packet
  moveDurMs: 300,         // center -> jar / center -> tray
  returnDurMs: 320,       // tray -> center
  intakeDurMs: 480,       // (legacy) chute -> center handoff — candies now tumble in via physics
  returnPackDurMs: 360,   // tray -> center: glide a retrieved group into its packed row
  bounce: 0.16,           // settle-bounce amplitude on arrival
  autoRouteDelayMs: 240,  // pause after candies settle in the tray before they auto-flow onward,
                          // so the player SEES them tumble in and rest before they leave
  // POUR: candies don't glide straight to a jar — the holding tray TIPS toward the target jar and
  // the matching candies roll over its lip and arc down in (a lip-then-drop quadratic Bézier; see
  // puzzle.js _pourCandies / candyScreenPos). One jar is poured at a time so the tray tilts a single
  // direction. Cosmetic + deterministic (driven off _time), so the headless smoketest is unaffected.
  pour: {
    durMs: 540,        // travel time tray -> jar (slower than a glide so the pour reads)
    staggerMs: 95,     // gap between successive candies leaving (a one-by-one pouring stream)
    lipOutFrac: 0.12,  // how far past the tray lip (frac of tray WIDTH) the arc bulges toward the jar
    lipLiftFrac: 0.12, // how far the candy rises over the rim (frac of tray HEIGHT) before it drops
    spinTurns: 1.1,    // tumble (turns) a ROLLING candy makes during the pour; gummies/jelly don't spin
  },
};

// ---- CANDY DISPENSER (the candy_dispenser.png packet rack + funnel physics) ----
// The PNG is purely visual; these are the invisible colliders + physics tunables. ALL geometry
// is expressed as FRACTIONS of the dispenser's DRAWN box (origin = box top-left), so it scales to
// any screen size. Packets sit ONLY inside `innerRect`; tapping one spills its 6 candies, which
// fall under gravity, slide down the two diagonal slants, funnel through the vertical chute, and
// exit at `path.exitY` into the center container. Press D in-game to see the colliders and tune
// these fractions. This is a tiny self-contained sim — NOT a physics engine.
export const DISPENSER = {
  // The dispenser box is sized DIRECTLY as a fraction of the screen and pinned to the top — it
  // is the hero. candy_dispenser.png (1672×941, wide) is drawn to FILL this box, so it stretches to
  // fit; the colliders below are fractions of the box, so they stay aligned to the art either
  // way. (Hitting both targets at once is only possible by not preserving the art's aspect.)
  widthFrac: 0.96,         // box width as a frac of screen width (wider hero; capped to fit margins)
  heightFrac: 0.62,        // box height as a frac of screen height (taller hero; clamped on resize
                           // so the center+jars tail below the chute still fits — the jar area was
                           // trimmed to 0.26 of height to give this extra vertical room)
  // inner rectangle (the open mint/blue cavity) where the candy rack sits (frac of the drawn box).
  // MEASURED from candy_dispenser.png's actual cavity (per-row alpha bbox, not eyeballed): the cavity
  // walls hold ~0.125..0.873 from y≈0.15 down to where it starts narrowing (~0.55).
  innerRect: { left: 0.13, right: 0.87, top: 0.15, bottom: 0.52 },
  // diagonal funnel: the cavity narrows from the rectangle's bottom corners to the chute mouth. The
  // slant line was FIT to the measured cavity edges — a straight (0.13,0.55)→(0.462,0.82) on the left
  // (and mirror on the right) tracks the painted slant within ~0.005 the whole way down.
  funnel: { topY: 0.55, botY: 0.82 },
  // central vertical chute (path) + the exit line where candies leave the dispenser. The measured
  // chute mouth is ~0.462..0.534 (centre ≈0.498) — matching it keeps candies inside the visible spout.
  // exitY: candies ride the chute walls down into the spout and only release into the center once they
  // cross it, near the very bottom of the dispenser (the spout art runs to ~0.965).
  path: { left: 0.462, right: 0.534, exitY: 0.94 },
  // CANDY RACK grid inside the inner rectangle: the dispenser is FILLED with individual candies
  // (rackCols × rackRows of them, SPANNING the whole inner rect) and ONE TAP drops ONE candy.
  // RESPONSIVE: resize() picks whichever grid in `rackGrids` makes the BIGGEST candies for the
  // current cavity aspect, so a tall PORTRAIT phone uses the squarer 6×6 (candies fill all the way
  // down instead of clustering small at the top) while a WIDE screen uses 11×3 (a wide row of bigger
  // candies, not a sparse 6-wide bar). rackCols/rackRows below are the default/fallback (used before
  // the first resize, and by any code that reads the constants).
  // NB: every grid's cols must NOT be a multiple of the colour count (4) — otherwise the round-robin
  // rack lines each column up as a single colour, every colour is always tappable, and the
  // center-buffer puzzle collapses (no waiting, no stuck). 11 and 6 are both fine. (Both grids are
  // verified puzzle-preserving by smoketest partB/partJ.) Fewer ROWS → taller cells → BIGGER candies.
  rackCols: 6, rackRows: 6,
  rackGrids: [{ cols: 11, rows: 3 }, { cols: 6, rows: 6 }],
  // The candy rack SPREADS down to `rackBottomFrac` of the box (not just the rectangular cavity), so
  // the lower rows reach into the FUNNEL and the candies fill the dispenser instead of clustering at
  // the top. Rows below the funnel mouth TAPER: each row is positioned + sized to the cavity width at
  // its height (it narrows toward the chute), so candies always stay inside the visible glass. Keep
  // this above the chute walls so the bottom row doesn't shrink to nothing (~0.70 ends just above the
  // funnel's narrow throat).
  rackBottomFrac: 0.70,
  rackCandyFill: 0.7,      // candy diameter as a frac of its (inscribed) cell — leaves clear space on
                           // all 4 sides of each untouched rack candy (≥30% gap of the pitch at every
                           // screen size; the candy is sized from the SMALLER cell dim so both axes have
                           // margin, and it scales with the cell so the spacing is screen-independent)
  packetGapFrac: 0.02,     // (legacy)
  packetPadFrac: 0.015,    // small padding inside the inner rectangle before the grid spans it
  packetMaxCols: 3,        // (legacy; the rack uses rackCols/rackRows)
  // physics tunables (lengths/speeds scale with the dispenser width at resize):
  gravity: 1350,           // px/s^2 at the reference width (DISPENSER._refW) — LOW so candies drift
                           // and TUMBLE down the funnel slowly, finding their way to the chute,
                           // instead of snapping to the exit
  restitution: 0.42,       // bounce off slants / walls — a bit livelier so they jostle/tumble
  friction: 0.08,          // tangential energy lost sliding along a surface
  damping: 0.012,          // per-second velocity bleed (settling)
  burstSpeed: 70,          // initial outward spill speed (px/s at reference width) — a gentle pop
                           // that SPREADS the candies across the packet so they tumble independently
  burstSpreadFrac: 0.5,    // horizontal spread of the burst within a packet tile
  substeps: 6,             // physics sub-steps per frame (stability through the narrow chute)
  candyRFrac: 0.028,       // physics candy radius as a frac of the dispenser width
  _refW: 320,              // reference dispenser width the speeds above are tuned at
  stuckMs: 2200,           // anti-stuck fallback: nudge a candy toward the chute after this
  // SURFACE / WALL realism. The dispenser walls, slants + chute and the holding-tray basin are
  // RIGID, smooth surfaces: a wall doesn't absorb energy (the bounce uses the CANDY's own
  // restitution), but its smoothness scales how much tangential grip the candy gets. The global
  // `restitution`/`friction` above are now only the FALLBACK for a candy with no material profile —
  // each candy carries its own (COLORS[key].physics). Candy↔candy restitution combines as the
  // MINIMUM of the two (a hard candy landing on a soft pile barely bounces, like real life).
  wallFrictionMul: 0.3,    // tangential grip on the SMOOTH moulded dispenser walls/slants/chute — low,
                           // so even a tacky gummy slides down the chute (combined candy↔slick-plastic
                           // friction is low); material grip differences show mainly in the tray pile
  floorFrictionMul: 1.0,   // tangential grip on the holding-tray basin floor (full material friction)
  spinAirDamp: 0.6,        // angular velocity bled per SECOND while a candy is airborne
  rollGrip: 0.4,           // how strongly a rolling candy's spin couples to its surface speed/contact
  // SOFT-BODY (jiggle / squash) — a candy with `jiggle > 0` deforms on impact. impactVRef is the
  // reference impact speed (px/s at _refW) that maps to full `jiggle` deformation; wobbleMaxAmp caps
  // it. bumpKick scales the lateral/angular kick from an uneven surface (`bump`).
  impactVRef: 520,         // impact speed → full jiggle (scaled by dispenser width)
  wobbleMaxAmp: 0.42,      // hard cap on deformation amplitude (fraction of radius)
  bumpKick: 0.22,          // fraction of impact speed redirected sideways by a bumpy surface
};

// ---- LEVEL DEFINITION -------------------------------------------------------
// Adding a level = push another object to LEVELS; set ACTIVE_LEVEL.
// A level defines the whole puzzle:
//   packets:        ordered queue of MONO-COLOR packets, each { id?, color, shape?, count }.
//                   count should be CENTER.capacity (6). `color` may be a COLOR_ALIASES name.
//                   `packetSlots` = how many packets show across the top at once (rest queue).
//   jars:           the bottom target jars (4 queue lanes), each { id?, color, shape?, capacity }.
//                   capacity defaults to JAR.defaultCapacity. Each jar accepts only its one color.
//   centerContainer:{ capacity } — the middle holding tray (default CENTER.capacity = 6). This is
//                   the ONLY buffer — there is no storage tray, so a candy whose color has no active
//                   jar waits here until a lane advances; if it can't, the level is lost.
//
// BALANCE (validateLevel warns otherwise): packet count is 3..15, count >= 1, center capacity === 6,
//   and total packet candies per color === total jar capacity per color (so the level is winnable).
export const LEVELS = [
  {
    name: 'Warm Up',
    packetSlots: 6,
    // 4 colors, 8 candies of each → 32 candies (the rack holds 33, so the queue empties and the
    // front-first drain works cleanly). The 32 supply === the 8/8/8/8 the sixteen jars demand.
    // (Supply is authored per-color; the rack flattens it into individual candies, interleaved.)
    packets: [
      { id: 'p1', color: 'red',    shape: 'gummy', count: 8 },
      { id: 'p2', color: 'yellow', shape: 'cube',  count: 8 },
      { id: 'p3', color: 'blue',   shape: 'bean',  count: 8 },
      { id: 'p4', color: 'green',  shape: 'jelly', count: 8 },
    ],
    // 16 jars (cap 2) → distributed round-robin into the 4 queue lanes (lane = index % 4), so each
    // lane is a 4-deep queue (3 shown + 1 hidden behind). Still balanced (4 jars × cap 2 = 8 per
    // color === the per-color supply) and the lanes still read as MIXED queues, but this is NOT a
    // Latin square — it is CLUSTERED + STAGGERED so the player must BUFFER and sequence:
    //   • The four lane FRONTS start as red / red / red / blue — only TWO colors are collectable, so
    //     GREEN and YELLOW have NO active jar at the start and must WAIT in the center (cap 6) until a
    //     lane advances. The rack interleaves all four colors and the front-first rule means a green
    //     or yellow often blocks the candy you want, forcing you to drop it into the center buffer.
    //   • Because three lanes share red up front, those three lanes advance together and the active
    //     colors shift in waves — so the unavailable colors rotate and the buffer must be drained at
    //     the right moment. Careless "tap everything" play fills the center with colors no jar takes
    //     and gets STUCK (a real loss); sensible greedy + buffering wins (peaks at ~3/6 in the center).
    // Lanes front→back:
    //   L0 red → blue → green → yellow      L1 red → blue → yellow → green
    //   L2 red → yellow → green → blue      L3 blue → red → green → yellow
    jars: [
      { id: 'j1',  color: 'red',    shape: 'gummy', capacity: 2 }, // L0 front
      { id: 'j2',  color: 'red',    shape: 'gummy', capacity: 2 }, // L1 front
      { id: 'j3',  color: 'red',    shape: 'gummy', capacity: 2 }, // L2 front
      { id: 'j4',  color: 'blue',   shape: 'bean',  capacity: 2 }, // L3 front
      { id: 'j5',  color: 'blue',   shape: 'bean',  capacity: 2 }, // L0 #2
      { id: 'j6',  color: 'blue',   shape: 'bean',  capacity: 2 }, // L1 #2
      { id: 'j7',  color: 'yellow', shape: 'cube',  capacity: 2 }, // L2 #2
      { id: 'j8',  color: 'red',    shape: 'gummy', capacity: 2 }, // L3 #2
      { id: 'j9',  color: 'green',  shape: 'jelly', capacity: 2 }, // L0 #3
      { id: 'j10', color: 'yellow', shape: 'cube',  capacity: 2 }, // L1 #3
      { id: 'j11', color: 'green',  shape: 'jelly', capacity: 2 }, // L2 #3
      { id: 'j12', color: 'green',  shape: 'jelly', capacity: 2 }, // L3 #3
      { id: 'j13', color: 'yellow', shape: 'cube',  capacity: 2 }, // L0 back (hidden)
      { id: 'j14', color: 'green',  shape: 'jelly', capacity: 2 }, // L1 back (hidden)
      { id: 'j15', color: 'blue',   shape: 'bean',  capacity: 2 }, // L2 back (hidden)
      { id: 'j16', color: 'yellow', shape: 'cube',  capacity: 2 }, // L3 back (hidden)
    ],
    centerContainer: { capacity: 6 },
  },
  {
    name: 'Buffer Up',
    packetSlots: 6,
    // 9 packets across 3 colors (3 packets = 18 each). Each color is collected by THREE
    // jars of 6 (so supply 18 === jar capacity 18 per color). The center's 6-candy cap and
    // the tray's 18-candy buffer drive the sequencing.
    packets: [
      { id: 'p1', color: 'red',    shape: 'gummy', count: 6 },
      { id: 'p2', color: 'blue',   shape: 'bean',  count: 6 },
      { id: 'p3', color: 'green',  shape: 'jelly', count: 6 },
      { id: 'p4', color: 'red',    shape: 'gummy', count: 6 },
      { id: 'p5', color: 'blue',   shape: 'bean',  count: 6 },
      { id: 'p6', color: 'green',  shape: 'jelly', count: 6 },
      { id: 'p7', color: 'red',    shape: 'gummy', count: 6 },
      { id: 'p8', color: 'blue',   shape: 'bean',  count: 6 },
      { id: 'p9', color: 'green',  shape: 'jelly', count: 6 },
    ],
    jars: [
      { id: 'j1', color: 'red',   shape: 'gummy', capacity: 6 },
      { id: 'j2', color: 'blue',  shape: 'bean',  capacity: 6 },
      { id: 'j3', color: 'green', shape: 'jelly', capacity: 6 },
      { id: 'j4', color: 'red',   shape: 'gummy', capacity: 6 },
      { id: 'j5', color: 'blue',  shape: 'bean',  capacity: 6 },
      { id: 'j6', color: 'green', shape: 'jelly', capacity: 6 },
      { id: 'j7', color: 'red',   shape: 'gummy', capacity: 6 },
      { id: 'j8', color: 'blue',  shape: 'bean',  capacity: 6 },
      { id: 'j9', color: 'green', shape: 'jelly', capacity: 6 },
    ],
    centerContainer: { capacity: 6 },
  },
];

export const ACTIVE_LEVEL = 0;
