import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from '../../config.js';
import { Noise, mulberry32 } from '../noise.js';
import { getBlockId } from '../../blocks/BlockRegistry.js';

const GRASS = getBlockId('grass');
const DIRT = getBlockId('dirt');
const LOG = getBlockId('oak_log');
const LEAVES = getBlockId('oak_leaves');

const MARGIN = 2;       // keep canopy inside the chunk (avoids cross-chunk writes)
const MIN_SPACING = 4;  // min distance between trunks in a chunk
const SCAN_TOP = 110;   // highest grass we expect

function hash(x, z) {
  return (Math.imul(x | 0, 73856093) ^ Math.imul(z | 0, 19349663)) >>> 0;
}

function placeCanopy(chunk, lx, top, lz, rand) {
  for (let y = top - 2; y <= top + 1; y++) {
    const r = y <= top - 1 ? 2 : 1;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        // Round the corners of the wide layers (with a little variation).
        if (r === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2 && rand() < 0.6) continue;
        const x = lx + dx, z = lz + dz;
        if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) continue;
        if (chunk.get(x, y, z) === 0) chunk.set(x, y, z, LEAVES);
      }
    }
  }
}

function placeTree(chunk, lx, surfaceY, lz, rand, tall = false) {
  // Lush (jungle-ish) spots grow taller trees with a second canopy tier.
  const height = (tall ? 6 : 4) + Math.floor(rand() * 3);
  const top = surfaceY + height;
  if (top + 2 >= WORLD_HEIGHT) return;
  chunk.set(lx, surfaceY, lz, DIRT); // grass turns to dirt under the trunk
  for (let y = surfaceY + 1; y <= top; y++) chunk.set(lx, y, lz, LOG);
  placeCanopy(chunk, lx, top, lz, rand);
  if (tall) placeCanopy(chunk, lx, top - 3, lz, rand); // lower skirt of leaves
}

// Scatter oak trees across a chunk: only on grass, clumped by the forest noise
// field so dense woods and open plains both occur, with spacing so trunks don't
// crowd. Trees stay fully inside the chunk (MARGIN) to avoid cross-chunk writes.
export function generateTrees(chunk) {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const placed = [];

  for (let lx = MARGIN; lx < CHUNK_SIZE - MARGIN; lx++) {
    for (let lz = MARGIN; lz < CHUNK_SIZE - MARGIN; lz++) {
      const wx = baseX + lx, wz = baseZ + lz;

      // Find the surface; trees only grow on grass.
      let surfaceY = -1;
      for (let y = SCAN_TOP; y > SEA_LEVEL; y--) {
        if (chunk.get(lx, y, lz) !== 0) { surfaceY = y; break; }
      }
      if (surfaceY < 0 || chunk.get(lx, surfaceY, lz) !== GRASS) continue;

      // Density from the forest field: open plains ~0, dense woods up to ~10%.
      const density = (Noise.forest(wx, wz) + 1) / 2;
      const p = density * density * 0.11;
      const rand = mulberry32(hash(wx, wz));
      if (rand() > p) continue;

      // Enforce spacing between trunks.
      let tooClose = false;
      for (const [px, pz] of placed) {
        if (Math.abs(px - lx) < MIN_SPACING && Math.abs(pz - lz) < MIN_SPACING) { tooClose = true; break; }
      }
      if (tooClose) continue;

      // Hot + humid columns (jungle) grow tall trees.
      const tall = Noise.humidity(wx, wz) > 0.22 && Noise.temperature(wx, wz) > 0.3 && rand() < 0.7;
      placeTree(chunk, lx, surfaceY, lz, rand, tall);
      placed.push([lx, lz]);
    }
  }
}
