// jars.js — JarManager: the bottom target jars, organised into QUEUE LANES.
//
// Each jar is a target for ONE color with a fixed capacity. The jars are distributed
// round-robin across `JAR.queue.lanes` lanes (lane = jarIndex % laneCount), so each lane is a
// QUEUE of jars. The FRONT jar of a lane (the first not-yet-removed jar) is the ACTIVE jar —
// the only one that collects candies. The jars behind it are read-only previews. When the
// active jar fills it completes (locks → closing animation) and is then removed; the next jar
// in that lane becomes the front/active one. Geometry lives in PuzzleGame.resize() /
// _refreshJarSlots(); per-jar fill + lane state lives on the jar object here.

import { JAR, SCORING } from '../config.js';
import { hash32 } from './dispenser.js';
import { resolveColor } from './traySlots.js';

let _jid = 0;

function makeJar(def, i) {
  // MULTIPLIER JAR: explicitly flagged in the level (def.multiplier) OR a ~1-in-6 SEEDED random pick.
  // The roll is a deterministic hash of the jar index (NOT Math.random) so the scatter looks random
  // but reproduces for the smoketest. It wears the ×N glow/badge and pays the multiplier when
  // COMPLETED (see puzzle.js BOX_CLEAR + renderer._drawOneJar).
  const M = SCORING.multiplier;
  const roll = (hash32((i + 1) ^ (M.seed >>> 0)) >>> 0) / 4294967296;   // deterministic [0,1)
  return {
    id: def.id != null ? def.id : i,
    colorKey: resolveColor(def.color),
    shape: def.shape || null,        // descriptive only; the candy shape comes from the color
    capacity: def.capacity || JAR.defaultCapacity,
    multiplier: !!def.multiplier || (M.chance > 0 && roll < M.chance),
    candies: [],                     // seated candy objects (incl. ones still animating in)
    complete: false,                 // filled to capacity and locked → closing animation begins
    removed: false,                  // closing animation finished → jar sealed + gone (not drawn)
    clearAt: 0,                      // pop animation deadline (set when it completes)
    lane: 0,                         // which queue lane this jar belongs to
    laneOrder: 0,                    // its position within that lane's queue (0 = first)
  };
}

export class JarManager {
  constructor(levelData) {
    _jid = 0;
    const defs = (levelData && levelData.jars) || [];
    this.jars = defs.map(makeJar);
    // Distribute the jars round-robin across the lanes (so colors interleave across queues). Use
    // at most one lane per jar so a short level never leaves empty lanes.
    this.laneCount = Math.min(JAR.queue.lanes, Math.max(1, this.jars.length));
    this.lanes = Array.from({ length: this.laneCount }, () => []);
    this.jars.forEach((jar, i) => {
      jar.lane = i % this.laneCount;
      this.lanes[jar.lane].push(jar);
    });
    this.jars.forEach((jar) => { jar.laneOrder = this.lanes[jar.lane].indexOf(jar); });
  }

  jarById(id) { return this.jars.find((j) => j.id === id) || null; }

  // The FRONT jar of a lane: the first jar in that queue that hasn't been removed yet. This is
  // the lane's active (collectable) jar; null once the whole lane is cleared.
  frontJar(lane) {
    const q = this.lanes[lane];
    if (!q) return null;
    for (const j of q) if (!j.removed) return j;
    return null;
  }

  // Is this jar its lane's front (active) jar?
  isActive(jar) { return !!jar && this.frontJar(jar.lane) === jar; }

  // The active jar of every lane (one per lane that still has jars).
  activeJars() {
    const out = [];
    for (let i = 0; i < this.laneCount; i++) { const j = this.frontJar(i); if (j) out.push(j); }
    return out;
  }

  // Open room in a jar (candies it can still accept). 0 if complete or full.
  roomIn(jar) {
    if (!jar || jar.complete) return 0;
    return Math.max(0, jar.capacity - jar.candies.length);
  }

  // Can this jar accept candies of `colorKey` right now? Only the ACTIVE (front) jar of a lane
  // can — a preview jar is read-only.
  accepts(jar, colorKey) {
    return !!jar && this.isActive(jar) && !jar.complete && jar.colorKey === colorKey && this.roomIn(jar) > 0;
  }

  // Seat a candy object into a jar (slot = its index in the jar).
  add(jar, candy) {
    candy.slot = jar.candies.length;
    jar.candies.push(candy);
    return candy;
  }

  // Is every jar complete?
  allComplete() {
    return this.jars.every((j) => j.complete);
  }

  // True if any ACTIVE jar can still accept candies of `colorKey` (matching, not complete, room).
  anyAccepts(colorKey) {
    return this.activeJars().some((j) => this.accepts(j, colorKey));
  }
}
