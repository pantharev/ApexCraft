import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from '../../config.js';
import { Noise } from '../noise.js';
import { getBiome, BiomeParams } from '../biomes/BiomeMap.js';
import { getBlockId } from '../../blocks/BlockRegistry.js';
import { columnHeight } from './Height.js';
import { carveCaves } from './CaveGen.js';
import { generateOres } from './OreGen.js';
import { generateTrees } from '../structures/Tree.js';
import { generateVillages } from '../structures/Villages.js';
import { generateDecorations } from '../structures/Decorations.js';
import { generateArena, activeMap, FLOOR_Y } from '../arenas/index.js';

const STONE = getBlockId('stone');
const DIRT = getBlockId('dirt');
const SAND = getBlockId('sand');
const SANDSTONE = getBlockId('sandstone');
const GRAVEL = getBlockId('gravel');
const SNOW = getBlockId('snow');
const CLAY = getBlockId('clay');
const WATER = getBlockId('water');
const BEDROCK = getBlockId('bedrock');
const ANDESITE = getBlockId('andesite');
const GRASS = getBlockId('grass');

// Generation mode, set once before a Game's chunks generate (see Game ctor).
// 'hideseek' swaps the procedural terrain for a flat Prop Hunt arena.
let GEN_MODE = null;
export function setGenMode(m) { GEN_MODE = m || null; }

// The heightfield itself lives in Height.js so structures (villages) can
// query terrain shape without importing the whole generator.

export function generateChunk(chunk) {
  if (GEN_MODE === 'hideseek') { generateArenaChunk(chunk); return; }
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = baseX + x;
      const wz = baseZ + z;
      const biome = getBiome(wx, wz);
      const height = columnHeight(wx, wz);

      // Jitter altitude bands a little so snowlines/rock lines wander
      // organically instead of tracing dead-flat contour lines.
      const dith = Noise.detail(wx, wz, 0.07) * 3;
      const submerged = height < SEA_LEVEL;   // ocean / lake / river bed
      const beach = height <= SEA_LEVEL + 1;  // shoreline sand band
      const sandy = submerged || beach || BiomeParams[biome].surface === 'sand';
      const rocky = height > 88 + dith;       // bare stone above the treeline
      const snowy = height > 97 + dith;       // snowcaps on the peaks
      const dirtDepth = 3 + Math.floor(((Noise.detail(wx, wz, 0.03) + 1) / 2) * 3); // 3..5

      for (let y = 0; y < WORLD_HEIGHT; y++) {
        let id = 0;
        if (y === 0) {
          id = BEDROCK;
        } else if (y < height - dirtDepth) {
          id = y > 105 + dith ? ANDESITE : STONE;
        } else if (y < height) {
          // Sub-surface: sand (then sandstone deeper) under beaches/deserts,
          // stone under bare peaks, dirt elsewhere.
          id = sandy ? (y < height - 2 ? SANDSTONE : SAND) : rocky ? STONE : DIRT;
        } else if (y === height) {
          if (snowy) id = SNOW;
          else if (rocky) id = Noise.detail(wx, wz, 0.11) > 0.45 ? GRAVEL : STONE;
          else if (submerged) {
            // Varied sea/river floor: sand banks, gravel runs, clay pockets.
            const f = Noise.detail(wx, wz, 0.045);
            id = f > 0.55 ? CLAY : f < -0.4 ? GRAVEL : SAND;
          } else if (sandy) id = SAND;
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
  generateVillages(chunk); // before trees so trees skip village ground
  generateTrees(chunk);
  generateDecorations(chunk);
  chunk.generated = true;
  chunk.dirty = true;
}

// Flat Prop Hunt base: bedrock floor, stone fill, the map's surface block at
// FLOOR_Y, air above — no caves/ores/villages/trees. The arena map is stamped
// on top.
function generateArenaChunk(chunk) {
  const surface = getBlockId(activeMap().baseSurface) || GRASS;
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let y = 0; y <= FLOOR_Y; y++) {
        chunk.set(x, y, z, y === 0 ? BEDROCK : y === FLOOR_Y ? surface : STONE);
      }
    }
  }
  generateArena(chunk);
  chunk.generated = true;
  chunk.dirty = true;
}
