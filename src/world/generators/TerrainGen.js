import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from '../../config.js';
import { Chunk } from '../../core/Chunk.js';
import { Noise } from '../noise.js';
import { getBiome, Biome, BiomeParams } from '../biomes/BiomeMap.js';
import { getBlockId } from '../../blocks/BlockRegistry.js';
import { carveCaves } from './CaveGen.js';
import { generateOres } from './OreGen.js';

const STONE = getBlockId('stone');
const DIRT = getBlockId('dirt');
const GRASS = getBlockId('grass');
const SAND = getBlockId('sand');
const SNOW = getBlockId('snow');
const WATER = getBlockId('water');
const BEDROCK = getBlockId('bedrock');
const ANDESITE = getBlockId('andesite');

// Smooth height: sample biome params per column and shape with the biome's exponent.
function columnHeight(worldX, worldZ, biome) {
  const p = BiomeParams[biome];
  let n = (Noise.terrain(worldX, worldZ) + 1) / 2; // 0..1
  n = Math.pow(n, p.exponent);
  return Math.floor(p.base + n * p.amp);
}

export function generateChunk(chunk) {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = baseX + x;
      const wz = baseZ + z;
      let biome = getBiome(wx, wz);
      let height = columnHeight(wx, wz, biome);

      // Columns that fall below sea level become ocean floor.
      if (height < SEA_LEVEL - 1 && biome !== Biome.MOUNTAINS) {
        biome = Biome.OCEAN;
        height = Math.min(height, SEA_LEVEL - 2);
      }

      const surfaceName = BiomeParams[biome].surface;
      const surfaceId = getBlockId(surfaceName);

      for (let y = 0; y < WORLD_HEIGHT; y++) {
        let id = 0;
        if (y === 0) {
          id = BEDROCK;
        } else if (y < height - 4) {
          id = y > 110 ? ANDESITE : STONE;
        } else if (y < height) {
          // sub-surface layer
          id = surfaceName === 'sand' ? SAND : DIRT;
        } else if (y === height) {
          // surface block
          if (biome === Biome.MOUNTAINS && y > 90) id = SNOW;
          else if (biome === Biome.OCEAN) id = SAND;
          else id = surfaceId;
        }
        // Fill water from floor up to sea level.
        if (id === 0 && y <= SEA_LEVEL && y > height) {
          id = WATER;
        }
        chunk.set(x, y, z, id);
      }
    }
  }

  carveCaves(chunk);
  generateOres(chunk);
  chunk.generated = true;
  chunk.dirty = true;
}
