import { Noise } from '../noise.js';
import { SEA_LEVEL } from '../../config.js';

// Biome ids
export const Biome = {
  OCEAN: 0,
  PLAINS: 1,
  DESERT: 2,
  MOUNTAINS: 3,
  SNOWY: 4,
  JUNGLE: 5,
  SWAMP: 6,
};

// Per-biome generation parameters consumed by TerrainGen. Heights come from a
// single continuous heightfield (see TerrainGen) — biomes only pick surfaces.
export const BiomeParams = {
  [Biome.OCEAN]:     { base: SEA_LEVEL - 8, amp: 4,  surface: 'sand',  exponent: 1.0 },
  [Biome.PLAINS]:    { base: SEA_LEVEL + 4, amp: 8,  surface: 'grass', exponent: 1.0 },
  [Biome.DESERT]:    { base: SEA_LEVEL + 4, amp: 7,  surface: 'sand',  exponent: 1.0 },
  [Biome.MOUNTAINS]: { base: SEA_LEVEL + 8, amp: 30, surface: 'grass', exponent: 1.35 },
  [Biome.SNOWY]:     { base: SEA_LEVEL + 5, amp: 12, surface: 'snow',  exponent: 1.1 },
  [Biome.JUNGLE]:    { base: SEA_LEVEL + 6, amp: 10, surface: 'grass', exponent: 1.0 },
  [Biome.SWAMP]:     { base: SEA_LEVEL + 1, amp: 4,  surface: 'grass', exponent: 1.0 },
};

// Returns biome id for a world column from temperature + humidity climate maps.
// A little high-frequency jitter is added to both axes so biome borders wander
// and interlock organically instead of tracing smooth contour lines.
export function getBiome(worldX, worldZ) {
  const t = Noise.temperature(worldX, worldZ) + Noise.detail(worldX, worldZ, 0.02) * 0.07;
  const h = Noise.humidity(worldX, worldZ) + Noise.detail(worldZ + 31, worldX - 17, 0.02) * 0.07;

  // Cold
  if (t < -0.3) {
    return h > 0 ? Biome.SNOWY : Biome.MOUNTAINS;
  }
  // Temperate
  if (t < 0.35) {
    return h > 0 ? Biome.SWAMP : Biome.PLAINS;
  }
  // Hot: lush jungle when wet, desert when dry.
  return h > 0 ? Biome.JUNGLE : Biome.DESERT;
}
