// config.js — ALL tunable constants live here.
// Tweak feel, difficulty, colors, audio levels, and haptic intensities in one place.

export const COLORS = {
  // Marble / bin palette (calm, slightly desaturated jewel tones)
  red:    { base: '#e8615f', light: '#ff9b97', dark: '#8e2b2c' },
  amber:  { base: '#f0b15a', light: '#ffd79a', dark: '#9a6a20' },
  green:  { base: '#7ec88a', light: '#bdf0c4', dark: '#356b40' },
  blue:   { base: '#6aa9f0', light: '#a9d2ff', dark: '#2a578f' },
  purple: { base: '#b489e8', light: '#dcc2ff', dark: '#5d3b8f' },
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
  // Ride radius is resolved at runtime to fit between the tray row and bin row,
  // capped by these fractions of min(width,height).
  radiusFracCap: 0.30,
  trackWidthFrac: 0.13,   // width of the channel band (room for marbles to slide radially)
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

export const TRAY = {
  // Dispensers in a horizontal ROW across the TOP. count comes from the level.
  // Position/size are resolved responsively in GameState.resize().
  sizeFrac: 0.07,         // of min(w,h)
  minSizePx: 26,          // floor so trays stay tappable on small screens
  spreadAimFrac: 1.12,    // preferred row span as a multiple of loop diameter
  releaseCooldownMs: 120,
};

export const BIN = {
  // Collection bins in a horizontal ROW across the BOTTOM. count comes from the level.
  // Position/size are resolved responsively in GameState.resize().
  sizeFrac: 0.082,        // of min(w,h)
  minSizePx: 30,          // floor so bins stay readable on small screens
  spreadAimFrac: 1.12,    // preferred row span as a multiple of loop diameter
  slots: 3,               // a bin clears when this many matching marbles collect
  captureArcDeg: 18,      // angular half-window at the bin's drop point where a marble detaches
  dropDurationMs: 300,    // fall time from the loop down into the bin
  clearHoldMs: 360,       // pause showing a full bin before it pops/clears
};

export const RULES = {
  loopCapacity: 14,       // max marbles riding the loop before game over (jam)
  warnAt: 11,             // belt count at which "jam imminent" warnings fire
};

export const RELEASE = {
  // Tapping a tray queues its WHOLE stack to dump. The queued balls are only
  // placed onto the loop once the dial has been calm (not spinning) for placeDelayMs.
  placeDelayMs: 500,      // wait after spinning stops before placing queued balls
  spinThreshold: 1.6,     // |omega| > baseSpeed*this (or an active drag) counts as "still spinning"
  streamAngleGap: 1.15,   // angular spacing between the poured balls (× one ball-diameter / R)
};

export const SEAT = {
  // A ball can only drop OFF the belt into a bin once the belt has FULLY returned
  // to auto-flow — the player isn't spinning AND the flywheel has decayed back to
  // base speed — and has stayed that way for autoFlowDelayMs. While the player
  // spins (or the dial is still coasting), balls just keep riding.
  autoFlowDelayMs: 1000,  // hold auto-flow this long before drop-offs are allowed
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
};

// ---- LEVEL DEFINITION -------------------------------------------------------
// One hardcoded starting level. Adding a level = push another object to LEVELS.
// bins:  fixed-color collection bins along the bottom (left -> right).
// trays: dispensers along the top (left -> right). Each tray is MONO-COLOR — its
//        whole stack is one color, and that color has a matching bin below.
const fill = (color, n) => Array.from({ length: n }, () => color);

export const LEVELS = [
  {
    name: 'Warm Up',
    // one bin per tray color (same order, so each source has a matching collector)
    bins: ['red', 'amber', 'green', 'blue'],
    trays: [
      fill('red', 6),
      fill('amber', 6),
      fill('green', 6),
      fill('blue', 6),
    ],
  },
];

export const ACTIVE_LEVEL = 0;
