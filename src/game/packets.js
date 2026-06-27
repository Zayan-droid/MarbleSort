// packets.js — the TOP SOURCE PACKETS: finite, mixed-color batches in a queue.
//
// The top of the screen has a fixed number of packet SLOTS (a slot is just a POSITION,
// never color-bound). Each slot holds the front packet of a shared FIFO queue. A packet
// owns a finite, ordered list of candies; tapping it streams those candies onto the loop
// one at a time (the streaming/timing lives in GameState — this manager owns only the
// queue bookkeeping). When a packet has released all its candies it is removed and the
// next queued packet fills that slot; if the queue is empty, the slot goes inactive.
//
// This mirrors traySlots.js (the collection side): there, each slot owns a queue of trays
// to COLLECT; here, each slot owns the front of a queue of packets to DISPENSE.

import { BIN, PACKET } from '../config.js';
import { resolveColor } from './traySlots.js';

let _pid = 0;

// One packet instance: a finite MONO-COLOR tray. It dispenses `count` candies of a single
// `color`; `releasedCount` is how many have left so far. `state`:
//   'idle'      — waiting in a slot, tappable
//   'releasing' — currently streaming its candies (tapping it is disabled)
// A packet is single-color by design (Marble-Sort style). For backward compatibility a legacy
// mixed `{ candies: [...] }` def is collapsed to its first color + length (it should not be
// used for new content — gameplay-facing packets are mono-color).
function makePacket(def) {
  let color = def.color;
  let count = def.count;
  let shape = def.shape || null;
  if (color == null && Array.isArray(def.candies)) {
    color = def.candies[0] && def.candies[0].color;
    count = def.candies.length;
    shape = (def.candies[0] && def.candies[0].shape) || shape;
  }
  return {
    packetId: def.packetId != null ? def.packetId : _pid++,
    color: resolveColor(color),
    shape,                               // descriptive only; the drawn shape comes from the color
    count: count != null ? count : BIN.slots,
    releasedCount: 0,
    state: 'idle',
  };
}

export class PacketManager {
  constructor(levelData) {
    this.initializePackets(levelData);
  }

  // Build the packet queue from levelData.topPacketQueue (or auto-derive it), then pull the
  // first `packetSlots` packets into the slots. After this, every slot has a packet (or null
  // if the queue ran out) sitting idle and waiting for a tap.
  initializePackets(levelData) {
    _pid = 0;
    const defs = (levelData && levelData.topPacketQueue) || this._derivePackets(levelData);
    this.queue = defs.map(makePacket);
    const n = (levelData && levelData.packetSlots) || PACKET.slotCount;
    this.slots = Array.from({ length: n }, (_, i) => ({ slotId: i, packet: null }));
    this.spawnInitialPackets();
    return this.slots;
  }

  // Fallback when a level omits topPacketQueue: derive MONO-COLOR packets from total tray
  // demand (sum of capacities per color, in first-appearance order), chunked into small
  // batches so a packet stays a LIMITED batch rather than one giant dump. Winnable by
  // construction (supply per color === demand per color).
  _derivePackets(levelData) {
    const counts = new Map();
    const order = [];
    for (const slot of ((levelData && levelData.traySlots) || [])) {
      for (const t of (slot.queue || [])) {
        const c = resolveColor(t.color);
        if (!counts.has(c)) { counts.set(c, 0); order.push(c); }
        counts.set(c, counts.get(c) + (t.capacity || BIN.slots));
      }
    }
    const chunk = Math.max(1, PACKET.autoChunk);
    const out = [];
    for (const c of order) {
      let left = counts.get(c);
      while (left > 0) {
        const k = Math.min(chunk, left);
        out.push({ color: c, count: k });
        left -= k;
      }
    }
    return out;
  }

  slotById(slotId) {
    return this.slots.find((s) => s.slotId === slotId) || null;
  }

  spawnInitialPackets() {
    for (const s of this.slots) this.spawnPacketInSlot(s.slotId);
  }

  // Pull the front of the shared queue into a slot (null if the queue is empty — the slot
  // then sits inactive). Returns the packet now in the slot.
  spawnPacketInSlot(slotId) {
    const slot = this.slotById(slotId);
    if (!slot) return null;
    slot.packet = this.queue.length ? this.queue.shift() : null;
    return slot.packet;
  }

  // A packet finished releasing: drop it and pull the next queued packet into the slot.
  refillPacketSlot(slotId) {
    return this.spawnPacketInSlot(slotId);
  }

  // Every slot's current packet (skipping inactive/empty slots).
  getActivePackets() {
    return this.slots.map((s) => s.packet).filter(Boolean);
  }

  // Candies in a packet not yet released.
  remainingInPacket(p) {
    return p ? p.count - p.releasedCount : 0;
  }

  // Total candies still to be dispensed across all slots + the waiting queue. Drives the
  // HUD count and the win check.
  remainingCandies() {
    let n = 0;
    for (const s of this.slots) n += this.remainingInPacket(s.packet);
    for (const p of this.queue) n += this.remainingInPacket(p);
    return n;
  }

  // True while any candy anywhere (slot packet or queued packet) is still to be released.
  hasRemainingPackets() {
    return this.remainingCandies() > 0;
  }
}

// Sanity-check a level's supply vs demand: total packet candies per color should equal the
// total tray capacity demanded per color. Warns (does not throw) on a mismatch so a level
// author notices an unwinnable build. Auto-derived packets always match, so skip them.
export function validatePacketBalance(levelData) {
  const defs = (levelData && levelData.topPacketQueue);
  if (!defs || !defs.length) return true;
  const supply = new Map();
  const demand = new Map();
  const add = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  for (const p of defs) {
    if (Array.isArray(p.candies)) { for (const c of p.candies) add(supply, resolveColor(c.color), 1); }
    else add(supply, resolveColor(p.color), p.count != null ? p.count : BIN.slots);
  }
  for (const slot of ((levelData && levelData.traySlots) || [])) {
    for (const t of (slot.queue || [])) add(demand, resolveColor(t.color), t.capacity || BIN.slots);
  }
  let balanced = true;
  for (const c of new Set([...supply.keys(), ...demand.keys()])) {
    const s = supply.get(c) || 0;
    const d = demand.get(c) || 0;
    if (s !== d) {
      balanced = false;
      console.warn(`[packets] balance: color "${c}" supplies ${s} candy but trays demand ${d}`);
    }
  }
  return balanced;
}
