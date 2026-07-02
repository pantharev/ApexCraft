import { CHUNK_SIZE } from '../../config.js';

// Shared helpers for Prop Hunt arena maps. Every map is a PURE function of the
// world seed: each chunk computes the same layout independently and stamps only
// the cells that fall inside itself — exactly like village stamping.
//
// NOTE: there is no plain 'cobblestone' block (getBlockId returns 0/air for it);
// masonry palettes must use stone / andesite / sandstone / mossy_cobblestone.

// Grass floor level of the flat arena base (see TerrainGen's hideseek branch).
// Shared by all maps — bots and spawn heights key off it.
export const FLOOR_Y = 64;

// Stamp world-block (wx,wy,wz) into the chunk if it lies inside it.
export function put(chunk, baseX, baseZ, wx, wy, wz, id) {
  const lx = wx - baseX, lz = wz - baseZ;
  if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) chunk.set(lx, wy, lz, id);
}

// Inclusive world-space box fill, clipped to the chunk.
export function fillBox(chunk, baseX, baseZ, x0, y0, z0, x1, y1, z1, id) {
  const wxA = Math.max(x0, baseX), wxB = Math.min(x1, baseX + CHUNK_SIZE - 1);
  const wzA = Math.max(z0, baseZ), wzB = Math.min(z1, baseZ + CHUNK_SIZE - 1);
  for (let wx = wxA; wx <= wxB; wx++) {
    for (let wz = wzA; wz <= wzB; wz++) {
      for (let y = y0; y <= y1; y++) chunk.set(wx - baseX, y, wz - baseZ, id);
    }
  }
}

// True if this chunk lies entirely outside a [-half, half]² arena footprint.
export function chunkOutside(chunk, half) {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  return baseX > half || baseX + CHUNK_SIZE - 1 < -half ||
         baseZ > half || baseZ + CHUNK_SIZE - 1 < -half;
}

// Deterministic per-column hash in [0, 1) for weathering/flora scatter.
export function cellHash(wx, wz) {
  let h = (wx * 374761393 + wz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
