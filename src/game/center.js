// center.js — CenterContainerManager: the middle holding container.
//
// The main decision space and the ONLY buffer (capacity 6) — there is no storage tray. Candies
// tumble in from the dispenser and pile here; matching ones leave into an accepting active jar,
// and any whose color has no active jar WAIT here until a lane advances. This manager owns ONLY
// the logical contents — screen positions + animations live on the candy objects (PuzzleGame).
//
// A "candy" here is a plain object { colorKey, slot, anim, ... } shared across containers;
// `slot` is its index within whatever container currently owns it (for layout), and `anim`
// is an optional transient tween (see puzzle.js). This manager just tracks membership.

export class CenterContainerManager {
  constructor(capacity = 6) {
    this.capacity = capacity;
    this.candies = []; // candy objects currently in the container (incl. in-flight)
  }

  isEmpty() { return this.candies.length === 0; }
  count() { return this.candies.length; }
  hasRoom(n = 1) { return this.candies.length + n <= this.capacity; }

  // Colors currently present (one entry per distinct color).
  colorsPresent() {
    const set = new Set();
    for (const c of this.candies) set.add(c.colorKey);
    return [...set];
  }

  // Add candy objects, assigning each its center grid slot. Returns the added objects.
  add(candies) {
    for (const c of candies) {
      c.slot = this.candies.length;
      this.candies.push(c);
    }
    return candies;
  }

  // Remove up to `max` candies whose color === colorKey. Returns the removed objects;
  // the remaining candies are re-slotted so the grid stays compact.
  removeMatching(colorKey, max = Infinity) {
    const removed = [];
    const kept = [];
    for (const c of this.candies) {
      if (c.colorKey === colorKey && removed.length < max) removed.push(c);
      else kept.push(c);
    }
    this.candies = kept;
    this._reslot();
    return removed;
  }

  // Remove and return ALL candies (used when offloading the whole group to the tray).
  takeAll() {
    const all = this.candies;
    this.candies = [];
    return all;
  }

  _reslot() {
    for (let i = 0; i < this.candies.length; i++) this.candies[i].slot = i;
  }
}
