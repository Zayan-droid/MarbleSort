// events.js — the central event bus.
// Every game event flows through here so its visual + audio + haptic handlers
// run synchronously on the SAME frame. That same-frame synchrony is what reads
// as "juicy". Handlers are invoked inline (not queued) at emit() time.

class EventBus {
  constructor() {
    this._handlers = new Map();
  }

  on(type, handler) {
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(handler);
    return () => this.off(type, handler);
  }

  off(type, handler) {
    const set = this._handlers.get(type);
    if (set) set.delete(handler);
  }

  emit(type, payload) {
    const set = this._handlers.get(type);
    if (!set) return;
    for (const h of set) {
      try {
        h(payload);
      } catch (err) {
        // A misbehaving listener must not break the frame for the others.
        console.error(`[events] handler for "${type}" threw:`, err);
      }
    }
  }
}

// Canonical event names (one source of truth; avoids typos across modules).
export const EV = {
  MARBLE_CLINK: 'marble:clink',   // {x, y, angle, intensity}
  CANDY_RELEASE: 'candy:release', // {x, y, color, angle}  — one candy left a packet
  MARBLE_SEAT: 'marble:seat',     // {x, y, color}  — a candy settled into a jar
  MOVE_INVALID: 'move:invalid',   // {x, y}  — a rejected move (wrong jar / full tray)
  BOX_CLEAR: 'box:clear',         // {x, y, color}  — a jar completed
  PEG_HIT: 'peg:hit',             // {x, y, note01, speed01, pan, color, pegIndex} — candy struck a funnel pin
  DIAL_DETENT: 'dial:detent',     // {speed}
  DIAL_SPIN: 'dial:spin',         // {speed}  (continuous; emitted each frame)
  JAM_WARNING: 'jam:warning',     // {count}
  GAME_WIN: 'game:win',
  GAME_LOSE: 'game:lose',
};

export const bus = new EventBus();
