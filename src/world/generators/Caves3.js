import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from '../../config.js';
import { Noise, getSeed } from '../noise.js';
import { getBlockId, isSolid } from '../../blocks/BlockRegistry.js';
import { landmarkPossible, LANDMARK_FREQ_XZ, LANDMARK_FREQ_Y, LANDMARK_THRESH } from './CaveGen.js';

// Generator version 3: the underground. (Versions 1 and 2 keep CaveGen.js,
// block for block — see the version notes in noise.js.)
//
// What is cut:
//   • Tunnels — where two 3D fields are both near zero, which is a winding
//     tube. A third, slow field sets how wide the tube runs, so one tunnel
//     pinches to a crawl and opens into a gallery; a fourth leaves whole
//     regions of rock uncut, so the underground is not riddled evenly.
//   • Noodles — a finer, tighter network of the same kind, in patches.
//   • Caverns — big rooms from a low-frequency field with a finer one on top
//     (so the walls are not smooth blobs), commoner with depth, with columns of
//     rock left standing in them.
//   • Landmark caverns and rifts, as before.
//
// Where it reaches the surface: only inside "gate" regions. Elsewhere a few
// blocks of ground are left over every cave, so the land is not pocked with
// holes, and the ways in are places you find.
//
// What fills it: everything cut at or below LAVA_LEVEL is lava — one level
// everywhere, so the deep caves end in flat lava lakes. Inside "lake" regions
// everything cut at or below LAKE_LEVEL is water instead, and a wall of rock is
// left around each region (the band where the lake field is between its two
// thresholds) to hold it in. Both are placed as the rock is cut, cell by cell
// from global coordinates, so they are level across chunk borders and nothing
// is left hanging.
//
// What grows there (decorate): by a slow 2D field, a cave is lush — moss on
// the floor and ceiling, grass and glow mushrooms, vines with glowing berries
// hanging down — or dripstone — stalagmites and stalactites, joining into
// pillars where they meet — or bare, with the odd cluster of glow mushrooms.
// And below it all the stone turns to deepslate (deepen, run after the ores).

const WATER = getBlockId('water');
const LAVA = getBlockId('lava');
const STONE = getBlockId('stone');
const DIRT = getBlockId('dirt');
const ANDESITE = getBlockId('andesite');
const GRAVEL = getBlockId('gravel');
const DEEPSLATE = getBlockId('deepslate');
const MOSS = getBlockId('moss');
const DRIPSTONE = getBlockId('dripstone');
const CAVE_VINE = getBlockId('cave_vine');
const GLOW_MUSHROOM = getBlockId('glow_mushroom');
const TALL_GRASS = getBlockId('tall_grass');

export const LAVA_LEVEL = 10;  // every cave at or below this is full of lava
export const LAKE_LEVEL = 24;  // the surface of every underground lake
const LAKE_IN = 0.44;          // lake field above this: a lake region
const LAKE_OUT = 0.32;         // ...between the two: the rock that holds it in
const DEEP_Y = 15;             // about where stone gives way to deepslate

const TF = 0.017, TY = 0.028;  // tunnel field frequencies (as in version 1)

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// A repeatable 0..1 for a cell of the world.
function hash3(x, y, z, salt) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1) ^ salt;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// --- Slow fields on a lattice ---------------------------------------------------
// The fields that only steer the carving change little over a few blocks, so
// they are sampled every STEP blocks and interpolated: a few hundred samples
// a chunk in place of tens of thousands. Lattice points sit on multiples of
// STEP in world coordinates and a chunk is a whole number of steps wide, so
// neighbouring chunks share the points on their common face and the result is
// continuous across it.
const STEP = 4;
const NX = CHUNK_SIZE / STEP + 1;          // points along x and z
const NY = WORLD_HEIGHT / STEP + 1;        // ...and up
const FIELDS = [
  // 0: where the rock is riddled with tunnels and where it is whole
  (x, y, z) => Noise.caveMod(x * 0.0045 + 300, y * 0.007, z * 0.0045 + 300),
  // 1: how wide a tunnel runs here
  (x, y, z) => Noise.caveMod(x * 0.012, y * 0.018, z * 0.012),
  // 2: the big rooms
  (x, y, z) => Noise.cavern(x * 0.011, y * 0.02, z * 0.011),
  // 3: where the noodle network is
  (x, y, z) => Noise.caveMod(x * 0.009 + 700, y * 0.012, z * 0.009 + 700),
];
const lattice = FIELDS.map(() => new Float32Array(NX * NX * NY));

function fillLattice(baseX, baseZ, levels) {
  for (let f = 0; f < FIELDS.length; f++) {
    const fn = FIELDS[f], out = lattice[f];
    for (let j = 0; j < levels; j++) {
      for (let k = 0; k < NX; k++) {
        for (let i = 0; i < NX; i++) {
          out[(j * NX + k) * NX + i] = fn(baseX + i * STEP, j * STEP, baseZ + k * STEP);
        }
      }
    }
  }
}

// Trilinear read of field `f` at a cell of the chunk.
function slow(f, x, y, z) {
  const a = lattice[f];
  const i = (x / STEP) | 0, j = (y / STEP) | 0, k = (z / STEP) | 0;
  const tx = x / STEP - i, ty = y / STEP - j, tz = z / STEP - k;
  const p = (j * NX + k) * NX + i, q = p + NX * NX;
  const p0 = a[p] + (a[p + 1] - a[p]) * tx;
  const p1 = a[p + NX] + (a[p + NX + 1] - a[p + NX]) * tx;
  const q0 = a[q] + (a[q + 1] - a[q]) * tx;
  const q1 = a[q + NX] + (a[q + NX + 1] - a[q + NX]) * tx;
  const lo = p0 + (p1 - p0) * tz;
  return lo + (q0 + (q1 - q0) * tz - lo) * ty;
}

// Is the rock at this cell cut away? `s` (0..1) closes caves off as they near
// a surface they may not break through; `landmark` is the chunk-level "a
// landmark cavern is possible here".
function cut(x, y, z, wx, wz, s, landmark) {
  // Tunnels.
  const region = smoothstep(-0.45, -0.1, slow(0, x, y, z));
  if (region > 0) {
    const wide = smoothstep(-0.5, 0.6, slow(1, x, y, z));
    const r = (0.085 + 0.1 * wide + Math.max(0, 40 - y) * 0.0006) * s * region;
    const t1 = Noise.cave(wx * TF, y * TY, wz * TF);
    if (Math.abs(t1) < r) {
      const t2 = Noise.caveB(wx * TF + 50, y * TY, wz * TF + 50);
      if (t1 * t1 + t2 * t2 < r * r) return true; // a round tube, not a square one
    }
  }

  // Caverns: commoner and larger with depth, never just under the surface.
  if (y < 54) {
    const need = 0.63 + Math.max(0, y - 26) * 0.011 + (1 - s) * 0.5;
    const base = slow(2, x, y, z);
    if (base > need - 0.3) {
      const c = base + 0.3 * Noise.cavern(wx * 0.034 + 70, y * 0.05, wz * 0.034 + 70);
      if (c > need) {
        // Columns of rock left standing: a field that hardly changes with
        // height, so what it leaves is upright.
        if (Noise.caveMod(wx * 0.085 + 40, y * 0.012, wz * 0.085 + 40) < 0.58) return true;
      }
    }
  }

  // Noodles.
  const patch = slow(3, x, y, z);
  if (patch > 0.2) {
    const r = 0.105 * s * smoothstep(0.2, 0.4, patch);
    const n1 = Noise.caveC(wx * 0.04, y * 0.03, wz * 0.04);
    if (Math.abs(n1) < r) {
      const n2 = Noise.caveD(wx * 0.04, y * 0.03, wz * 0.04);
      if (n1 * n1 + n2 * n2 < r * r) return true;
    }
  }

  // Landmark caverns: very rare, very large.
  if (landmark && y >= 8 && y < 56) {
    const lv = Noise.cavern(wx * LANDMARK_FREQ_XZ + 200, y * LANDMARK_FREQ_Y + 200, wz * LANDMARK_FREQ_XZ + 200);
    if (lv > LANDMARK_THRESH + (1 - s) * 0.3) return true;
  }
  return false;
}

const surface = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);

export function carveCaves3(chunk) {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const landmark = landmarkPossible(baseX, baseZ);
  const shore = chunk.shore || null; // from Terrain2: where a cut would open onto a lake or the sea

  // The ground's surface in each column (topmost block that is not air or
  // water), and how far up the slow fields are needed.
  let highest = 0;
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      let surf = 0;
      for (let y = WORLD_HEIGHT - 1; y > 0; y--) {
        const id = chunk.get(x, y, z);
        if (id !== 0 && id !== WATER) { surf = y; break; }
      }
      surface[z * CHUNK_SIZE + x] = surf;
      if (surf > highest) highest = surf;
    }
  }
  fillLattice(baseX, baseZ, Math.min(NY, Math.ceil((highest + 3) / STEP) + 2));

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = baseX + x;
      const wz = baseZ + z;
      const surf = surface[z * CHUNK_SIZE + x];
      if (surf <= 4) continue;
      const underSea = surf <= SEA_LEVEL + 1;

      // Rift band for this column, as in version 1.
      let riftBot = -1, riftTop = -1;
      if (!underSea) {
        const mask = smoothstep(0.1, 0.5, Noise.riftMask(wx, wz));
        if (mask > 0.02) {
          const rv = Math.abs(Noise.rift(wx, wz));
          const w = 0.06 * mask;
          if (rv < w) {
            const t = 1 - rv / w;
            riftTop = surf + 2;
            riftBot = Math.max(6, Math.floor(surf - (14 + 26 * t * mask)));
          }
        }
      }

      // Under water a few blocks of bed are always left, so the sea does not
      // drain; on land the ground left over a cave (`lid`) goes to nothing
      // inside a gate region, which is where the entrances are.
      const carveTop = underSea ? surf - 4 : surf;
      const lid = underSea ? 0 : 5 * smoothstep(0.3, 0.12, Noise.caveGate(wx, wz));
      const shoreY = shore ? shore[z * CHUNK_SIZE + x] : WORLD_HEIGHT;

      const lakeField = Noise.cavern(wx * 0.011 + 500, 0, wz * 0.011 + 500);
      const lake = lakeField > LAKE_IN;
      const dam = !lake && lakeField > LAKE_OUT;

      const top = Math.min(Math.max(carveTop, riftTop), WORLD_HEIGHT - 2);
      for (let y = 3; y <= top; y++) {
        if (y >= shoreY && y <= SEA_LEVEL) continue; // open water next door at this height
        if (dam && y <= LAKE_LEVEL + 1) continue;    // the wall that holds a lake in
        const fill = lake && y <= LAKE_LEVEL ? WATER : y <= LAVA_LEVEL ? LAVA : 0;

        if (riftTop >= 0 && y >= riftBot && y <= riftTop) {
          if (chunk.get(x, y, z) !== WATER) chunk.set(x, y, z, fill);
          continue;
        }
        if (y > carveTop) continue;
        const cur = chunk.get(x, y, z);
        if (cur === 0 || cur === WATER || !isSolid(cur)) continue;

        const d = carveTop - y;
        const s = clamp01((d - lid) / 4 + (1 - lid / 5));
        if (s <= 0) continue;
        if (cut(x, y, z, wx, wz, s, landmark)) chunk.set(x, y, z, fill);
      }
    }
  }

  decorate(chunk);
}

// --- What grows in the caves ---------------------------------------------------

const SOIL = new Set([STONE, ANDESITE, DIRT, GRAVEL]); // what moss and dripstone can take over

function decorate(chunk) {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const salt = getSeed() | 0;
  if (!chunk.lights) chunk.lights = [];

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = baseX + x;
      const wz = baseZ + z;

      // The ground as it is now (a rift may have opened the column to the
      // sky): only what has a roof over it is a cave.
      let top = WORLD_HEIGHT - 1;
      while (top > 0) {
        const id = chunk.get(x, top, z);
        if (id !== 0 && id !== WATER) break;
        top--;
      }
      // Lava lights its cave: a source over the open surface of a lava lake,
      // one every few blocks (the fourth entry marks it as lava — TorchLights
      // gives these whatever warm lights the player's torches leave free).
      if (wx % 6 === 0 && wz % 6 === 0 &&
          chunk.get(x, LAVA_LEVEL, z) === LAVA && chunk.get(x, LAVA_LEVEL + 1, z) === 0) {
        chunk.lights.push([wx, LAVA_LEVEL + 1, wz, 1]);
      }

      const roofed = top - 4;
      if (roofed < 6) continue;

      // Which kind of cave, with a ragged edge between kinds.
      const kind = Noise.caveBiome(wx, wz) + (hash3(wx, 0, wz, salt) - 0.5) * 0.07;
      const lush = kind > 0.2;
      const drip = kind < -0.24;
      const shrooms = !lush && !drip && Noise.cavern(wx * 0.018 + 300, 0, wz * 0.018 + 300) > 0.34;

      for (let y = 3; y < roofed; y++) {
        if (chunk.get(x, y, z) !== 0) continue;
        // A run of open air, y..y1, with whatever is under and over it.
        let y1 = y;
        while (y1 + 1 < roofed && chunk.get(x, y1 + 1, z) === 0) y1++;
        const gap = y1 - y + 1;
        const under = chunk.get(x, y - 1, z);
        const over = chunk.get(x, y1 + 1, z);
        const floor = isSolid(under);
        const ceiling = y1 + 1 < roofed && isSolid(over);

        if (lush) {
          if (floor && SOIL.has(under) && Noise.ore(wx * 0.09, y * 0.05, wz * 0.09) > -0.25) {
            chunk.set(x, y - 1, z, MOSS);
            const h = hash3(wx, y, wz, salt);
            if (h < 0.06) { chunk.set(x, y, z, GLOW_MUSHROOM); chunk.lights.push([wx, y, wz]); }
            else if (h < 0.3 && gap >= 2) chunk.set(x, y, z, TALL_GRASS);
          }
          if (ceiling && SOIL.has(over) && Noise.ore(wx * 0.09 + 50, y1 * 0.05, wz * 0.09 + 50) > -0.1) {
            chunk.set(x, y1 + 1, z, MOSS);
            const h = hash3(wx, y1, wz, salt ^ 0x51f3);
            if (h < 0.2 && gap >= 3) {
              // A vine, hanging no lower than head height above the floor.
              const len = 1 + Math.floor((h / 0.2) * Math.min(4, gap - 2));
              for (let k = 0; k < len; k++) chunk.set(x, y1 - k, z, CAVE_VINE);
            }
          }
        } else if (drip) {
          // Heights come from a fine field, so neighbouring columns rise and
          // fall together: cones of a few blocks, not lone poles.
          const nf = floor ? Noise.ore(wx * 0.31, y * 0.06, wz * 0.31) : -1;
          const nc = ceiling ? Noise.ore(wx * 0.31 + 90, y1 * 0.06, wz * 0.31 + 90) : -1;
          if (floor && nf > 0 && SOIL.has(under)) chunk.set(x, y - 1, z, DRIPSTONE);
          if (ceiling && nc > -0.05 && SOIL.has(over)) chunk.set(x, y1 + 1, z, DRIPSTONE);
          let up = Math.floor(Math.max(0, nf - 0.3) * 8);
          let down = Math.floor(Math.max(0, nc - 0.25) * 10);
          if (up > 0 && down > 0 && up + down >= gap - 1 && gap <= 9) {
            for (let k = y; k <= y1; k++) chunk.set(x, k, z, DRIPSTONE); // they meet: a pillar
          } else {
            // Otherwise leave room to walk between them.
            while (up + down > gap - 2 && (up > 0 || down > 0)) { if (up >= down) up--; else down--; }
            for (let k = 0; k < up; k++) chunk.set(x, y + k, z, DRIPSTONE);
            for (let k = 0; k < down; k++) chunk.set(x, y1 - k, z, DRIPSTONE);
          }
        } else if (shrooms && floor && y < SEA_LEVEL - 2 && hash3(wx, y, wz, salt) < 0.09) {
          chunk.set(x, y, z, GLOW_MUSHROOM);
          chunk.lights.push([wx, y, wz]);
        }
        y = y1 + 1; // the block over the run is not air; go on above it
      }
    }
  }
}

// The deep rock: stone at the bottom of the world becomes deepslate, along a
// boundary that wanders and breaks up. Run after the ores, which are placed in
// stone, so they come out the same at every depth.
export function deepen(chunk) {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const salt = (getSeed() | 0) ^ 0x2d1b;
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = baseX + x, wz = baseZ + z;
      const line = DEEP_Y + Noise.detail(wx, wz, 0.04) * 2.5;
      for (let y = 1; y <= DEEP_Y + 5; y++) {
        if (chunk.get(x, y, z) !== STONE) continue;
        if (y < line + (hash3(wx, y, wz, salt) - 0.5) * 3) chunk.set(x, y, z, DEEPSLATE);
      }
    }
  }
}
