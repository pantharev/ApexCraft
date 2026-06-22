import { CHUNK_SIZE, WORLD_HEIGHT } from '../../config.js';
import { mulberry32 } from '../noise.js';
import { getBlockId, isSolid } from '../../blocks/BlockRegistry.js';
import { Biome, getBiome } from '../biomes/BiomeMap.js';

const STONE = getBlockId('stone');
const AIR   = 0;

// Ore table: y range, vein size range, and attempts-per-chunk (rarity).
const ORES = [
  { name: 'coal_ore',     yMin: 4,  yMax: 120, sizeMin: 8, sizeMax: 16, tries: 14 },
  { name: 'iron_ore',     yMin: 4,  yMax: 64,  sizeMin: 4, sizeMax: 9,  tries: 10 },
  { name: 'gold_ore',     yMin: 4,  yMax: 32,  sizeMin: 2, sizeMax: 8,  tries: 3 },
  { name: 'redstone_ore', yMin: 4,  yMax: 16,  sizeMin: 4, sizeMax: 8,  tries: 5 },
  { name: 'lapis_ore',    yMin: 4,  yMax: 32,  sizeMin: 4, sizeMax: 8,  tries: 3 },
  { name: 'diamond_ore',  yMin: 4,  yMax: 16,  sizeMin: 1, sizeMax: 8,  tries: 2 },
  { name: 'emerald_ore',  yMin: 4,  yMax: 32,  sizeMin: 1, sizeMax: 1,  tries: 6, mountainsOnly: true },
];

// Count how many of the 6 face-neighbours of (x, y, z) are cave air
// (non-solid, non-liquid).  Used to bias vein seeds toward cavern walls.
function airNeighbours(chunk, x, y, z) {
  let count = 0;
  const dirs = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  for (const [dx, dy, dz] of dirs) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE) continue;
    if (ny < 0 || ny >= WORLD_HEIGHT) continue;
    const nb = chunk.get(nx, ny, nz);
    if (!isSolid(nb)) count++;
  }
  return count;
}

// Grow a small blob of ore from a seed point via a random walk, replacing stone.
function placeVein(chunk, oreId, sx, sy, sz, size, rand) {
  let x = sx, y = sy, z = sz;
  for (let i = 0; i < size; i++) {
    if (chunk.get(x, y, z) === STONE) {
      chunk.set(x, y, z, oreId);
    }
    x += Math.floor(rand() * 3) - 1;
    y += Math.floor(rand() * 3) - 1;
    z += Math.floor(rand() * 3) - 1;
    x = Math.max(0, Math.min(CHUNK_SIZE - 1, x));
    z = Math.max(0, Math.min(CHUNK_SIZE - 1, z));
  }
}

// Attempt to find a cavern-wall seed point: scan CANDIDATE_TRIES random
// positions at the same depth; prefer cells adjacent to cave air over solid-
// surrounded cells. Falls back to a random position if no wall is found, so
// ore generation is never skipped — strip-mining will still yield ore, just
// less efficiently than caving.
const CANDIDATE_TRIES = 6;

function pickWallSeed(chunk, rand, yMin, yMax) {
  let bestX = Math.floor(rand() * CHUNK_SIZE);
  let bestZ = Math.floor(rand() * CHUNK_SIZE);
  let bestY = yMin + Math.floor(rand() * (yMax - yMin));
  let bestAir = 0;

  for (let c = 0; c < CANDIDATE_TRIES; c++) {
    const cx = Math.floor(rand() * CHUNK_SIZE);
    const cz = Math.floor(rand() * CHUNK_SIZE);
    const cy = yMin + Math.floor(rand() * (yMax - yMin));
    if (chunk.get(cx, cy, cz) !== STONE) continue; // only seed in stone
    const air = airNeighbours(chunk, cx, cy, cz);
    if (air > bestAir) {
      bestAir = air; bestX = cx; bestY = cy; bestZ = cz;
    }
  }
  return [bestX, bestY, bestZ];
}

export function generateOres(chunk) {
  // Seed RNG from chunk coords so veins are deterministic per chunk.
  // NOTE: generateOres runs after carveCaves (see TerrainGen.js call order),
  // so the chunk already has carved air when we check airNeighbours.  This is
  // the required ordering for the cavern-wall bias to work correctly.
  const rand = mulberry32(((chunk.cx & 0xffff) << 16) ^ (chunk.cz & 0xffff) ^ 0x9e37);

  // Sample biome at chunk center for mountain-only ores.
  const centerBiome = getBiome(chunk.cx * CHUNK_SIZE + 8, chunk.cz * CHUNK_SIZE + 8);

  for (const ore of ORES) {
    if (ore.mountainsOnly && centerBiome !== Biome.MOUNTAINS) continue;
    const oreId = getBlockId(ore.name);
    for (let t = 0; t < ore.tries; t++) {
      if (rand() > 0.6) continue; // rarity jitter

      // Use the cavern-wall bias for underground ores (yMax <= 64).  High-y
      // ores like coal span up to y=120 where caves are rarer; for those we
      // keep the flat random seed so we don't starve their upper band.
      let sx, sy, sz;
      if (ore.yMax <= 64) {
        [sx, sy, sz] = pickWallSeed(chunk, rand, ore.yMin, ore.yMax);
      } else {
        sx = Math.floor(rand() * CHUNK_SIZE);
        sz = Math.floor(rand() * CHUNK_SIZE);
        sy = ore.yMin + Math.floor(rand() * (ore.yMax - ore.yMin));
      }

      const size = ore.sizeMin + Math.floor(rand() * (ore.sizeMax - ore.sizeMin + 1));
      placeVein(chunk, oreId, sx, sy, sz, size, rand);
    }
  }
}
