import { createNoise2D, createNoise3D } from 'simplex-noise';
import { WORLD_SEED } from '../config.js';

// Deterministic PRNG (mulberry32) so a seed produces a repeatable world.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise2D(seedOffset) {
  return createNoise2D(mulberry32(WORLD_SEED + seedOffset));
}
function makeNoise3D(seedOffset) {
  return createNoise3D(mulberry32(WORLD_SEED + seedOffset));
}

// Separate noise fields so terrain, climate and caves are independent.
const terrainNoise = makeNoise2D(0);
const tempNoise = makeNoise2D(101);
const humidNoise = makeNoise2D(202);
const detailNoise = makeNoise2D(303);
const caveNoise = makeNoise3D(404);
const oreNoise = makeNoise3D(505);

// Fractal Brownian motion: sums octaves of 2D noise for natural-looking terrain.
export function fbm2D(noise, x, z, octaves, freq, persistence = 0.5, lacunarity = 2) {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let f = freq;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * f, z * f);
    norm += amp;
    amp *= persistence;
    f *= lacunarity;
  }
  return sum / norm; // -1..1
}

export const Noise = {
  terrain: (x, z, octaves = 4, freq = 0.008) => fbm2D(terrainNoise, x, z, octaves, freq),
  temperature: (x, z) => fbm2D(tempNoise, x, z, 2, 0.0018),
  humidity: (x, z) => fbm2D(humidNoise, x, z, 2, 0.0021),
  detail: (x, z, freq = 0.05) => detailNoise(x * freq, z * freq),
  cave: (x, y, z) => caveNoise(x, y, z),
  ore: (x, y, z) => oreNoise(x, y, z),
};

export { mulberry32 as seededRandom };
