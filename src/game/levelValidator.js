// levelValidator.js — validateLevel: sanity-check a level definition.
//
// Warns (does not throw) so a level author notices a malformed / unwinnable build, mirroring
// the conveyor's validatePacketBalance style. Rules (from the design spec):
//   * packet (supply group) count is 3..15
//   * every packet supplies at least 1 candy (count is just per-color supply now — the rack
//     flattens packets into individual candies, so it no longer has to equal the tray capacity)
//   * center container capacity === 6
//   * total packet candies per color === total jar capacity per color (winnable)

import { CENTER, JAR } from '../config.js';
import { resolveColor } from './traySlots.js';

export function validateLevel(level) {
  const warn = (m) => console.warn(`[level] ${m}`);
  let ok = true;
  const flag = (m) => { ok = false; warn(m); };

  const packets = (level && level.packets) || [];
  const jars = (level && level.jars) || [];

  if (packets.length < 3) flag(`only ${packets.length} packets (minimum 3)`);
  if (packets.length > 15) flag(`${packets.length} packets (maximum 15)`);

  for (const p of packets) {
    const c = p.count != null ? p.count : CENTER.capacity;
    if (!(c >= 1)) flag(`packet "${p.id ?? p.color}" supplies ${c} candies (must be >= 1)`);
  }

  const centerCap = (level.centerContainer && level.centerContainer.capacity) ?? CENTER.capacity;
  if (centerCap !== 6) flag(`center capacity ${centerCap} (must be 6)`);

  // supply vs demand per color
  const supply = new Map();
  const demand = new Map();
  const addv = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  for (const p of packets) addv(supply, resolveColor(p.color), p.count != null ? p.count : CENTER.capacity);
  for (const j of jars) addv(demand, resolveColor(j.color), j.capacity || JAR.defaultCapacity);
  for (const c of new Set([...supply.keys(), ...demand.keys()])) {
    const s = supply.get(c) || 0;
    const d = demand.get(c) || 0;
    if (s !== d) flag(`color "${c}": packets supply ${s} but jars demand ${d} (unwinnable)`);
  }

  return ok;
}
