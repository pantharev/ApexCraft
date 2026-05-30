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

// Per-biome generation parameters consumed by TerrainGen.
export const BiomeParams = {
  [Biome.OCEAN]:     { base: SEA_LEVEL - 8, amp: 4,  surface: 'sand',  exponent: 1.0 },
  [Biome.PLAINS]:    { base: SEA_LEVEL + 4, amp: 8,  surface: 'grass', exponent: 1.0 },
  [Biome.DESERT]:    { base: SEA_LEVEL + 4, amp: 7,  surface: 'sand',  exponent: 1.0 },
  [Biome.MOUNTAINS]: { base: SEA_LEVEL + 10, amp: 55, surface: 'grass', exponent: 1.8 },
  [Biome.SNOWY]:     { base: SEA_LEVEL + 5, amp: 12, surface: 'snow',  exponent: 1.1 },
  [Biome.JUNGLE]:    { base: SEA_LEVEL + 6, amp: 10, surface: 'grass', exponent: 1.0 },
  [Biome.SWAMP]:     { base: SEA_LEVEL + 1, amp: 4,  surface: 'grass', exponent: 1.0 },
};

// Returns biome id for a world column from temperature + humidity climate maps.
// The terrain height check for ocean happens in TerrainGen (below sea level).
export function getBiome(worldX, worldZ) {
  const t = Noise.temperature(worldX, worldZ); // -1..1
  const h = Noise.humidity(worldX, worldZ); // -1..1

  // Cold
  if (t < -0.3) {
    return h > 0 ? Biome.SNOWY : Biome.MOUNTAINS;
  }
  // Warm
  if (t < 0.35) {
    return h > 0 ? Biome.JUNGLE : Biome.PLAINS;
  }
  // Hot
  return h > 0 ? Biome.SWAMP : Biome.DESERT;
}
