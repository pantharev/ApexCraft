import { Noise, getGen } from '../noise.js';
import { landform } from '../generators/Height2.js';
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

const scratch = { h: 0, mtn: 0, plat: 0, rug: 0, temp: 0, humid: 0 };

// The biome of a world column, for the current world's generator version
// (see noise.js).
export function getBiome(worldX, worldZ) {
  return getGen() >= 2
    ? biomeV2(worldX, worldZ, landform(worldX, worldZ, scratch))
    : biomeV1(worldX, worldZ);
}

// Generator version 2: climate, as before, but the land has a say. Water is
// ocean, high ground and the ranges are mountains whatever the climate, it
// gets colder with altitude, and a swamp has to be low enough to be wet.
// `form` is the column's Height2.landform().
export function biomeV2(worldX, worldZ, form) {
  if (form.h < SEA_LEVEL - 1) return Biome.OCEAN;
  if (form.mtn > 0.45 || form.h > 92) return Biome.MOUNTAINS;
  // The same jitter as version 1, so biome borders wander and interlock.
  const t = form.temp + Noise.detail(worldX, worldZ, 0.02) * 0.07 - Math.max(0, form.h - 72) * 0.012;
  const h = form.humid + Noise.detail(worldZ + 31, worldX - 17, 0.02) * 0.07;
  if (t < -0.4) return Biome.SNOWY;
  if (t >= 0.3) return h > 0 ? Biome.JUNGLE : Biome.DESERT;
  return h > 0.05 && form.h <= SEA_LEVEL + 4 ? Biome.SWAMP : Biome.PLAINS;
}

// Generator version 1 (frozen): biome id for a world column from temperature +
// humidity climate maps. A little high-frequency jitter is added to both axes
// so biome borders wander and interlock organically instead of tracing smooth
// contour lines.
function biomeV1(worldX, worldZ) {
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
