import { CHUNK_SIZE } from '../../config.js';
import { getBlockId } from '../../blocks/BlockRegistry.js';
import { columnHeight } from '../generators/Height.js';
import { villagesNear, villageLayout } from './VillagePlan.js';

const PLANKS = getBlockId('oak_planks');
const LOG = getBlockId('oak_log');
const COBBLE = getBlockId('cobblestone');
const GLASS = getBlockId('glass');
const GRAVEL = getBlockId('gravel');
const WATER = getBlockId('water');
const GRASS = getBlockId('grass');
const DIRT = getBlockId('dirt');
const SAND = getBlockId('sand');
const SNOW = getBlockId('snow');
const TABLE = getBlockId('crafting_table');
const CHEST = getBlockId('chest');
const DOOR_OPEN = getBlockId('door_open');
const BED = getBlockId('bed');
const BED_HEAD = getBlockId('bed_head');
const FENCE = getBlockId('fence');

// Surfaces a path is allowed to pave over.
const PAVEABLE = new Set([GRASS, DIRT, SAND, SNOW, GRAVEL]);

// Village emission. The plan (VillagePlan.js) is pure and deterministic, so
// every chunk computes the same layout and stamps only the cells that fall
// inside itself — houses and paths cross chunk borders seamlessly.
export function generateVillages(chunk) {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  // Max village footprint: house ring radius ~27 + house half-size ~4, plus
  // half a chunk to reach the chunk centre -> 48 covers everything.
  const villages = villagesNear(baseX + CHUNK_SIZE / 2, baseZ + CHUNK_SIZE / 2, 48);

  for (const v of villages) {
    const layout = villageLayout(v);
    emitWell(chunk, layout.well, baseX, baseZ);
    for (const h of layout.houses) {
      emitHouse(chunk, h, baseX, baseZ);
      emitPath(chunk, h, layout.well, baseX, baseZ);
    }
  }
}

// One house: cobble foundation down to the terrain, plank floor at terrain
// level, plank walls with log corners, a door gap facing the well, one glass
// window per wall, log-rimmed flat roof, optional furniture.
function emitHouse(chunk, h, baseX, baseZ) {
  const x0 = h.x - (h.w >> 1), z0 = h.z - (h.d >> 1);
  const x1 = x0 + h.w - 1, z1 = z0 + h.d - 1;
  const fy = h.floorY; // floor block level (replaces the surface block)

  // Door: centre column of the wall that faces the well.
  const doorX = h.facing === '+x' ? x1 : h.facing === '-x' ? x0 : h.x;
  const doorZ = h.facing === '+z' ? z1 : h.facing === '-z' ? z0 : h.z;

  // Furniture spots (interior corners, away from the door wall).
  const tableX = x0 + 1, tableZ = z0 + 1;
  const chestX = x1 - 1, chestZ = z1 - 1;

  const wxA = Math.max(x0, baseX), wxB = Math.min(x1, baseX + CHUNK_SIZE - 1);
  const wzA = Math.max(z0, baseZ), wzB = Math.min(z1, baseZ + CHUNK_SIZE - 1);

  for (let wx = wxA; wx <= wxB; wx++) {
    for (let wz = wzA; wz <= wzB; wz++) {
      const lx = wx - baseX, lz = wz - baseZ;
      const onX = wx === x0 || wx === x1;
      const onZ = wz === z0 || wz === z1;
      const perim = onX || onZ;
      const corner = onX && onZ;

      // Foundation: fill from the local terrain up to under the floor (covers
      // dips), and the floor slab itself.
      const ground = columnHeight(wx, wz);
      for (let y = Math.min(ground, fy - 1); y < fy; y++) chunk.set(lx, y, lz, COBBLE);
      chunk.set(lx, fy, lz, PLANKS);

      // Walls + interior air.
      for (let y = fy + 1; y <= fy + 3; y++) {
        let id = 0;
        if (perim) {
          id = corner ? LOG : PLANKS;
          // Doorway gets a real door, placed open so villagers can wander in.
          const isDoor = wx === doorX && wz === doorZ && y <= fy + 2;
          const isWindow = y === fy + 2 && !corner &&
            (onX ? wz === h.z : wx === h.x) && !(wx === doorX && wz === doorZ);
          if (isDoor) id = DOOR_OPEN;
          else if (isWindow) id = GLASS;
        }
        chunk.set(lx, y, lz, id);
      }

      // Roof: planks with a log rim, plus headroom cleared above so houses
      // cut into a rise aren't buried under leftover terrain.
      chunk.set(lx, fy + 4, lz, perim ? LOG : PLANKS);
      for (let y = fy + 5; y <= fy + 8; y++) chunk.set(lx, y, lz, 0);

      // Furniture on the floor inside (every home has a two-block bed by the
      // far wall: foot + pillowed head).
      if (!perim) {
        if (h.table && wx === tableX && wz === tableZ) chunk.set(lx, fy + 1, lz, TABLE);
        else if (h.chest && wx === chestX && wz === chestZ) chunk.set(lx, fy + 1, lz, CHEST);
        else if (wx === x0 + 1 && wz === z1 - 1) chunk.set(lx, fy + 1, lz, BED);
        else if (wx === x0 + 2 && wz === z1 - 1) chunk.set(lx, fy + 1, lz, BED_HEAD);
      }
    }
  }
}

// The central well: 5×5 cobble pad with a 3×3 water basin, corner posts and a
// plank canopy.
function emitWell(chunk, well, baseX, baseZ) {
  const y = well.y;
  for (let rx = -2; rx <= 2; rx++) {
    for (let rz = -2; rz <= 2; rz++) {
      const wx = well.x + rx, wz = well.z + rz;
      const lx = wx - baseX, lz = wz - baseZ;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
      const ring = Math.max(Math.abs(rx), Math.abs(rz)) === 2;
      const post = Math.abs(rx) === 2 && Math.abs(rz) === 2;

      // Foundation under the pad.
      const ground = columnHeight(wx, wz);
      for (let yy = Math.min(ground, y - 3); yy < y - 2; yy++) chunk.set(lx, yy, lz, COBBLE);

      if (ring) {
        chunk.set(lx, y - 2, lz, COBBLE);
        chunk.set(lx, y - 1, lz, COBBLE);
        chunk.set(lx, y, lz, COBBLE);                      // rim
        chunk.set(lx, y + 1, lz, post ? COBBLE : FENCE);   // fence closes the basin in
        chunk.set(lx, y + 2, lz, post ? COBBLE : 0);
      } else {
        // Basin: cobble bottom, two of water, open above.
        chunk.set(lx, y - 2, lz, COBBLE);
        chunk.set(lx, y - 1, lz, WATER);
        chunk.set(lx, y, lz, WATER);
        chunk.set(lx, y + 1, lz, 0);
        chunk.set(lx, y + 2, lz, 0);
      }
      chunk.set(lx, y + 3, lz, PLANKS); // canopy
      for (let yy = y + 4; yy <= y + 6; yy++) chunk.set(lx, yy, lz, 0); // sky above
    }
  }
}

// Gravel path from a house door to the well: step out of the door, walk the
// door's axis until aligned, then walk the other axis to the well pad. Only
// paves natural ground (never floors or water).
function emitPath(chunk, h, well, baseX, baseZ) {
  const dir = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] }[h.facing];
  let px = (h.facing === '+x' ? h.x + (h.w >> 1) : h.facing === '-x' ? h.x - (h.w >> 1) : h.x) + dir[0];
  let pz = (h.facing === '+z' ? h.z + (h.d >> 1) : h.facing === '-z' ? h.z - (h.d >> 1) : h.z) + dir[1];

  for (let step = 0; step < 64; step++) {
    if (Math.abs(px - well.x) <= 2 && Math.abs(pz - well.z) <= 2) break; // reached the pad
    pave(chunk, px, pz, baseX, baseZ);
    // Walk the door axis until aligned with the well, then turn.
    if (dir[0] !== 0 && px !== well.x) px += Math.sign(well.x - px);
    else if (dir[1] !== 0 && pz !== well.z) pz += Math.sign(well.z - pz);
    else if (px !== well.x) px += Math.sign(well.x - px);
    else if (pz !== well.z) pz += Math.sign(well.z - pz);
    else break;
  }
}

function pave(chunk, wx, wz, baseX, baseZ) {
  const lx = wx - baseX, lz = wz - baseZ;
  if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
  const y = columnHeight(wx, wz);
  if (PAVEABLE.has(chunk.get(lx, y, lz))) chunk.set(lx, y, lz, GRAVEL);
}
