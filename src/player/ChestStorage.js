import { getBlockId } from '../blocks/BlockRegistry.js';

const CHEST = getBlockId('chest');
const SLOTS = 27;
const key = (x, y, z) => `${x},${y},${z}`;
const HORIZ = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Per-position chest storage (27 slots each). Two chests placed side-by-side
// open as one 54-slot "double chest" via a routed get/set view, but each block
// keeps its own 27 slots (so breaking one only drops its half).
export class ChestStorage {
  constructor() {
    this.map = new Map();
  }

  get(x, y, z) {
    const k = key(x, y, z);
    let c = this.map.get(k);
    if (!c) { c = { slots: new Array(SLOTS).fill(null) }; this.map.set(k, c); }
    return c;
  }

  peek(x, y, z) {
    return this.map.get(key(x, y, z)) || null;
  }

  remove(x, y, z) {
    this.map.delete(key(x, y, z));
  }

  // Build a UI view for the chest at (x,y,z): single (27) or, if an adjacent
  // chest exists, a double (54) routed across both stores in a stable order.
  open(world, x, y, z) {
    const a = this.get(x, y, z);
    let px = null;
    for (const [dx, dz] of HORIZ) {
      if (world.getBlock(x + dx, y, z + dz) === CHEST) { px = [x + dx, y, z + dz]; break; }
    }

    if (!px) {
      return {
        size: SLOTS, title: 'Chest',
        get: (i) => a.slots[i],
        set: (i, s) => { a.slots[i] = s; },
      };
    }

    const b = this.get(px[0], px[1], px[2]);
    // Stable ordering so both chests open the same combined layout.
    const aFirst = x < px[0] || (x === px[0] && z < px[2]);
    const first = aFirst ? a : b;
    const second = aFirst ? b : a;
    return {
      size: SLOTS * 2, title: 'Large Chest',
      get: (i) => (i < SLOTS ? first.slots[i] : second.slots[i - SLOTS]),
      set: (i, s) => { if (i < SLOTS) first.slots[i] = s; else second.slots[i - SLOTS] = s; },
    };
  }

  serialize() {
    const out = {};
    for (const [k, c] of this.map) out[k] = c.slots;
    return out;
  }

  load(obj) {
    this.map.clear();
    if (!obj) return;
    for (const k of Object.keys(obj)) {
      const slots = new Array(SLOTS).fill(null);
      const src = obj[k] || [];
      for (let i = 0; i < SLOTS; i++) {
        const s = src[i];
        if (s && s.item && s.count > 0) slots[i] = { item: s.item, count: s.count };
      }
      this.map.set(k, { slots });
    }
  }
}
