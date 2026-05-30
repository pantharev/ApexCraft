import itemData from './items.json';

// Central item lookup by name. Items are referenced by string id everywhere
// (drops, recipes, inventory) so this is the single source of truth.
const byName = {};
for (const def of itemData) {
  byName[def.name] = { maxStack: 64, ...def };
}

export function getItem(name) {
  return byName[name] || null;
}

export function isTool(name) {
  const it = byName[name];
  return !!(it && it.toolType);
}

export const ALL_ITEMS = itemData;
