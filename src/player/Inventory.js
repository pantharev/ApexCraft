import { maxStackOf, leftClick, rightClick } from './slotOps.js';

export const HOTBAR_SIZE = 9;
export const TOTAL_SLOTS = 36; // 0-8 hotbar, 9-35 main grid

// Central inventory store. Holds 36 slots of { item, count } (or null) plus the
// selected hotbar index. Exposes a subscribe/notify channel so the React UI can
// re-render on change without a framework store.
export class Inventory {
  constructor() {
    this.slots = new Array(TOTAL_SLOTS).fill(null);
    this.selected = 0; // hotbar index 0-8
    this._listeners = new Set();
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  notify() {
    for (const fn of this._listeners) fn();
  }

  getSlot(i) {
    return this.slots[i];
  }

  setSlot(i, stack) {
    this.slots[i] = stack && stack.count > 0 ? stack : null;
    this.notify();
  }

  setSelected(i) {
    this.selected = ((i % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    this.notify();
  }

  cycleSelected(dir) {
    this.setSelected(this.selected + Math.sign(dir));
  }

  selectedStack() {
    return this.slots[this.selected];
  }

  // Decrement the selected hotbar stack by n (used when placing blocks).
  consumeSelected(n = 1) {
    const s = this.slots[this.selected];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.notify();
  }

  // Add items: top up matching stacks first, then fill empty slots. Returns the
  // leftover count that didn't fit (so the world drop can persist).
  addItem(name, count) {
    const max = maxStackOf(name);
    let remaining = count;

    // Pass 1: existing partial stacks.
    for (let i = 0; i < TOTAL_SLOTS && remaining > 0; i++) {
      const s = this.slots[i];
      if (s && s.item === name && s.count < max) {
        const room = max - s.count;
        const add = Math.min(room, remaining);
        s.count += add;
        remaining -= add;
      }
    }
    // Pass 2: empty slots (hotbar first for convenience).
    for (let i = 0; i < TOTAL_SLOTS && remaining > 0; i++) {
      if (!this.slots[i]) {
        const add = Math.min(max, remaining);
        this.slots[i] = { item: name, count: add };
        remaining -= add;
      }
    }

    if (remaining !== count) this.notify();
    return remaining;
  }

  // Would `count` of `name` fully fit (used to gate shift-click crafting)?
  canFit(name, count) {
    const max = maxStackOf(name);
    let cap = 0;
    for (const s of this.slots) {
      if (!s) cap += max;
      else if (s.item === name) cap += max - s.count;
      if (cap >= count) return true;
    }
    return cap >= count;
  }

  // Cursor-stack interactions used by the UI; delegate to the shared slot ops.
  clickSlot(i, cursor) {
    const r = leftClick(this.slots[i], cursor);
    this.slots[i] = r.slot;
    this.notify();
    return r.cursor;
  }

  rightClickSlot(i, cursor) {
    const r = rightClick(this.slots[i], cursor);
    this.slots[i] = r.slot;
    this.notify();
    return r.cursor;
  }
}
