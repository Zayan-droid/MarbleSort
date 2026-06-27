// packetQueue.js — PacketQueueManager: the dispenser's CANDY RACK.
//
// The dispenser is FILLED with individual candies (a grid of `slots`, each holding ONE candy
// color or null). ONE TAP drops ONE candy: `consume(slotIndex)` hands over that single candy's
// color and refills the slot from the queue. The level still AUTHORS its supply as mono packets
// (`packets:[{color,count}]`); this manager flattens them into a flat queue of individual candies,
// INTERLEAVED round-robin across the colors so the rack shows an assorted mix rather than colour
// blocks. Order is deterministic (no Math.random) so the headless smoketest is reproducible.

import { resolveColor } from './traySlots.js';
import { CENTER, DISPENSER } from '../config.js';

export class PacketQueueManager {
  constructor(levelData, rackCapacity) {
    const defs = (levelData && levelData.packets) || [];
    // per-color supply (preserving first-appearance order), then round-robin into a flat queue
    const groups = defs.map((d) => ({
      color: resolveColor(d.color),
      n: d.count != null ? d.count : CENTER.capacity,
    }));
    const counts = groups.map((g) => g.n);
    let left = counts.reduce((a, b) => a + b, 0);
    this.queue = [];
    while (left > 0) {
      for (let i = 0; i < groups.length; i++) {
        if (counts[i] > 0) { this.queue.push(groups[i].color); counts[i]--; left--; }
      }
    }
    // rack slots: filled from the front of the queue (extra slots stay empty if supply is small)
    const cap = rackCapacity || (levelData && levelData.rackCapacity) || (DISPENSER.rackCols * DISPENSER.rackRows);
    this.slots = Array.from({ length: cap }, (_, i) => ({ slotId: i, color: null }));
    for (const s of this.slots) this._fill(s.slotId);
  }

  slotById(slotId) { return this.slots.find((s) => s.slotId === slotId) || null; }

  // Pull the next queued candy into a slot (null if the queue is empty).
  _fill(slotId) {
    const slot = this.slotById(slotId);
    if (!slot) return null;
    slot.color = this.queue.length ? this.queue.shift() : null;
    return slot.color;
  }

  // TAP: drop the SINGLE candy in `slotIndex`. Returns a 1-length array of its color (so callers
  // can treat it like a spill) and refills the slot from the queue, or null if the slot is empty.
  consume(slotIndex) {
    const slot = this.slots[slotIndex];
    if (!slot || !slot.color) return null;
    const color = slot.color;
    this._fill(slot.slotId); // next queued candy (or null) slides into the slot
    return [color];
  }

  // Total candies still to be dispensed (sitting in the rack + waiting in the queue).
  remainingCandies() {
    let n = this.queue.length;
    for (const s of this.slots) if (s.color) n++;
    return n;
  }

  // True while any candy (in the rack or queued) is still to be dispensed.
  hasRemainingPackets() { return this.remainingCandies() > 0; }
}
