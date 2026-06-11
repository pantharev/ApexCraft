import { SEA_LEVEL } from '../../config.js';
import { Noise, mulberry32, getSeed } from '../noise.js';
import { columnHeight } from '../generators/Height.js';

// Village planning — PURE functions of (world seed, coordinates), no chunk
// state. Villages span many chunks, so every chunk must be able to compute
// the same village layout independently and emit only its own slice; that
// works exactly because everything here is deterministic.
//
// The world is divided into CELL×CELL regions; each cell rolls one village
// candidate at a jittered position, validated against the heightfield (dry,
// flattish, no mountains, no rifts). Layouts put a well at the centre and a
// ring of houses facing it.

const CELL = 224;
const VILLAGE_CHANCE = 0.8;

// Integer hash of a cell, mixed with the world seed.
function cellHash(cx, cz) {
  let h = getSeed() | 0;
  h = Math.imul(h ^ Math.imul(cx | 0, 374761393), 668265263);
  h = Math.imul(h ^ Math.imul(cz | 0, 2246822519), 3266489917);
  return (h ^ (h >>> 15)) >>> 0;
}

// Caches keyed by seed so switching worlds never reuses stale plans.
const centerCache = new Map(); // -> village {x, z, y, seed} | null
const layoutCache = new Map(); // -> { well, houses }

// The (validated) village for a cell, or null.
export function villageForCell(cellX, cellZ) {
  const key = `${getSeed()}:${cellX},${cellZ}`;
  if (centerCache.has(key)) return centerCache.get(key);

  let v = null;
  const rng = mulberry32(cellHash(cellX, cellZ));
  if (rng() < VILLAGE_CHANCE) {
    // Jitter inside the cell, keeping the footprint away from cell borders.
    const x = Math.floor(cellX * CELL + 64 + rng() * (CELL - 128));
    const z = Math.floor(cellZ * CELL + 64 + rng() * (CELL - 128));
    const y = columnHeight(x, z);

    // Site check: dry lowland, no rift region, and flat across the footprint.
    let ok = y > SEA_LEVEL + 2 && y < 82 && Noise.riftMask(x, z) < 0.05;
    if (ok) {
      let lo = y, hi = y;
      for (const [dx, dz] of [[-16, 0], [16, 0], [0, -16], [0, 16], [-12, -12], [12, 12], [12, -12], [-12, 12]]) {
        const h = columnHeight(x + dx, z + dz);
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
      ok = hi - lo <= 8 && lo > SEA_LEVEL + 1;
    }
    if (ok) v = { x, z, y, seed: (cellHash(cellX, cellZ) ^ 0x9e3779b9) >>> 0 };
  }
  centerCache.set(key, v);
  return v;
}

// Villages whose centre lies within `radius` of (wx, wz). Cells are far
// larger than any village footprint, so checking the 3×3 neighbourhood of
// the containing cell is exhaustive.
export function villagesNear(wx, wz, radius = 64) {
  const out = [];
  const cx = Math.floor(wx / CELL), cz = Math.floor(wz / CELL);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const v = villageForCell(cx + dx, cz + dz);
      if (v && Math.hypot(v.x - wx, v.z - wz) <= radius) out.push(v);
    }
  }
  return out;
}

// Deterministic layout: well at the centre; 4-7 houses on a ring around it,
// doors snapped toward the well; houses on steep or wet ground are dropped.
export function villageLayout(v) {
  const key = `${getSeed()}:${v.x},${v.z}`;
  if (layoutCache.has(key)) return layoutCache.get(key);

  const rng = mulberry32(v.seed);
  const houses = [];
  const count = 4 + Math.floor(rng() * 4); // 4..7 attempts
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const r = 15 + rng() * 12;
    const hx = Math.floor(v.x + Math.cos(angle) * r);
    const hz = Math.floor(v.z + Math.sin(angle) * r);
    const w = 5 + Math.floor(rng() * 3); // 5..7 along x
    const d = 5 + Math.floor(rng() * 3); // 5..7 along z
    const table = rng() < 0.5;
    const chest = rng() < 0.35;
    const hay = rng() < 0.45;
    const floorY = columnHeight(hx, hz);
    // Drop houses that would hang off a slope or stand in water.
    if (Math.abs(floorY - v.y) > 6 || floorY <= SEA_LEVEL + 1) continue;
    // Door faces the well, snapped to the dominant axis.
    const dx = v.x - hx, dz = v.z - hz;
    const facing = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? '+x' : '-x') : (dz > 0 ? '+z' : '-z');
    houses.push({ x: hx, z: hz, w, d, floorY, facing, table, chest, hay });
  }

  const layout = { well: { x: v.x, z: v.z, y: v.y }, houses };
  layoutCache.set(key, layout);
  return layout;
}

export { CELL as VILLAGE_CELL };
