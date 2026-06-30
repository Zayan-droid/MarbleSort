// packetQueue.js — PacketQueueManager: the TOP CANDY PACKET TRAYS.
//
// The top of the dispenser shows a row of MONO-COLOR packet trays (CandyTrayPackets art). Each
// packet holds a small BATCH of candies of ONE colour. ONE TAP BURSTS the whole packet: `consume(
// slotIndex)` hands over the batch (an array of {color, special}) and the emptied tray refills from
// the queue. The level AUTHORS its supply as `packets:[{color, count}]` — each entry is ONE packet
// tray of `count` candies (default PACKET.packetSize). The queue keeps the packets in authored order
// (mono-color, NOT interleaved — a tray is a single colour). Order is deterministic (no Math.random)
// so the headless smoketest reproduces.

import { resolveColor } from './traySlots.js';
import { PACKET } from '../config.js';

export class PacketQueueManager {
  constructor(levelData) {
    const defs = (levelData && levelData.packets) || [];
    const packetSize = PACKET.packetSize || 3;
    // The multiplier now lives on the JAR (see jars.js / SCORING.multiplier), not on candies — so
    // candies carry no `special` flag. The {special} plumbing is kept (always false) for API stability.
    this.queue = defs.map((d) => {
      const color = resolveColor(d.color);
      const count = d.count != null ? d.count : packetSize;
      const candies = Array.from({ length: count }, () => ({ special: false }));
      return { color, count, candies, hasSpecial: false };
    });
    const n = (levelData && levelData.packetSlots) || PACKET.slotCount;
    this.slots = Array.from({ length: n }, (_, i) => ({ slotId: i, packet: null }));
    for (const s of this.slots) this._fill(s.slotId);
  }

  slotById(slotId) { return this.slots.find((s) => s.slotId === slotId) || null; }

  // Pull the next queued packet into a slot (null if the queue is empty — the tray sits empty).
  _fill(slotId) {
    const slot = this.slotById(slotId);
    if (!slot) return null;
    slot.packet = this.queue.length ? this.queue.shift() : null;
    return slot.packet;
  }

  // No-ops kept for API compatibility with the old responsive candy RACK (resize() used to re-grid
  // individual candies). Packet TRAYS are a fixed count (packetSlots) and don't re-deal on resize.
  relayout() {}
  centerLastRow() {}

  // TAP: BURST the whole packet in `slotIndex`. Returns its batch as an array of {color, special}
  // (length = packet.count), then refills the tray from the queue. null if the slot is empty.
  consume(slotIndex) {
    const slot = this.slots[slotIndex];
    if (!slot || !slot.packet) return null;
    const p = slot.packet;
    const batch = p.candies.map((c) => ({ color: p.color, special: !!c.special }));
    this._fill(slot.slotId);
    return batch;
  }

  // Return ONE candy to the SUPPLY — e.g. it rolled back out of an over-filled tray. It becomes a
  // 1-candy packet at the FRONT of the queue and, if a tray is open, is dealt straight back in so
  // the player sees it return (keeps the level's supply/demand balance intact → still winnable).
  returnCandy(color, special = false) {
    this.queue.unshift({ color, count: 1, candies: [{ special: !!special }], hasSpecial: !!special });
    const empty = this.slots.find((s) => !s.packet);
    if (empty) this._fill(empty.slotId);
  }

  // Every tray's current packet (skipping empty trays).
  getActivePackets() { return this.slots.map((s) => s.packet).filter(Boolean); }

  // Total candies still to be dispensed (sitting in the trays + waiting in the queue). Drives the
  // HUD count and the win check.
  remainingCandies() {
    let n = 0;
    for (const s of this.slots) if (s.packet) n += s.packet.count;
    for (const p of this.queue) n += p.count;
    return n;
  }

  // True while any candy (in a tray or queued) is still to be dispensed.
  hasRemainingPackets() { return this.remainingCandies() > 0; }
}
