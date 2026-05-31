import data from './smelting.json';

const recipeByInput = {};
for (const r of data.recipes) recipeByInput[r.input] = r;

// Returns { output, count } for a smeltable input item, or null.
export function getSmeltResult(itemName) {
  const r = itemName && recipeByInput[itemName];
  return r ? { output: r.output, count: r.count || 1 } : null;
}

// Seconds to smelt one of `itemName` (recipe override or default).
export function getSmeltTime(itemName) {
  const r = itemName && recipeByInput[itemName];
  return (r && r.time) || data.defaultTime;
}

// Seconds one unit of `itemName` burns as fuel (0 if not a fuel).
export function getFuelBurnTime(itemName) {
  return (itemName && data.fuels[itemName]) || 0;
}
