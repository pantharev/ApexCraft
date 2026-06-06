import recipeData from './recipes.json';

// Pre-normalize shaped recipes into a trimmed 2D grid of item names (null for
// empty), and shapeless recipes into a sorted ingredient list, so matching is a
// straight comparison at runtime.
const shaped = [];
const shapeless = [];

for (const r of recipeData) {
  if (r.type === 'shapeless') {
    shapeless.push({ ...r, sorted: [...r.ingredients].sort() });
  } else {
    const rows = r.pattern.length;
    const cols = Math.max(...r.pattern.map((line) => line.length));
    const grid = [];
    for (let y = 0; y < rows; y++) {
      const row = [];
      for (let x = 0; x < cols; x++) {
        const ch = r.pattern[y][x] || ' ';
        row.push(ch === ' ' ? null : r.key[ch]);
      }
      grid.push(row);
    }
    shaped.push({ ...r, grid, rows, cols });
  }
}

// Extract the bounding box of non-null cells from a flat NxN grid of item names.
function trim(cells, size) {
  let minR = size, maxR = -1, minC = size, maxC = -1;
  let count = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (cells[r * size + c]) {
        count++;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }
  if (count === 0) return null;
  const grid = [];
  for (let r = minR; r <= maxR; r++) {
    const row = [];
    for (let c = minC; c <= maxC; c++) row.push(cells[r * size + c]);
    grid.push(row);
  }
  return { grid, rows: maxR - minR + 1, cols: maxC - minC + 1, count };
}

function matchShaped(trimmed, recipe) {
  if (trimmed.rows !== recipe.rows || trimmed.cols !== recipe.cols) return false;
  for (let r = 0; r < recipe.rows; r++) {
    for (let c = 0; c < recipe.cols; c++) {
      if ((trimmed.grid[r][c] || null) !== (recipe.grid[r][c] || null)) return false;
    }
  }
  return true;
}

// `cells` is a flat array (size*size) of item-name strings or null. Returns the
// matching recipe's result { item, count } or null.
export function matchRecipe(cells, size) {
  const trimmed = trim(cells, size);
  if (!trimmed) return null;

  for (const r of shaped) {
    if (matchShaped(trimmed, r)) return { ...r.result };
  }

  const present = cells.filter(Boolean).sort();
  for (const r of shapeless) {
    if (present.length === r.sorted.length && present.every((v, i) => v === r.sorted[i])) {
      return { ...r.result };
    }
  }
  return null;
}

// Tally the ingredient requirements of a recipe as [{ item, count }].
function requirementsOf(r) {
  const counts = {};
  if (r.type === 'shapeless') {
    for (const it of r.ingredients) counts[it] = (counts[it] || 0) + 1;
  } else {
    for (const line of r.pattern) for (const ch of line) {
      if (ch !== ' ') { const it = r.key[ch]; counts[it] = (counts[it] || 0) + 1; }
    }
  }
  return Object.entries(counts).map(([item, count]) => ({ item, count }));
}

// Normalized recipe list for the recipe book UI.
export const RECIPES = recipeData.map((r) => ({
  id: r.id,
  result: { ...r.result },
  requirements: requirementsOf(r),
  size: r.type === 'shapeless' ? 1 : Math.max(r.pattern.length, ...r.pattern.map((l) => l.length)),
}));
