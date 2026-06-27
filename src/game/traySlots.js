// traySlots.js — per-slot tray QUEUES for the collection trays.
//
// Each physical collection slot (leftTop, leftBottom, …) is a FIXED POSITION that owns
// its OWN queue of trays. The slot is NOT color-bound: the tray currently inside it is
// just the front of that slot's queue. When the active tray fills, it is removed, the
// queue shifts forward, and the next tray (any color) becomes active — while the next
// few trays stay visible as a preview so the player can plan ahead.
//
// This manager owns ONLY the queue bookkeeping (which tray is where). Geometry lives in
// GameState.resize() / the renderer; collection state (filled / seated / clearing) lives
// on each tray object below. GameState drives completion when a tray fills.

import { COLOR_ALIASES, BIN } from '../config.js';

// Friendly level-data color names (e.g. 'yellow') -> a real COLORS key.
export function resolveColor(key) {
  return (COLOR_ALIASES && COLOR_ALIASES[key]) || key;
}

// One tray instance: an active or queued collection tray. Collection state lives here so
// it travels with the tray as it moves from "queued" -> "active" -> completed/removed.
function makeTray(def) {
  return {
    colorKey: resolveColor(def.color),
    shape: def.shape || null,       // descriptive only; the candy shape comes from its color
    capacity: def.capacity || BIN.slots,
    filled: 0,
    seated: [],                     // { colorKey, x, y, slot, pop }
    clearing: false,
    clearAt: 0,
  };
}

export class TraySlotManager {
  constructor(levelData) {
    this.initializeTraySlots(levelData);
  }

  // Build a slot for every entry in levelData.traySlots, then pull each slot's first
  // tray into its active position. After this, every slot has an activeTray (or null if
  // its queue was empty) and a previewTrays list of the next few.
  initializeTraySlots(levelData) {
    const defs = (levelData && levelData.traySlots) || [];
    this.slots = defs.map((s, i) => ({
      slotId: s.slotId != null ? s.slotId : i,
      position: s.position || '',
      queue: (s.queue || []).map(makeTray), // upcoming trays NOT yet active (FIFO)
      activeTray: null,
      previewTrays: [],
    }));
    for (const slot of this.slots) this.spawnActiveTray(slot.slotId);
    return this.slots;
  }

  slotById(slotId) {
    return this.slots.find((s) => s.slotId === slotId) || null;
  }

  // Pull the front of the slot's queue into the active position (null if the queue is
  // empty — the slot then sits inactive). Refreshes the preview.
  spawnActiveTray(slotId) {
    const slot = this.slotById(slotId);
    if (!slot) return null;
    slot.activeTray = slot.queue.length ? slot.queue.shift() : null;
    this.updateTrayPreview(slotId);
    return slot.activeTray;
  }

  // Recompute the visible "coming up" trays for a slot: the upcoming trays that line up
  // behind the active one. We expose up to maxVisible-1 (active + these = maxVisible); the
  // layout decides how many of those actually fit fully on screen for this slot.
  updateTrayPreview(slotId) {
    const slot = this.slotById(slotId);
    if (!slot) return [];
    const maxPreviews = Math.max(0, ((BIN.queue && BIN.queue.maxVisible) || 4) - 1);
    slot.previewTrays = slot.queue.slice(0, maxPreviews);
    return slot.previewTrays;
  }

  // The active tray finished (filled + cleared). Remove it and shift the queue forward
  // so the next tray becomes active. Returns the completed tray.
  completeActiveTray(slotId) {
    const slot = this.slotById(slotId);
    if (!slot) return null;
    const done = slot.activeTray;
    slot.activeTray = null;
    this.shiftTrayQueue(slotId);
    return done;
  }

  // Advance a slot's queue: the next queued tray moves into the active position.
  shiftTrayQueue(slotId) {
    return this.spawnActiveTray(slotId);
  }

  // Every slot's current active tray (skipping inactive/empty slots). These are the only
  // trays that collect candies — preview trays never do.
  getActiveTrays() {
    return this.slots.map((s) => s.activeTray).filter(Boolean);
  }

  // True while any slot still has an active tray OR trays waiting in its queue.
  hasRemainingTrays() {
    return this.slots.some((s) => s.activeTray || s.queue.length > 0);
  }
}
