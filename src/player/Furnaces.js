import { getSmeltResult, getSmeltTime, getFuelBurnTime } from '../crafting/Smelting.js';
import { maxStackOf } from './slotOps.js';

const key = (x, y, z) => `${x},${y},${z}`;
const dec = (s) => (s && s.count > 1 ? { item: s.item, count: s.count - 1 } : null);

// Tracks per-furnace state by block position and smelts in the background
// (whether or not the furnace UI is open). State shape:
//   { input, fuel, output, cook, burnLeft, burnMax }
export class Furnaces {
  constructor() {
    this.map = new Map();
  }

  // Get or lazily create the furnace state at a position.
  get(x, y, z) {
    const k = key(x, y, z);
    let f = this.map.get(k);
    if (!f) {
      f = { input: null, fuel: null, output: null, cook: 0, burnLeft: 0, burnMax: 0 };
      this.map.set(k, f);
    }
    return f;
  }

  peek(x, y, z) {
    return this.map.get(key(x, y, z)) || null;
  }

  remove(x, y, z) {
    this.map.delete(key(x, y, z));
  }

  update(dt) {
    for (const f of this.map.values()) this._tick(f, dt);
  }

  _tick(f, dt) {
    const recipe = f.input ? getSmeltResult(f.input.item) : null;
    const outputOk =
      recipe && (!f.output || (f.output.item === recipe.output && f.output.count < maxStackOf(recipe.output)));
    const canSmelt = !!(recipe && outputOk);

    // Burn down current fuel.
    if (f.burnLeft > 0) f.burnLeft = Math.max(0, f.burnLeft - dt);

    // Light fresh fuel only when there's something to cook.
    if (f.burnLeft <= 0 && canSmelt && f.fuel) {
      const bt = getFuelBurnTime(f.fuel.item);
      if (bt > 0) {
        f.burnMax = bt;
        f.burnLeft = bt;
        f.fuel = dec(f.fuel);
      }
    }

    if (f.burnLeft > 0 && canSmelt) {
      f.cook += dt;
      if (f.cook >= getSmeltTime(f.input.item)) {
        f.cook = 0;
        f.output = f.output
          ? { item: f.output.item, count: f.output.count + recipe.count }
          : { item: recipe.output, count: recipe.count };
        f.input = dec(f.input);
      }
    } else if (f.cook > 0) {
      f.cook = Math.max(0, f.cook - dt * 2); // progress decays when not smelting
    }
  }
}
