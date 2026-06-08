import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from '../../config.js';
import { Chunk } from '../../core/Chunk.js';
import { Noise } from '../noise.js';
import { getBiome, BiomeParams } from '../biomes/BiomeMap.js';
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

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// A continuous heightfield — deliberately NOT keyed to the discrete biome, so
// there are no cliffs at biome borders (which made mountains look like walls).
//   • continental field  -> ocean basins vs. land
//   • gentle fBm          -> rolling hills everywhere
//   • smooth mountain mask (colder regions) × ridged noise -> rounded highlands
//     that fade in/out gradually rather than jumping up at a seam
function columnHeight(worldX, worldZ) {
  const cont = Noise.continent(worldX, worldZ);   // -1..1, very low frequency
  let h = SEA_LEVEL + 6 + cont * 20;              // oceans <-> highlands (land-biased)

  h += Noise.terrain(worldX, worldZ) * 8;         // rolling hills

  // Mountains rise in cold regions and taper off smoothly at the edges; ridged
  // noise gives ridgelines instead of flat walls.
  const mtn = smoothstep(-0.15, -0.55, Noise.temperature(worldX, worldZ));
  if (mtn > 0) {
    const ridge = 1 - Math.abs(Noise.detail(worldX, worldZ, 0.013)); // 0..1
    h += mtn * (0.35 + 0.65 * ridge) * 34;
  }

  // Rivers: carve winding channels down to just below sea level, on land only.
  if (h > SEA_LEVEL) {
    const river = Math.abs(Noise.river(worldX, worldZ));
    if (river < 0.045) {
      const depth = (0.045 - river) / 0.045;
      h = Math.max(SEA_LEVEL - 2, h - (2 + depth * 5));
    }
  }

  return Math.max(2, Math.min(WORLD_HEIGHT - 6, Math.floor(h)));
}

export function generateChunk(chunk) {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = baseX + x;
      const wz = baseZ + z;
      const biome = getBiome(wx, wz);
      const height = columnHeight(wx, wz);

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
          // Surface block: sand at shorelines, snowcaps on high peaks (by
          // altitude, not biome), otherwise the biome's surface.
          if (sandy) id = SAND;
          else if (y > 98) id = SNOW;
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
