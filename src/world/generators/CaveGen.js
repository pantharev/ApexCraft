import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from '../../config.js';
import { Noise } from '../noise.js';
import { isSolid } from '../../blocks/BlockRegistry.js';
import { getBlockId } from '../../blocks/BlockRegistry.js';
import { mulberry32 } from '../noise.js';

const WATER = getBlockId('water');
const LAVA = getBlockId('lava');
const GLOW_MUSHROOM = getBlockId('glow_mushroom');

// Depth bands for cave liquids: lava pools at the bottom of the world, water at
// moderate cave depth. Both stay well under SEA_LEVEL so they can never reach an
// open ocean column and drain it.
const LAVA_MAX_Y = 12;   // lava dominates below this
const WATER_MAX_Y = 30;  // water above lava, up to here
const POOL_DEPTH = 4;    // how many blocks of liquid stack above a floor

// Landmark cavern thresholds: rarer, larger chambers than the normal cheese
// caverns.  A very low-frequency noise (0.004 XZ, 0.006 Y) gates large rooms
// only where its value exceeds 0.78, keeping them to roughly one per 8–12
// chunks.  They appear in the same 4-to-56 y band as the cheese caverns, biased
// toward depth.
const LANDMARK_FREQ_XZ = 0.004;
const LANDMARK_FREQ_Y  = 0.006;
const LANDMARK_THRESH  = 0.78;

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Chunk-level rejection for the landmark pass. The gating field is so
// low-frequency that a coarse 3×3×5 sample grid over the chunk's landmark band
// (y 8-55) bounds it tightly: the nearest grid sample is ≤ ~0.04 noise-space
// units from any voxel, so the field can't climb more than a small fraction
// between samples. The 0.2 margin is deliberately generous — skipping must
// never alter generation (terrain is deterministic from the seed and saves
// only store edits), it may only skip chunks that provably can't pass the
// 0.78 threshold. That's the vast majority: 45 samples replace the ~12k
// per-voxel samples the pass would otherwise burn inside the frame budget.
function landmarkPossible(baseX, baseZ) {
  let max = -Infinity;
  for (let xi = 0; xi <= 2; xi++) {
    for (let zi = 0; zi <= 2; zi++) {
      for (let yi = 0; yi <= 4; yi++) {
        const wx = baseX + (xi * (CHUNK_SIZE - 1)) / 2;
        const wz = baseZ + (zi * (CHUNK_SIZE - 1)) / 2;
        const y = 8 + (yi * 47) / 4;
        const v = Noise.cavern(
          wx * LANDMARK_FREQ_XZ + 200,
          y  * LANDMARK_FREQ_Y  + 200,
          wz * LANDMARK_FREQ_XZ + 200,
        );
        if (v > max) max = v;
      }
    }
  }
  return max > LANDMARK_THRESH - 0.2;
}

// Underground carving pass, run after surface generation. Four systems:
//
//   • Spaghetti tunnels — air where TWO independent 3D fields are both near
//     zero: each field's zero-set is a surface, their intersection is a long
//     winding tube. Tunnels widen slightly with depth and may breach the
//     surface as cave entrances.
//   • Cheese caverns — a low-frequency 3D room field opens big chambers at
//     depth (easier to find ores, scarier to cross).
//   • Rifts — rare, deep ravines: inside high regions of a low-frequency mask,
//     columns near a 2D centre line are cut from the surface down ~15-40
//     blocks, deepest and widest at the centre line.
//   • Landmark caverns — very rare, very large chambers gated by an extra
//     low-frequency noise layer; a real destination when found.
//
// Tuned in node across seeds: tunnels carve ~3% of underground volume,
// caverns ~5-8%, rifts touch ~2% of land columns. Ocean floors are left
// intact so the sea doesn't drain into the underworld.
export function carveCaves(chunk) {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const TF = 0.017, TY = 0.028; // tunnel field frequencies
  // Most chunks can't contain a landmark cavern — decide once, not per voxel.
  const landmark = landmarkPossible(baseX, baseZ);

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = baseX + x;
      const wz = baseZ + z;

      // Local surface (topmost non-air, non-water block).
      let surf = 0;
      for (let y = WORLD_HEIGHT - 1; y > 0; y--) {
        const id = chunk.get(x, y, z);
        if (id !== 0 && id !== WATER) { surf = y; break; }
      }
      if (surf <= 4) continue;
      const underSea = surf <= SEA_LEVEL + 1;

      // Rift band for this column (2D — computed once, carved over a y-range).
      let riftBot = -1, riftTop = -1;
      if (!underSea) {
        const mask = smoothstep(0.1, 0.5, Noise.riftMask(wx, wz));
        if (mask > 0.02) {
          const rv = Math.abs(Noise.rift(wx, wz));
          const w = 0.06 * mask;
          if (rv < w) {
            const t = 1 - rv / w; // 1 at the centre line
            riftTop = surf + 2;   // open to the sky
            riftBot = Math.max(6, Math.floor(surf - (14 + 26 * t * mask)));
          }
        }
      }

      // Tunnels can reach the surface on land (cave entrances), but stay a few
      // blocks under the seabed so oceans don't drain.
      const carveTop = underSea ? surf - 4 : surf;

      for (let y = 3; y <= Math.min(Math.max(carveTop, riftTop), WORLD_HEIGHT - 2); y++) {
        // Rifts cut everything in their band (except water, just in case).
        if (riftTop >= 0 && y >= riftBot && y <= riftTop) {
          if (chunk.get(x, y, z) !== WATER) chunk.set(x, y, z, 0);
          continue;
        }
        if (y > carveTop) continue;

        const cur = chunk.get(x, y, z);
        if (cur === 0 || cur === WATER || !isSolid(cur)) continue;

        // Spaghetti tunnels: both fields near zero -> inside a winding tube.
        const t1 = Noise.cave(wx * TF, y * TY, wz * TF);
        const r = 0.085 + Math.max(0, 40 - y) * 0.0009; // a bit wider when deep
        if (Math.abs(t1) < r) {
          const t2 = Noise.caveB(wx * TF + 50, y * TY, wz * TF + 50);
          if (Math.abs(t2) < r) { chunk.set(x, y, z, 0); continue; }
        }

        // Cheese caverns: big rooms, increasingly common with depth.
        if (y < 42) {
          const cv = Noise.cavern(wx * 0.008, y * 0.013, wz * 0.008);
          if (cv > 0.66 - (42 - y) * 0.003) { chunk.set(x, y, z, 0); continue; }
        }

        // Landmark caverns: very rare, very large chambers.  A separate
        // low-frequency noise layer triggers them independently of the regular
        // cheese caverns so they feel like genuine discoveries.  Their threshold
        // is deliberately tighter (0.78 vs 0.66) so they're rarer; y-weighting
        // bias pushes them to depth 8–56 where they're darkest.
        if (landmark && y >= 8 && y < 56) {
          const lv = Noise.cavern(
            wx * LANDMARK_FREQ_XZ + 200,
            y  * LANDMARK_FREQ_Y  + 200,
            wz * LANDMARK_FREQ_XZ + 200,
          );
          if (lv > LANDMARK_THRESH) { chunk.set(x, y, z, 0); continue; }
        }
      }
    }
  }

  // Per-column pool mask, computed once and shared: fillLiquids and
  // placeGlowMushrooms previously each sampled this identical noise
  // (256 redundant 3D calls per chunk).
  const poolMask = new Float32Array(CHUNK_SIZE * CHUNK_SIZE);
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      poolMask[z * CHUNK_SIZE + x] =
        Noise.cavern((baseX + x) * 0.012 + 500, 0, (baseZ + z) * 0.012 + 500);
    }
  }

  fillLiquids(chunk, poolMask);
  placeGlowMushrooms(chunk, poolMask);
}

// Second pass (after carving): settle static liquids onto cave floors. Lava
// pools deep, water at moderate depth. A low-frequency noise mask gates pools so
// they're occasional and atmospheric, not everywhere — and bottom-up filling on
// a solid (or same-liquid) floor means liquids rest on the ground and stack a
// few blocks deep, never hang as floating sheets. Deterministic (Noise only),
// so every client generates identical pools with no network sync.
function fillLiquids(chunk, poolMask) {
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      // Per-column pool mask: only columns over a high-noise region get liquid,
      // so pools cluster into occasional lakes instead of coating every cave.
      if (poolMask[z * CHUNK_SIZE + x] < 0.35) continue;

      // Bottom-up so a liquid cell can rest on the liquid it just placed below
      // (a settled pool), as well as on solid ground.
      for (let y = 1; y < WATER_MAX_Y; y++) {
        if (chunk.get(x, y, z) !== 0) continue; // only fill carved/open air
        const below = chunk.get(x, y - 1, z);
        const onFloor = isSolid(below) || below === WATER || below === LAVA;
        if (!onFloor) continue; // no floating sheets

        // Limit each pool to a few blocks above its true (solid) floor.
        let floorDist = 0;
        for (let d = 1; d <= POOL_DEPTH; d++) {
          if (isSolid(chunk.get(x, y - d, z))) break;
          floorDist = d;
        }
        if (floorDist >= POOL_DEPTH) continue; // too far above the rock floor

        // A pool keeps the liquid of the cell below it: a floor at y 8-11
        // would otherwise start in lava and flip to water at the y=12 band
        // boundary, stacking water directly on lava (and z-fighting where the
        // two surfaces meet).
        const liquid = (below === LAVA || below === WATER)
          ? below
          : (y < LAVA_MAX_Y ? LAVA : WATER);
        chunk.set(x, y, z, liquid);
      }
    }
  }
}

// Third pass (after liquids): scatter glow mushrooms onto solid cave floors and
// on stone/andesite surfaces adjacent to cave air. They cluster near water pools
// and in landmark caverns, using seeded Noise so placement is identical on every
// client. Each placed block is recorded in chunk.lights so the dynamic light
// pool (TorchLights) can include them without scanning block data per-frame.
//
// Design choices:
//   • Two independent noise layers gate placement: a low-frequency "biome" mask
//     (where mushrooms cluster) and a per-cell Perlin check (which exact cells
//     within the cluster actually sprout). Both seeded, no Math.random().
//   • Only placed on solid floors with exactly 1+ cells of air headroom and
//     below y=SEA_LEVEL to stay underground.
//   • Proximity to water: columns with a pool mask > 0.35 (same threshold as
//     fillLiquids) get twice the cluster density so pools visually glow.
function placeGlowMushrooms(chunk, poolMask) {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;

  // chunk.lights is a lightweight list of world positions for luminous generated
  // blocks; the dynamic light pool (TorchLights / extended World.lightsNear)
  // picks from this to assign PointLights each frame.
  if (!chunk.lights) chunk.lights = [];

  // Per-chunk seeded RNG for the rarity jitter (avoids Math.random()).
  const rand = mulberry32(((chunk.cx & 0xffff) << 16) ^ (chunk.cz & 0xffff) ^ 0x4c3a1f);

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = baseX + x;
      const wz = baseZ + z;

      // Low-frequency cluster mask: only grow mushrooms in warm-to-high regions.
      const clusterMask = Noise.cavern(wx * 0.018 + 300, 0, wz * 0.018 + 300);
      if (clusterMask < 0.30) continue; // outside a cluster

      // Proximity bonus: near water pools → denser clusters (pool threshold 0.35).
      const densityBoost = poolMask[z * CHUNK_SIZE + x] > 0.35 ? 1.5 : 1.0;

      // Scan underground column for valid floor positions.
      for (let y = 4; y < SEA_LEVEL - 2; y++) {
        if (chunk.get(x, y, z) !== 0) continue; // must be open air
        const below = chunk.get(x, y - 1, z);
        if (!isSolid(below)) continue;           // must rest on solid ground
        // 1-block headroom: the mushroom occupies y, so y+1 must be air too.
        const above = chunk.get(x, y + 1, z);
        if (above !== 0 && above !== WATER) continue; // not enough headroom

        // Per-cell density noise: only some cells within the cluster sprout.
        const cellNoise = Noise.ore(wx * 0.12, y * 0.15, wz * 0.12);
        // Base threshold 0.62; pulled down by density boost near water.
        const thresh = 0.62 - (densityBoost - 1.0) * 0.12;
        if (cellNoise < thresh) continue;

        // Final rarity jitter (seeded): ~60% of threshold-passing cells actually grow.
        if (rand() > 0.60) continue;

        chunk.set(x, y, z, GLOW_MUSHROOM);
        // Record light position for the dynamic pool (world coords, light at
        // slightly above the mushroom cap ~ y + 0.7).
        chunk.lights.push([wx, y, wz]);
      }
    }
  }
}
