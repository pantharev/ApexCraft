import { CHUNK_SIZE } from '../../config.js';
import { mulberry32 } from '../noise.js';
import { getBlockId } from '../../blocks/BlockRegistry.js';
import { Biome, getBiome } from '../biomes/BiomeMap.js';

const STONE = getBlockId('stone');

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

export function generateOres(chunk) {
  // Seed RNG from chunk coords so veins are deterministic per chunk.
  const rand = mulberry32(((chunk.cx & 0xffff) << 16) ^ (chunk.cz & 0xffff) ^ 0x9e37);

  // Sample biome at chunk center for mountain-only ores.
  const centerBiome = getBiome(chunk.cx * CHUNK_SIZE + 8, chunk.cz * CHUNK_SIZE + 8);

  for (const ore of ORES) {
    if (ore.mountainsOnly && centerBiome !== Biome.MOUNTAINS) continue;
    const oreId = getBlockId(ore.name);
    for (let t = 0; t < ore.tries; t++) {
      if (rand() > 0.6) continue; // rarity jitter
      const sx = Math.floor(rand() * CHUNK_SIZE);
      const sz = Math.floor(rand() * CHUNK_SIZE);
      const sy = ore.yMin + Math.floor(rand() * (ore.yMax - ore.yMin));
      const size = ore.sizeMin + Math.floor(rand() * (ore.sizeMax - ore.sizeMin + 1));
      placeVein(chunk, oreId, sx, sy, sz, size, rand);
    }
  }
}
