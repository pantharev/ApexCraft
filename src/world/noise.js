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

// --- Generator versions --------------------------------------------------------
// Terrain is never saved: a world is its seed plus the player's edits, replayed
// onto whatever the generator makes. So once a world exists, what the
// generator makes for it must never change — or everything built there ends
// up buried or hanging in the air. Each change to the generator is therefore a
// new *version*, and a world keeps the version it was created with.
//
// The version travels in the seed: the top four bits of the (32-bit) seed.
// That way the seed alone still identifies a world — in a save, through the
// multiplayer relay, in a chunk worker — with nothing extra to store or send.
// Seeds made before versions existed are below 1e9, so their top bits are
// 0..3: those are all version 1. Version 2 uses 4, version 3 will use 5, …
//
// To change generation: add a version, branch on getGen() where the output
// differs, leave every older branch exactly as it is (core/chunkTest.js holds
// fingerprints that fail if one moves), and bump GEN_LATEST.
export const GEN_LATEST = 2;
export function genOf(seed) {
  const top = seed >>> 28;
  return top <= 3 ? 1 : top - 2;
}
// A fresh random seed for a new world, stamped with a generator version.
export function newSeed(gen = GEN_LATEST) {
  return (((gen + 2) << 28) | Math.floor(Math.random() * 0x10000000)) >>> 0;
}

// Separate noise fields so terrain, climate and caves are independent. They are
// (re)built by reseed() so each world can have its own seed.
let terrainNoise, tempNoise, humidNoise, detailNoise, caveNoise, oreNoise, forestNoise,
  continentNoise, riverNoise, mountainNoise, ridgeNoise, erosionNoise, warpXNoise, warpZNoise,
  caveBNoise, cavernNoise, riftNoise, riftMaskNoise,
  plateauNoise, jagNoise, overhangNoise; // generator version 2 and up

let currentSeed = WORLD_SEED;
let currentGen = genOf(WORLD_SEED);
// Where the world's origin sits in the noise fields. Simplex noise is exactly
// zero at its own origin, so with no offset every world has the same values at
// (0, 0) in every field — a river (the river field's zero line) across a
// temperate coast — and every spawn looks alike. Version 2 and up shift the
// whole world by an amount drawn from the seed; version 1 stays at zero.
let offX = 0, offZ = 0;
export const getSeed = () => currentSeed;
// The generator version of the current world (see above).
export const getGen = () => currentGen;

export function reseed(seed) {
  currentSeed = seed;
  currentGen = genOf(seed);
  if (currentGen >= 2) {
    const r = mulberry32((seed ^ 0x5bd1e995) >>> 0);
    offX = Math.floor((r() - 0.5) * 200000);
    offZ = Math.floor((r() - 0.5) * 200000);
  } else {
    offX = offZ = 0;
  }
  terrainNoise = createNoise2D(mulberry32(seed + 0));
  tempNoise = createNoise2D(mulberry32(seed + 101));
  humidNoise = createNoise2D(mulberry32(seed + 202));
  detailNoise = createNoise2D(mulberry32(seed + 303));
  caveNoise = createNoise3D(mulberry32(seed + 404));
  oreNoise = createNoise3D(mulberry32(seed + 505));
  forestNoise = createNoise2D(mulberry32(seed + 606));
  continentNoise = createNoise2D(mulberry32(seed + 707));
  riverNoise = createNoise2D(mulberry32(seed + 808));
  mountainNoise = createNoise2D(mulberry32(seed + 909));   // where ranges rise
  ridgeNoise = createNoise2D(mulberry32(seed + 1010));     // ridge/valley detail
  erosionNoise = createNoise2D(mulberry32(seed + 1111));   // flat <-> rugged
  warpXNoise = createNoise2D(mulberry32(seed + 1212));     // domain warp offsets
  warpZNoise = createNoise2D(mulberry32(seed + 1313));
  caveBNoise = createNoise3D(mulberry32(seed + 1414));     // second tunnel field
  cavernNoise = createNoise3D(mulberry32(seed + 1515));    // big deep rooms
  riftNoise = createNoise2D(mulberry32(seed + 1616));      // ravine centre lines
  riftMaskNoise = createNoise2D(mulberry32(seed + 1717));  // where ravines occur
  plateauNoise = createNoise2D(mulberry32(seed + 1818));   // where highlands step up into benches
  jagNoise = createNoise2D(mulberry32(seed + 1919));       // sharp detail on mountain crests
  overhangNoise = createNoise3D(mulberry32(seed + 2020));  // cliffs: ledges and overhangs
}

reseed(WORLD_SEED); // default world until a save selects its own seed

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

// Ridged fBm: folds each octave (1 - |n|) so crests form connected ridge lines
// instead of round blobs — the classic mountain-range shape. Returns 0..1.
export function ridged2D(noise, x, z, octaves, freq, persistence = 0.5, lacunarity = 2) {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let f = freq;
  let weight = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise(x * f, z * f)); // 0..1, sharp crest at 1
    n *= n;            // sharpen
    n *= weight;       // damp octaves in the valleys so detail lives on crests
    weight = Math.max(0, Math.min(1, n * 2));
    sum += n * amp;
    norm += amp;
    amp *= persistence;
    f *= lacunarity;
  }
  return sum / norm; // 0..1
}

export const Noise = {
  terrain: (x, z, octaves = 4, freq = 0.008) => fbm2D(terrainNoise, x + offX, z + offZ, octaves, freq),
  temperature: (x, z) => fbm2D(tempNoise, x + offX, z + offZ, 2, 0.0018),
  humidity: (x, z) => fbm2D(humidNoise, x + offX, z + offZ, 2, 0.0021),
  detail: (x, z, freq = 0.05) => detailNoise((x + offX) * freq, (z + offZ) * freq),
  cave: (x, y, z) => caveNoise(x + offX, y, z + offZ),
  ore: (x, y, z) => oreNoise(x + offX, y, z + offZ),
  // Low-frequency field for forest clumping: high = dense woods, low = open plains.
  forest: (x, z) => fbm2D(forestNoise, x + offX, z + offZ, 2, 0.011),
  // Very low frequency continental shaping: negative = ocean basin, positive = highland.
  continent: (x, z) => fbm2D(continentNoise, x + offX, z + offZ, 3, 0.0009),
  // River field; |value| near 0 traces winding river channels.
  river: (x, z) => fbm2D(riverNoise, x + offX, z + offZ, 2, 0.0035),
  // Mountain-range mask field (where ranges rise), -1..1.
  mountain: (x, z) => fbm2D(mountainNoise, x + offX, z + offZ, 2, 0.0013),
  // Ridge detail for mountain tops, 0..1 with connected crest lines.
  ridge: (x, z) => ridged2D(ridgeNoise, x + offX, z + offZ, 3, 0.009),
  // Erosion: low = flat/smooth lowlands, high = rugged relief. -1..1.
  erosion: (x, z) => fbm2D(erosionNoise, x + offX, z + offZ, 2, 0.0016),
  // Domain warp offsets (in blocks) — feed warped coords into other fields for
  // organic, swirling coastlines and ranges instead of round simplex blobs.
  warpX: (x, z) => fbm2D(warpXNoise, x + offX, z + offZ, 2, 0.0035),
  warpZ: (x, z) => fbm2D(warpZNoise, x + offX, z + offZ, 2, 0.0035),
  // Second tunnel field: caves form where |cave| and |caveB| are BOTH small.
  caveB: (x, y, z) => caveBNoise(x + offX, y, z + offZ),
  // Low-frequency room field for big caverns at depth.
  cavern: (x, y, z) => cavernNoise(x + offX, y, z + offZ),
  // Ravines: |rift| near 0 traces a canyon centre line...
  rift: (x, z) => fbm2D(riftNoise, x + offX, z + offZ, 2, 0.004),
  // ...but only inside rare regions where the mask runs high.
  riftMask: (x, z) => fbm2D(riftMaskNoise, x + offX, z + offZ, 2, 0.0011),
  // Version 2 terrain: plateau country mask, crest detail (0..1, ridged), and
  // a 3D field that breaks steep ground into ledges and overhangs.
  plateau: (x, z) => fbm2D(plateauNoise, x + offX, z + offZ, 2, 0.0017),
  jag: (x, z) => ridged2D(jagNoise, x + offX, z + offZ, 2, 0.031),
  overhang: (x, y, z) => overhangNoise(x + offX, y, z + offZ),
};

export { mulberry32 as seededRandom };
