import { getItem } from '../items/ItemRegistry.js';

export const maxStackOf = (name) => getItem(name)?.maxStack ?? 64;

// Pure cursor/slot interactions, returning fresh { slot, cursor } objects so
// they work for inventory slots and crafting cells alike (and play nice with
// React state). `slot` and `cursor` are { item, count } or null.

export function leftClick(slot, cursor) {
  if (!cursor) return { slot: null, cursor: slot };          // pick up
  if (!slot) return { slot: cursor, cursor: null };          // drop all
  if (slot.item === cursor.item) {                           // merge
    const room = maxStackOf(slot.item) - slot.count;
    const move = Math.min(room, cursor.count);
    return {
      slot: { item: slot.item, count: slot.count + move },
      cursor: cursor.count - move > 0 ? { item: cursor.item, count: cursor.count - move } : null,
    };
  }
  return { slot: cursor, cursor: slot };                     // swap
}

export function rightClick(slot, cursor) {
  if (!cursor) {
    if (!slot) return { slot: null, cursor: null };
    const take = Math.ceil(slot.count / 2);                  // pick up half
    const left = slot.count - take;
    return {
      slot: left > 0 ? { item: slot.item, count: left } : null,
      cursor: { item: slot.item, count: take },
    };
  }
  // Drop a single item into an empty or matching slot.
  if (!slot) {
    return {
      slot: { item: cursor.item, count: 1 },
      cursor: cursor.count - 1 > 0 ? { item: cursor.item, count: cursor.count - 1 } : null,
    };
  }
  if (slot.item === cursor.item && slot.count < maxStackOf(slot.item)) {
    return {
      slot: { item: slot.item, count: slot.count + 1 },
      cursor: cursor.count - 1 > 0 ? { item: cursor.item, count: cursor.count - 1 } : null,
    };
  }
  return { slot, cursor };
}
