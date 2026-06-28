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

  // RESPONSIVE re-grid: re-deal the candies still to dispense into a rack of `capacity` slots. Used
  // when resize() switches the rack grid (e.g. 11×3 ⇄ 6×6) and the cell count changes. Preserves the
  // remaining candies in order (filled slots first, then the queue), so at game start (nothing
  // consumed yet) this reproduces the same rack a fresh build of that grid would make. A no-op if the
  // capacity is unchanged.
  relayout(capacity) {
    if (capacity === this.slots.length) return;
    const remaining = [];
    for (const s of this.slots) if (s.color) remaining.push(s.color);
    for (const c of this.queue) remaining.push(c);
    this.queue = remaining;
    this.slots = Array.from({ length: capacity }, (_, i) => ({ slotId: i, color: null }));
    for (const s of this.slots) this._fill(s.slotId);
  }

  // Pull the next queued candy into a slot (null if the queue is empty).
  _fill(slotId) {
    const slot = this.slotById(slotId);
    if (!slot) return null;
    slot.color = this.queue.length ? this.queue.shift() : null;
    return slot.color;
  }

  // Center the candies in a PARTIAL last row. When the rack has more cells than the supply (e.g. a
  // 6×6 = 36-cell grid holding 32 candies), the trailing slots are empty, so the last row fills from
  // the LEFT. Shift its candies into the MIDDLE columns (padding both edges with empty slots) so the
  // bottom row reads centred. Moves the COLORS (not just x positions), so the front-first rule and
  // the blocked-candy dimming stay aligned with what's drawn. Only fires when the queue is empty
  // (a partial row only exists when supply < capacity), so no refill ever lands in a padded edge.
  centerLastRow(cols) {
    if (this.queue.length || cols < 1) return;
    const n = this.slots.length;
    const rows = Math.ceil(n / cols);
    if (rows < 1) return;
    const start = (rows - 1) * cols;
    const lastRow = this.slots.slice(start);                 // the final row's slots, left→right
    const colors = lastRow.filter((s) => s.color).map((s) => s.color);
    if (!colors.length || colors.length >= lastRow.length) return; // empty or already full → nothing to do
    const offset = Math.floor((lastRow.length - colors.length) / 2);
    if (offset <= 0) return;
    for (let c = 0; c < lastRow.length; c++) {
      const k = c - offset;
      this.slots[start + c].color = (k >= 0 && k < colors.length) ? colors[k] : null;
    }
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
