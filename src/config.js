// config.js — ALL tunable constants live here.
// Tweak feel, difficulty, colors, audio levels, and haptic intensities in one place.

const _clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---- CANDY PHYSICS PROFILES (data-driven) -------------------------------------------------------
// THE single source of truth for how each candy MOVES. One profile per candy type; every value is a
// readable "feel" knob (mostly 0..1 tendencies, plus absolute mass/restitution). `physicsFromProfile`
// below ADAPTS each profile into the low-level fields the funnel/tray sim already consumes — so to
// re-tune a candy you edit ONLY its profile here. Profiles drive the packet burst, the dispenser
// funnel tumble, the holding-tray settle, and the center→jar pour (see puzzle.js / dispenser.js).
//
// Fields (CandyPhysicsProfile):
//   candyType        — label
//   collisionRadius  — ×base radius (irregular candies a touch larger so they jostle)
//   visualBounds     — {wx,hy} coarse ELLIPSE half-extents (×radius): the shape approximation used
//                      for packing/settle (oval bean, wide wrapper, tall lollipop) — NOT polygons
//   mass             — relative; heavier ⇒ bursts less, shoves more, floats less
//   friction         — 0..1 grip on surfaces (sticky/soft high, glossy low)
//   restitution      — 0..1 bounce (hard candies higher, soft candies near zero)
//   damping          — 0..1 how fast motion + wobble bleed away (soft/sticky high → stops/settles fast)
//   rollTendency     — 0..1; ≥0.5 the candy ROLLS (spin couples to surface speed)
//   slideTendency    — 0..1 how readily it skates flat (informational + light grip relief)
//   wobbleAmount     — 0..1 elastic jiggle/quiver after a hit (jelly/wrapper/lollipop high)
//   spinAmount       — 0..1 launch + landing spin (asymmetric candies high → tumble awkwardly)
//   squashAmount     — 0..1 soft-body compression on impact (marshmallow/gummy high; hard = 0)
//   settleTime       — relative time to come to rest (informational; feeds damping feel)
//   settle           — rest behaviour: 'roll' | 'flat' (lie on long axis) | 'snap' (cube to a face)
//                      | 'wobble' (rock a few times then settle)
//   restBase         — preferred rest orientation (rad) for flat/snap/wobble settles
//   material         — landing-clink timbre: 'hard' (bright) | 'jelly' | 'soft' (dull)
export const CANDY_PROFILES = {
  // Red gummy bear — soft, sticky, uneven: barely bounces, grips, tumbles awkwardly, squashes, settles fast.
  red:    { candyType: 'gummy_bear',   collisionRadius: 1.06, visualBounds: { wx: 1.02, hy: 1.06 }, mass: 1.20, friction: 0.85, restitution: 0.12, damping: 0.80, rollTendency: 0.10, slideTendency: 0.20, wobbleAmount: 0.85, spinAmount: 0.18, squashAmount: 0.55, settleTime: 0.50, settle: 'wobble', restBase: 0,      material: 'jelly' },
  // Blue jelly bean — smooth glossy oval: rolls + slides, medium bounce, low wobble, small final roll.
  blue:   { candyType: 'jelly_bean',   collisionRadius: 1.00, visualBounds: { wx: 1.14, hy: 0.78 }, mass: 0.80, friction: 0.18, restitution: 0.50, damping: 0.40, rollTendency: 0.90, slideTendency: 0.85, wobbleAmount: 0.10, spinAmount: 0.35, squashAmount: 0.00, settleTime: 0.80, settle: 'roll',   restBase: 0,      material: 'hard'  },
  // Green jelly dome — sugary dome: flatter base, sticky surface, doesn't roll freely, wobbles on landing.
  green:  { candyType: 'jelly_dome',   collisionRadius: 1.02, visualBounds: { wx: 1.08, hy: 0.92 }, mass: 0.95, friction: 0.60, restitution: 0.28, damping: 0.60, rollTendency: 0.25, slideTendency: 0.35, wobbleAmount: 0.85, spinAmount: 0.10, squashAmount: 0.40, settleTime: 0.70, settle: 'wobble', restBase: 0,      material: 'jelly' },
  // Yellow spiral disk — hard flat candy: rolls strongly on edge, can slide flat, clicky, low deform.
  yellow: { candyType: 'spiral_disk',  collisionRadius: 1.00, visualBounds: { wx: 1.00, hy: 0.86 }, mass: 1.00, friction: 0.30, restitution: 0.46, damping: 0.40, rollTendency: 0.85, slideTendency: 0.60, wobbleAmount: 0.40, spinAmount: 0.45, squashAmount: 0.00, settleTime: 0.80, settle: 'roll',   restBase: 0,      material: 'hard'  },
  // Pink marshmallow — very soft + light: absorbs impact, almost no bounce, squashes + puffs back, floaty.
  pink:   { candyType: 'marshmallow',  collisionRadius: 1.04, visualBounds: { wx: 1.00, hy: 0.92 }, mass: 0.50, friction: 0.80, restitution: 0.08, damping: 0.95, rollTendency: 0.30, slideTendency: 0.30, wobbleAmount: 0.45, spinAmount: 0.10, squashAmount: 0.90, settleTime: 0.60, settle: 'flat',   restBase: 0,      material: 'soft'  },
  // Orange caramel cube — heavy, blocky, sticky: doesn't roll, tumbles corner-to-corner, thuds, snaps flat.
  orange: { candyType: 'caramel_cube', collisionRadius: 1.05, visualBounds: { wx: 0.96, hy: 0.96 }, mass: 1.35, friction: 0.60, restitution: 0.12, damping: 0.80, rollTendency: 0.05, slideTendency: 0.40, wobbleAmount: 0.15, spinAmount: 0.05, squashAmount: 0.05, settleTime: 0.50, settle: 'snap',   restBase: 0,      material: 'soft'  },
  // Purple wrapped candy — round centre, wrapper wings: tumbles unpredictably, spins + wobbles, playful.
  purple: { candyType: 'wrapped',      collisionRadius: 1.08, visualBounds: { wx: 1.20, hy: 0.82 }, mass: 1.00, friction: 0.30, restitution: 0.45, damping: 0.45, rollTendency: 0.50, slideTendency: 0.50, wobbleAmount: 0.85, spinAmount: 0.85, squashAmount: 0.00, settleTime: 0.90, settle: 'wobble', restBase: 0,      material: 'hard'  },
  // Cyan lollipop — round hard head + stick: asymmetric, pivots/rotates awkwardly, won't roll cleanly.
  // restBase = +90° (π/2): it RESTS rotated a quarter-turn right from the spritesheet orientation
  // (stick pointing sideways) — the funnel righting eases it there during the fall so it isn't a snap.
  cyan:   { candyType: 'lollipop',     collisionRadius: 1.00, visualBounds: { wx: 1.00, hy: 1.05 }, mass: 0.90, friction: 0.35, restitution: 0.45, damping: 0.50, rollTendency: 0.40, slideTendency: 0.40, wobbleAmount: 0.80, spinAmount: 0.80, squashAmount: 0.00, settleTime: 0.90, settle: 'wobble', restBase: 1.5708, material: 'hard'  },
};

// ADAPTER: a readable CandyPhysicsProfile → the low-level fields the sim consumes (so dispenser.js /
// puzzle.js stay unchanged). restitution/friction/mass pass through; the tendencies map onto the
// soft-body + roll knobs. `crMul`/`wx`/`hy`/`settle`/`restBase`/`spin`/`slide` are read by
// onPacketTapped when it stamps a freshly-dispensed candy.
export function physicsFromProfile(p) {
  const roll = p.rollTendency >= 0.5;
  const wob = p.wobbleAmount || 0;
  const sq = p.squashAmount || 0;
  return {
    material: p.material || (sq > 0.6 ? 'soft' : roll ? 'hard' : 'jelly'),
    restitution: p.restitution,
    friction: p.friction,
    mass: p.mass,
    roll,
    // deformation magnitude per impact (squash dominates; a wobbly candy deforms a little too)
    jiggle: _clamp(Math.max(sq, wob * 0.65), 0, 1),
    // only wobbly candies OSCILLATE (elastic quiver); rate rises with wobbleAmount
    wobbleFreq: wob > 0.05 ? 20 + wob * 22 : 0,
    // how fast the jiggle settles back — driven by HOW WOBBLY the candy is, NOT its translational
    // grip: a high-wobble JELLY (red/dome) quivers a long time (LOW damp); a low-wobble or squashy
    // candy (cube / marshmallow) calms in 1–2 jiggles (HIGH damp). 0.85→4.4, 0.55→7.0, 0.1→11.1.
    wobbleDamp: _clamp(3.2 + (1 - wob) * 8.8, 3.2, 12),
    // surface unevenness → erratic tumble: spinny/irregular non-rollers scatter most
    bump: _clamp((p.spinAmount || 0) * 0.22 + (1 - p.rollTendency) * wob * 0.12, 0, 0.3),
    // air resistance ~ FOAMINESS (lightness): only genuinely LIGHT candies (marshmallow, sponge cake)
    // drift down slowly; dense candies fall at normal speed. A heavy/sticky candy grips on CONTACT
    // (that's friction) but must NOT float in the air — tying this to `damping` made the gummy bear /
    // jelly dome hang in the funnel, so it's driven by low mass instead. mass≥0.78 ⇒ airDrag 1 (normal).
    // Multiplier eased 3→2 so pink (the only mass<0.78 candy, at 0.50) keeps a soft float (≈1.56)
    // without crawling down the funnel — it was the slowest candy to reach the tray.
    airDrag: _clamp(1 + Math.max(0, 0.78 - (p.mass || 1)) * 2, 1, 2.4),
    // cap soft-body compression (undefined ⇒ sim's global cap) — only soft candies squash
    squashMax: sq > 0 ? 0.06 + sq * 0.16 : undefined,
    // ---- read by onPacketTapped when stamping the spilled candy ----
    crMul: p.collisionRadius || 1,
    wx: (p.visualBounds && p.visualBounds.wx) || 1,
    hy: (p.visualBounds && p.visualBounds.hy) || 1,
    settle: p.settle || 'roll',
    restBase: p.restBase || 0,
    spin: p.spinAmount || 0,
    slide: p.slideTendency || 0,
  };
}

// Per-color visual + the sim physics built from each profile. The renderer blits each candy from the
// spritesheet (`candy_spritesheet_final_1.png`, a clean 4×2 grid): `sprite:[col,row]` is its cell and
// `spriteRect:[x,y,w,h]` the cell's pixel box (the loader chroma-keys the green/black cell backgrounds
// to transparent, then measures each candy's tight content). The SAME blit draws packet tiles, the
// spilled/piling balls and jar contents. `base/light/dark` tint particle bursts + the procedural
// fallback (only until the sheet loads); `shape` is that fallback's silhouette. `art` keys the
// per-color CandyTrayPackets tile art. `physics` is the adapted profile (see physicsFromProfile).
const SHEET_COLS = 4, SHEET_ROWS = 2, CELL_W = 256, CELL_H = 253;
const CANDY_DEFS = {
  red:    { sprite: [0, 0], shape: 'round',   base: '#e8413f', light: '#ff928e', dark: '#9e2b2c', art: 'red'    },
  blue:   { sprite: [1, 0], shape: 'oval',    base: '#3f74e0', light: '#8fb4ff', dark: '#1f3f87', art: 'blue'   },
  green:  { sprite: [2, 0], shape: 'round',   base: '#4faf43', light: '#9fe07f', dark: '#2c6b2a', art: 'green'  },
  yellow: { sprite: [3, 0], shape: 'round',   base: '#f4b81e', light: '#ffe07a', dark: '#a06a14', art: 'yellow' },
  pink:   { sprite: [0, 1], shape: 'pill',    base: '#f29ec6', light: '#ffd0e6', dark: '#b25f8e', art: 'pink'   },
  orange: { sprite: [1, 1], shape: 'square',  base: '#f0922e', light: '#ffc481', dark: '#a85e14', art: 'mango'  },
  purple: { sprite: [2, 1], shape: 'diamond', base: '#9b54d8', light: '#cfa2f0', dark: '#5d3b8f', art: 'purple' },
  cyan:   { sprite: [3, 1], shape: 'round',   base: '#3fc6d8', light: '#a2eef5', dark: '#1f7f8f', art: 'cyan'   },
};
export const COLORS = {};
for (const _k in CANDY_DEFS) {
  const d = CANDY_DEFS[_k];
  const p = CANDY_PROFILES[_k];
  COLORS[_k] = {
    base: d.base, light: d.light, dark: d.dark, shape: d.shape, art: d.art,
    sprite: d.sprite,
    spriteRect: [d.sprite[0] * CELL_W, d.sprite[1] * CELL_H, CELL_W, CELL_H],
    profile: p,
    physics: physicsFromProfile(p),
  };
}

// Default candy material if a color omits `physics` (a neutral, mildly bouncy rigid candy).
export const CANDY_PHYSICS_DEFAULT = { material: 'hard', restitution: 0.35, friction: 0.18, mass: 1.0, roll: true, jiggle: 0, wobbleFreq: 0, wobbleDamp: 0, bump: 0, airDrag: 1.0, crMul: 1, wx: 1, hy: 1, settle: 'roll', restBase: 0, spin: 0, slide: 0.3 };

// Friendly color names from level data that map onto a real COLORS key. `amber` (the old yellow
// candy's key) now resolves to the yellow spiral disk. resolveColor() in traySlots.js applies it.
export const COLOR_ALIASES = {
  amber: 'yellow',
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
  packetSize: 3,           // ACTIVE puzzle: candies in one packet TRAY — a tap BURSTS this whole batch
                           // down the funnel (fallback when a level's packet omits `count`)
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
  // ITEM 4 — a "resting but live" pile. Settled candies stay exactly where they came to rest (no
  // freeze→revive-all twitch) but act as light COLLIDERS: a NEW drop lands on the pile and only the
  // neighbours it actually strikes WAKE and re-settle, so the drop RIPPLES through instead of the whole
  // pile lifting and resetting. Bounded by the center capacity (≤6 bodies) so the contacts are nearly
  // free. Toggle `enabled` (false = the old revive-the-whole-pile behaviour).
  pile: {
    enabled: true,          // ON — a drop (a burst OR a gate-admitted overflow candy) lands on the
                            // RESTING pile, which stays exactly put; only the neighbours it strikes hard
                            // enough WAKE + re-settle. This replaces the old whole-pile REFLOW (which
                            // lifted the entire settled pile back into the sim and visibly jolted it),
                            // so admitted overflow candies glide in WITHOUT disturbing the pile.
    wakeSpeedFracH: 0.085,  // a resting candy WAKES only if a strike gives it more than this (×box height/s)
    push: 0.45,             // how much a resting candy yields to the dropped candy on contact (0..1)
  },
  // OVERFILL — don't pre-block a tap the instant the pipeline hits capacity. A candy still TUMBLING
  // down the funnel isn't "in the tray" yet, so the gate is raised by `margin`: the player can drop
  // into a brief visual OVER-fill (a satisfying jumble, more bodies = more emergent collision). When
  // the table then settles and auto-route has taken everything that logically fits, any candy still
  // over capacity ROLLS BACK OUT to the rack with a reject cue — instead of a hard pre-block. Toggle
  // `enabled` (false = the old strict pipeline cap).
  overfill: {
    enabled: false,       // OFF — SUPERSEDED by the DISPENSER.gate overflow buffer: a drop past the
                          // tray's capacity now PILES at the chute gate and waits to be admitted as the
                          // tray frees, instead of rolling back out to the supply. (Kept for the dormant
                          // roll-back path; flip on only if you want the old reject-to-rack behaviour.)
    margin: 3,            // how far the pipeline (falling + in-tray) may exceed capacity before a tap is
                          // refused — one packet's worth, so a burst is never hard-blocked mid-tray
    riseFrac: 0.55,       // how far a rejected candy floats back up (frac of the tray box height) as it rolls out
    fadeMs: 460,          // roll-back-out animation length (ms)
  },
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
    slideTauMs: 80,       // smoothing time-constant for jars sliding forward on a shift (snappier shift)
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
  // closing animation when a jar fills: the lid drops on, holds, then the sealed jar fades away and
  // the jar is REMOVED (which advances the lane → gates the next same-lane pour). Times are ms off the
  // dt-accumulated clock (jar._clearStart), scaled by the sweep tempo. Tightened (850→510 total) so
  // the seal + lane advance don't stall a chain — still readable as a lid-drop + seal.
  close: { lidDropMs: 230, holdMs: 80, fadeMs: 200 },
};

// Movement tweens (eased, off the dt-accumulated clock) — used for every move EXCEPT the
// packet -> center spill, which runs the small custom funnel sim below (see dispenser.js).
export const ANIM = {
  fallDurMs: 360,         // (legacy) packet -> center fall, now only the chute -> slot handoff
  fallStaggerMs: 70,      // delay between successive candies of one packet
  moveDurMs: 240,         // center -> jar / center -> tray (snappier re-pack of leftovers after a pour)
  returnDurMs: 320,       // tray -> center
  intakeDurMs: 480,       // (legacy) chute -> center handoff — candies now tumble in via physics
  returnPackDurMs: 360,   // tray -> center: glide a retrieved group into its packed row
  bounce: 0.16,           // settle-bounce amplitude on arrival
  autoRouteDelayMs: 130,  // CASCADE rhythm: the beat between successive pours once a sweep is running
                          // (it also shrinks with the sweep tempo). NOT used for the first route.
                          // Tightened (240→130) so chain reactions read fast without losing the beat.
  firstRouteDelayMs: 0,   // the FIRST route of a freshly-settled candy fires (near) immediately — as
                          // soon as it's in the tray and a matching jar is active, it flows in, no wait
  loseRevealMs: 6500,     // STUCK GRACE: once the board is unwinnable (tray FULL + no tray candy fits any
                          // active jar) hold this long before showing the lose screen, so the player sees
                          // the dead board and accepts the defeat. Cancelled if the stuck state clears.
  // POUR: candies don't glide straight to a jar — the holding tray TIPS toward the target jar and
  // the matching candies roll over its lip and arc down in (a lip-then-drop quadratic Bézier; see
  // puzzle.js _pourCandies / candyScreenPos). One jar is poured at a time so the tray tilts a single
  // direction. Cosmetic + deterministic (driven off _time), so the headless smoketest is unaffected.
  pour: {
    durMs: 360,        // travel time tray -> jar (faster pour; still reads as a pour, not a glide).
                       // This is the BASE for every jar incl. the FIRST, so lowering it speeds the
                       // first jar too; chained jars scale it down further via POUR.speedup.
    staggerMs: 60,     // gap between successive candies leaving (a quick one-by-one pouring stream)
    lipOutFrac: 0.12,  // how far past the tray lip (frac of tray WIDTH) the arc bulges toward the jar
    lipLiftFrac: 0.12, // how far the candy rises over the rim (frac of tray HEIGHT) before it drops
    spinTurns: 1.1,    // tumble (turns) a ROLLING candy makes during the pour; gummies/jelly don't spin
  },
};

// SCORING — the additive "superlinear reward" feel-layer. Purely sensory recognition of the
// auto-route CASCADE the game already produces (one player tap can complete several jars in
// sequence); it does NOT change route/settle/win-lose. Every tunable here, nothing in module code.
export const SCORING = {
  // COMBO — one player-triggered settle can complete several jars in sequence (the auto-route
  // cascade). Each completion in that window escalates the feel. comboIndex is 1-based + clamped.
  combo: {
    maxLink: 4,           // clamp the link index used for feel (chain is hard-capped by lanes/capacity)
    pitchStepCents: 120,  // chime detune added per EXTRA link (link 1 = baseline pitch)
    sparkleScale: 0.7,    // extra particle-burst scale per extra hype level (cascade OR same-lane chain)
    hapticStep: 0.35,     // extra haptic intensity per extra link
    comboGain: 0.08,      // extra chime gain per extra link — deeper chains sound fuller, not just higher
  },
  // CLUTCH — completing a jar while the tray is still near-full = a high-pressure save.
  clutch: {
    thresholdFrac: 0.83,  // center fullness (count/capacity) at/above which a completion is clutch (5/6)
    chimeBoost: 0.18,     // extra chime gain when clutch
    sparkleBoost: 0.6,    // extra burst scale when clutch
    hapticBoost: 0.4,     // extra haptic intensity when clutch
  },
  // MULTIPLIER JAR (Phase 2) — each jar independently has a ~1-IN-6 chance of being a "×N" jar: it
  // wears the gold glow + ×N badge, and COMPLETING it pays the multiplier. A level may also force a
  // jar with `multiplier:true`. The pick is a SEEDED hash of the jar index (NOT Math.random), so the
  // scatter LOOKS random yet is reproducible (the headless smoketest repeats); bump `seed` to reshuffle.
  multiplier: {
    chance: 1 / 6,       // per-jar probability of being a ×N jar (≈ 1 in 6)
    seed: 0x1234,        // reshuffles the random scatter without changing the rate
    value: 2,            // score multiplier when a multiplier JAR completes (the ×N shown on the badge)
    chimeBoost: 0.22,    // extra chime brightness on a multiplier completion (capped to that jar)
    sparkleBoost: 0.8,   // extra burst scale on a multiplier completion
  },
  // SCORE POPUP (Phase 3) — a floating +N that rides the burst and fades. Not a scoreboard, but it
  // GROWS with the hype level (cascade combo OR same-lane chain) so a big chain reads as a big reward.
  score: {
    enabled: true,       // set false for pure-ASMR (no number)
    base: 100,           // N = base * comboIndex * (clutch?clutchMult:1) * (multiplier?multiplier.value:1)
    clutchMult: 2,
    floatMs: 1100,       // rise+fade lifetime (a touch longer so the big pops linger)
    riseFrac: 0.08,      // float distance (frac of min screen dim)
    growthPerLevel: 0.3, // popup font grows +30% per hype level beyond the first (chain/cascade depth)
    maxScale: 2.8,       // cap on popup size
    punch: 0.4,          // birth scale-overshoot (0 = none) — a satisfying pop-in
    specialBump: 1.15,   // extra size when the completion is clutch and/or a multiplier
    labelAtLevel: 2,     // show a "COMBO ×N" tag at/above this hype level
    tierColors: ['#ffffff', '#ffe79a', '#ffb14e', '#ff7a8a'], // number colour by hype level (1,2,3,4+)
  },
};

// POUR — the directional "held-tilt" sweep. When the center routes into a jar, the tray TILTS toward
// that lane; if the SAME lane then advances and its new front jar can also be satisfied, the tray
// HOLDS the tilt and keeps pouring down that one queue, jar after jar, accelerating — until the lane's
// front can no longer be satisfied, then it re-aims or eases back to level. Tilt is purely cosmetic
// (render transform); the only logic effect is a route-ORDER preference in _autoRoute (which jar fills
// first), never which jars are fillable. All numbers here.
export const POUR = {
  angleDeg: 9,             // max tray tilt toward the lane being fed (deg) — cosmetic (~matches old feel)
  // The tilt must KEEP PACE with the (now faster) pours so the tray + the candies resting in it (both
  // driven by the same _centerTilt → always in sync) visibly track the lane being fed. easeTau ≈ 70ms
  // settles the tilt well within a 360ms pour, so it reads as the tray leaning into each pour, not
  // lagging it; neutralReturn relaxes it to level a bit quicker once the cascade drains.
  easeTauMs: 70,           // ease toward an active pour target (smaller = snappier)
  neutralReturnTauMs: 150, // ease back to level when no lane is being fed (a gentle but prompt relax)
  slidePx: 6,              // optional nudge of routed-out candies toward the low edge (cosmetic)
  // ACCELERATION within a held sweep — works BOTH axes: consecutive completions DOWN a lane (vertical
  // chain) or ACROSS the front row (horizontal chain). Each consecutive completion in the cascade
  // scales the route/fill/close/lane-shift durations (AND the pre-pour rest beat) by factorPerLink **
  // (cascade count), FLOORED at minMul so it never blurs. 0.6 → a normal jar is 1×, the next in the
  // chain ≈0.6×, deeper jars ≈0.5× (the floor). The multiplier hits the pour, the fill, the close +
  // disappear, and the gap before the next pour, so the whole chained-jar cycle is ~0.6 of a lone jar's.
  speedup: { factorPerLink: 0.6, minMul: 0.42 },
  perLaneReset: true,      // reset the VERTICAL chain counter (label only) when the pour lane changes
};

// ---- CANDY DISPENSER (the widecontainer.png packet rack + funnel physics) ----
// The PNG is purely visual; these are the invisible colliders + physics tunables. ALL geometry
// is expressed as FRACTIONS of the dispenser's DRAWN box (origin = box top-left), so it scales to
// any screen size. Packets sit ONLY inside `innerRect`; tapping one spills its 6 candies, which
// fall under gravity, slide down the two diagonal slants, funnel through the vertical chute, and
// exit at `path.exitY` into the center container. Press D in-game to see the colliders and tune
// these fractions. This is a tiny self-contained sim — NOT a physics engine.
export const DISPENSER = {
  // The dispenser box is sized DIRECTLY as a fraction of the screen and pinned to the top — it
  // is the hero. widecontainer.png (1672×941, wide) is drawn to FILL this box, so it stretches to
  // fit; the colliders below are fractions of the box, so they stay aligned to the art either
  // way. (Hitting both targets at once is only possible by not preserving the art's aspect.)
  widthFrac: 0.96,         // box width as a frac of screen width (wider hero; capped to fit margins)
  heightFrac: 0.62,        // box height as a frac of screen height (taller hero; clamped on resize
                           // so the center+jars tail below the chute still fits — the jar area was
                           // trimmed to 0.26 of height to give this extra vertical room)
  // inner rectangle (the open mint/blue cavity) where the candy rack sits (frac of the drawn box).
  // MEASURED from widecontainer.png's actual cavity (per-row alpha bbox flood-fill, not eyeballed):
  // the cavity walls hold ~0.125..0.873 from y≈0.15 down to where it starts narrowing (~0.52).
  innerRect: { left: 0.125, right: 0.873, top: 0.15, bottom: 0.52 },
  // diagonal funnel: the cavity narrows from the rectangle's bottom corners to the chute mouth. The
  // slant line was FIT to the measured cavity edges — a straight (0.125,0.52)→(0.404,0.80) on the left
  // (and mirror on the right) tracks the painted slant within ~0.002 the whole way down (verified
  // linear at the midpoint).
  funnel: { topY: 0.52, botY: 0.80 },
  // central vertical chute (path) + the exit line where candies leave the dispenser. widecontainer.png
  // has a MUCH WIDER painted spout than the old art: ~0.404..0.595 (≈0.19 wide, centre ≈0.50) — about
  // 2.6× the old 0.072, so ~3 candy-widths fit and candies no longer jam or ricochet between the walls.
  // exitY: candies ride the chute down and release into the center once they cross it, right at the
  // spout mouth (the spout interior bottoms out at ~0.831 in this art) — set AT the mouth so candies
  // traverse the full visible spout, then pour out into the tray seated just below it (see puzzle.js).
  path: { left: 0.404, right: 0.595, exitY: 0.83 },
  // OVERFLOW GATE (the "black line" at the chute entrance). When the holding tray is FULL, candies
  // tapped down anyway PILE UP above this line and are NOT allowed past it — they wait in the funnel.
  // As soon as the tray frees a slot (auto-route empties it into a jar), the waiting candy NEAREST the
  // entrance is admitted and tumbles in. `yFrac` is the line as a frac of the box HEIGHT (just above
  // the chute throat at funnel.botY 0.80, so waiting candies never enter the chute). `queueMax` caps
  // how many may pile at the gate before a further tap is refused (the funnel's holding capacity).
  // See puzzle.js (_manageGate / this.waiting) + dispenser.js (the gate floor in _constrain).
  gate: { enabled: true, yFrac: 0.78, queueMax: 9 },
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
  gravity: 2050,           // px/s^2 at the reference width (DISPENSER._refW) — enough that candies
                           // drop briskly from the rack into the tray (no long hang in the funnel)
                           // while still tumbling readably down the slants on the way to the chute
  restitution: 0.42,       // bounce off slants / walls — a bit livelier so they jostle/tumble
  friction: 0.08,          // tangential energy lost sliding along a surface
  damping: 0.012,          // per-second velocity bleed (settling)
  burstSpeed: 70,          // initial outward spill speed (px/s at reference width) — a gentle pop
                           // that SPREADS the candies across the packet so they tumble independently
  burstSpreadFrac: 0.5,    // horizontal spread of the burst within a packet tile
  substeps: 10,            // physics sub-steps per frame — HIGH so collisions/landings resolve
                           // smoothly and consistently every frame (no tunnelling or frame-rate
                           // disparity in the tumble/pile)
  candyRFrac: 0.028,       // physics candy radius as a frac of the dispenser width
  _refW: 320,              // reference dispenser width the speeds above are tuned at
  stuckMs: 1200,           // anti-stuck fallback: nudge a candy toward the chute after this (lowered
                           // so a rare jam clears in ~1.2s instead of hanging ~2.2s)
  // SURFACE / WALL realism. The dispenser walls, slants + chute and the holding-tray basin are
  // RIGID, smooth surfaces: a wall doesn't absorb energy (the bounce uses the CANDY's own
  // restitution), but its smoothness scales how much tangential grip the candy gets. The global
  // `restitution`/`friction` above are now only the FALLBACK for a candy with no material profile —
  // each candy carries its own (COLORS[key].physics). Candy↔candy restitution combines as the
  // MINIMUM of the two (a hard candy landing on a soft pile barely bounces, like real life).
  wallFrictionMul: 0.18,   // tangential grip on the SMOOTH moulded dispenser walls/slants/chute — kept
                           // LOW (lowered from 0.3) so even a tacky gummy (red/green/pink) slides down
                           // the slants + chute briskly instead of crawling — each chute-wall touch
                           // does vy*=(1-friction*thisMul), so a high mul made the non-rolling gummies
                           // bleed most of their fall speed. Material grip differences still show in
                           // the tray pile (floorFrictionMul stays 1.0 → full friction on the floor)
  floorFrictionMul: 1.0,   // tangential grip on the holding-tray basin floor (full material friction)
  spinAirDamp: 0.6,        // angular velocity bled per SECOND while a candy is airborne
  rollGrip: 0.4,           // how strongly a rolling candy's spin couples to its surface speed/contact
  // SOFT-BODY (jiggle / squash) — a candy with `jiggle > 0` deforms on impact. impactVRef is the
  // reference impact speed (px/s at _refW) that maps to full `jiggle` deformation; wobbleMaxAmp caps
  // it. bumpKick scales the lateral/angular kick from an uneven surface (`bump`).
  impactVRef: 340,         // impact speed → full jiggle (scaled by dispenser width). LOWER = a gentle
                           // landing still visibly deforms a soft candy (the tray pile-up arrives slowly)
  wobbleMaxAmp: 0.46,      // hard cap on deformation amplitude (fraction of radius)
  bumpKick: 0.22,          // fraction of impact speed redirected sideways by a bumpy surface
  // ---- ITEM 3: SHAPE-AWARE COLLISION + SETTLE ------------------------------------------------
  // Each candy collides as a coarse ELLIPSE (half-extents from its drawn silhouette, matched to the
  // renderer's _candyPath) instead of a uniform circle, and SETTLES per its shape: a cube snaps flat
  // and sits stable, a diamond ROCKS on its point before tipping to an edge, beans/pills lie flat.
  // Deterministic per colour (shape is fixed → smoketest still reproduces); the only effect is HOW a
  // pile packs and rests, so piles never form the same way twice. Toggle `enabled`.
  shape: {
    enabled: true,         // ON — per-candy settle (snap/flat/wobble/roll) now comes from each
                          // CANDY_PROFILES entry (.settle), so a cube snaps, a dome wobbles, a bean
                          // rolls. Deterministic per colour → smoketest still reproduces.
    // half-extent multipliers (× collision radius) per silhouette + a SETTLE profile + rest `base`:
    //   roll = no preferred angle (keeps rolling)   flat = lies on its long axis (180°-symmetric)
    //   snap = snaps to nearest flat face (cube)     wobble = rocks on a point, then tips to an edge
    profiles: {
      round:   { wx: 1.00, hy: 0.96, settle: 'roll',   base: 0 },
      oval:    { wx: 1.12, hy: 0.76, settle: 'flat',   base: 0 },
      square:  { wx: 0.94, hy: 0.94, settle: 'snap',   base: 0 },
      pill:    { wx: 0.68, hy: 1.04, settle: 'flat',   base: 1.5708 }, // lies on its side (≈90°)
      diamond: { wx: 1.00, hy: 1.16, settle: 'wobble', base: 0.7854 }, // stable on an edge (≈45°)
    },
    angStiffness: 26,      // angular restoring strength toward the rest orientation (per s)
    angDampFlat: 12,       // strong damping for flat/snap shapes → settle quickly + hold
    angDampWobble: 5.0,    // medium damping for a wobble shape → it ROCKS a couple of times then settles
    landKick: 5.0,         // angular ROCK kick (× normalized contact impact) a 'wobble' candy gets when
                           // it lands on the floor OR strikes the pile — so it visibly rotates on impact
    contactAngDamp: 9.0,   // a NON-rolling candy in contact (resting on the floor/pile) bleeds spin this
                           // fast → its landing rock settles instead of spinning forever
  },
  // RIGHTING — eases every candy toward its canonical UPRIGHT orientation (its profile `restBase`:
  // 0 for most candies, +90° for the lollipop) so it comes to REST exactly as drawn in the
  // spritesheet. The strength ramps with how settled the candy is (none while it tumbles down fast,
  // full as it slows to rest), rotating by the SHORTEST path, so the correction is spread across the
  // slow part of the fall — the player never sees it snap. Tumble/roll/wobble still play on the way
  // down; this only governs the final resting angle.
  righting: {
    enabled: true,
    speedFrac: 0.7,    // righting is fully OFF above this fraction of the impact ref speed, fully ON at rest
    rate: 6,           // how fast the angle eases toward upright (per second, scaled by settledness)
    spinBleed: 8,      // how fast a settling candy's tumble/roll spin bleeds away so it doesn't fight righting
  },
  // ---- ITEM 1: SEEDED COSMETIC VARIETY -------------------------------------------------------
  // Deterministic per-candy jitter, seeded by a FIXED game seed XOR the candy id. Every dispensed
  // candy launches + tumbles a little differently, while the LOGIC stays 100% reproducible (the
  // headless smoketest only checks logical state + "settled", never pixel paths). Purely cosmetic.
  variety: {
    enabled: true,           // ON — seeded per-candy cosmetic variety (item 1)
    seed: 0x5eed,            // fixed game seed → reproducible; change it for a different "shuffle"
    posJitterFrac: 0.55,     // spawn x/y scatter within the tapped cell, as a frac of candy radius
    speedJitter: 0.35,       // ± on the initial spill speed
    angleJitterRad: 0.42,    // ± on the initial spill direction (kept mostly downward)
    spinJitter: 3.0,         // ± initial spin (rad/s) on the launch tumble
    massJitter: 0.10,        // ± on mass (collision momentum)
    restJitter: 0.07,        // ± on restitution (bounce)
    radiusJitter: 0.06,      // ± on the COLLISION radius (pile-shape variety; draw size unchanged)
    bumpBase: 0.05,          // give EVERY candy a little surface unevenness (path scatter)…
    bumpJitter: 0.06,        // …plus a per-candy ± on top (added to the material's own bump)
  },
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
    // PACKET TRAYS: 16 mono-colour trays of 3 candies each (4 trays per colour → 12 candies/colour,
    // 48 total), authored round-robin so the 6 visible trays always show a mix. Tapping a tray
    // BURSTS its 3 candies down the funnel into the holding tray. The 12-per-colour supply === the
    // sixteen jars' demand (4 jars × cap 3). This level uses 4 of the 8 candy types; "Sweet Mix"
    // exercises the other 4, so all eight candies are in play.
    packets: [
      { color: 'red', count: 3 }, { color: 'blue', count: 3 }, { color: 'green', count: 3 }, { color: 'yellow', count: 3 },
      { color: 'red', count: 3 }, { color: 'blue', count: 3 }, { color: 'green', count: 3 }, { color: 'yellow', count: 3 },
      { color: 'red', count: 3 }, { color: 'blue', count: 3 }, { color: 'green', count: 3 }, { color: 'yellow', count: 3 },
      { color: 'red', count: 3 }, { color: 'blue', count: 3 }, { color: 'green', count: 3 }, { color: 'yellow', count: 3 },
    ],
    // 16 jars (cap 3) → round-robin into the 4 queue lanes (lane = index % 4), each a 4-deep queue
    // (3 shown + 1 hidden). Balanced (4 jars × cap 3 = 12 per colour === supply). CLUSTERED + STAGGERED
    // so the player must BUFFER + sequence: the four lane FRONTS start red / red / red / blue, so GREEN
    // and YELLOW have no active jar and a burst of them must WAIT in the center (cap 6, ~two packets).
    // Careless "tap everything" floods the center with colours no jar takes and gets STUCK; greedy +
    // buffering wins. Lanes front→back:
    //   L0 red → blue → green → yellow      L1 red → blue → yellow → green
    //   L2 red → yellow → green → blue      L3 blue → red → green → yellow
    jars: [
      { id: 'j1',  color: 'red',    capacity: 3 }, // L0 front
      { id: 'j2',  color: 'red',    capacity: 3 }, // L1 front
      { id: 'j3',  color: 'red',    capacity: 3 }, // L2 front
      { id: 'j4',  color: 'blue',   capacity: 3 }, // L3 front
      { id: 'j5',  color: 'blue',   capacity: 3 }, // L0 #2
      { id: 'j6',  color: 'blue',   capacity: 3 }, // L1 #2
      { id: 'j7',  color: 'yellow', capacity: 3 }, // L2 #2
      { id: 'j8',  color: 'red',    capacity: 3 }, // L3 #2
      { id: 'j9',  color: 'green',  capacity: 3 }, // L0 #3
      { id: 'j10', color: 'yellow', capacity: 3 }, // L1 #3
      { id: 'j11', color: 'green',  capacity: 3 }, // L2 #3
      { id: 'j12', color: 'green',  capacity: 3 }, // L3 #3
      { id: 'j13', color: 'yellow', capacity: 3 }, // L0 back (hidden)
      { id: 'j14', color: 'green',  capacity: 3 }, // L1 back (hidden)
      { id: 'j15', color: 'blue',   capacity: 3 }, // L2 back (hidden)
      { id: 'j16', color: 'yellow', capacity: 3 }, // L3 back (hidden)
    ],
    centerContainer: { capacity: 6 },
  },
  {
    name: 'Sweet Mix',
    packetSlots: 6,
    // The OTHER 4 candy types (pink marshmallow, orange caramel, purple wrapped, cyan lollipop) so
    // every candy is playable. STRUCTURALLY IDENTICAL to "Warm Up" (a colour-relabelled copy of the
    // proven clustered+staggered 16-jar / 4-lane layout), winnable by the same greedy+buffer play:
    // 16 trays of 3 (4 per colour → 12 each, 48 total); 16 jars cap 3 (4 jars × cap 3 = 12 === supply).
    // Fronts start pink / pink / pink / orange, so purple + cyan must WAIT in the center buffer.
    // Lanes front→back:
    //   L0 pink → orange → purple → cyan      L1 pink → orange → cyan → purple
    //   L2 pink → cyan → purple → orange       L3 orange → pink → purple → cyan
    packets: [
      { color: 'pink', count: 3 }, { color: 'orange', count: 3 }, { color: 'purple', count: 3 }, { color: 'cyan', count: 3 },
      { color: 'pink', count: 3 }, { color: 'orange', count: 3 }, { color: 'purple', count: 3 }, { color: 'cyan', count: 3 },
      { color: 'pink', count: 3 }, { color: 'orange', count: 3 }, { color: 'purple', count: 3 }, { color: 'cyan', count: 3 },
      { color: 'pink', count: 3 }, { color: 'orange', count: 3 }, { color: 'purple', count: 3 }, { color: 'cyan', count: 3 },
    ],
    jars: [
      { id: 'j1',  color: 'pink',   capacity: 3 }, // L0 front
      { id: 'j2',  color: 'pink',   capacity: 3 }, // L1 front
      { id: 'j3',  color: 'pink',   capacity: 3 }, // L2 front
      { id: 'j4',  color: 'orange', capacity: 3 }, // L3 front
      { id: 'j5',  color: 'orange', capacity: 3 }, // L0 #2
      { id: 'j6',  color: 'orange', capacity: 3 }, // L1 #2
      { id: 'j7',  color: 'cyan',   capacity: 3 }, // L2 #2
      { id: 'j8',  color: 'pink',   capacity: 3 }, // L3 #2
      { id: 'j9',  color: 'purple', capacity: 3 }, // L0 #3
      { id: 'j10', color: 'cyan',   capacity: 3 }, // L1 #3
      { id: 'j11', color: 'purple', capacity: 3 }, // L2 #3
      { id: 'j12', color: 'purple', capacity: 3 }, // L3 #3
      { id: 'j13', color: 'cyan',   capacity: 3 }, // L0 back (hidden)
      { id: 'j14', color: 'purple', capacity: 3 }, // L1 back (hidden)
      { id: 'j15', color: 'orange', capacity: 3 }, // L2 back (hidden)
      { id: 'j16', color: 'cyan',   capacity: 3 }, // L3 back (hidden)
    ],
    centerContainer: { capacity: 6 },
  },
];

export const ACTIVE_LEVEL = 0;
