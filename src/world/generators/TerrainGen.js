import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from '../../config.js';
import { Chunk } from '../../core/Chunk.js';
import { Noise } from '../noise.js';
import { getBiome, Biome, BiomeParams } from '../biomes/BiomeMap.js';
import { getBlockId } from '../../blocks/BlockRegistry.js';
import { carveCaves } from './CaveGen.js';
import { generateOres } from './OreGen.js';
import { generateTrees } from '../structures/Tree.js';

const STONE = getBlockId('stone');
const DIRT = getBlockId('dirt');
const GRASS = getBlockId('grass');
const SAND = getBlockId('sand');
const SNOW = getBlockId('snow');
const WATER = getBlockId('water');
const BEDROCK = getBlockId('bedrock');
const ANDESITE = getBlockId('andesite');

// Final surface height for a column, combining the biome shape with a low
// frequency continental field (ocean basins vs highlands) and river carving.
function columnHeight(worldX, worldZ, biome) {
  const p = BiomeParams[biome];
  let n = (Noise.terrain(worldX, worldZ) + 1) / 2; // 0..1
  n = Math.pow(n, p.exponent);
  let h = p.base + n * p.amp;

  // Continental shaping: large negative regions sink below sea level (oceans),
  // positive regions rise into highlands.
  h += Noise.continent(worldX, worldZ) * 22;

  // Rivers: where the river field is near zero, carve a winding channel down to
  // just below sea level — but only on land (leave the open ocean alone).
  if (h > SEA_LEVEL) {
    const river = Math.abs(Noise.river(worldX, worldZ));
    if (river < 0.045) {
      const depth = (0.045 - river) / 0.045; // 1 at the centre line
      h = Math.max(SEA_LEVEL - 2, h - (2 + depth * 5));
    }
  }

  h = Math.max(2, Math.min(WORLD_HEIGHT - 6, h));
  return Math.floor(h);
}

export function generateChunk(chunk) {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = baseX + x;
      const wz = baseZ + z;
      const biome = getBiome(wx, wz);
      const height = columnHeight(wx, wz, biome);

      const submerged = height < SEA_LEVEL;   // ocean / lake / river bed
      const beach = height <= SEA_LEVEL + 1;  // shoreline sand band
      const sandy = submerged || beach || BiomeParams[biome].surface === 'sand';

      for (let y = 0; y < WORLD_HEIGHT; y++) {
        let id = 0;
        if (y === 0) {
          id = BEDROCK;
        } else if (y < height - 4) {
          id = y > 110 ? ANDESITE : STONE;
        } else if (y < height) {
          id = sandy ? SAND : DIRT; // sub-surface
        } else if (y === height) {
          // Surface block: sand underwater/at shorelines, snow on high peaks.
          if (sandy) id = SAND;
          else if (biome === Biome.MOUNTAINS && y > 90) id = SNOW;
          else id = getBlockId(BiomeParams[biome].surface);
        }
        // Fill water from the bed up to sea level (oceans, lakes, rivers).
        if (id === 0 && y <= SEA_LEVEL && y > height) id = WATER;
        chunk.set(x, y, z, id);
      }
    }
  }

  carveCaves(chunk);
  generateOres(chunk);
  generateTrees(chunk);
  chunk.generated = true;
  chunk.dirty = true;
}
