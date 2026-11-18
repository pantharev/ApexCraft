import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from '../../config.js';
import { Noise } from '../noise.js';
import { Biome, biomeV2 } from '../biomes/BiomeMap.js';
import { getBlockId } from '../../blocks/BlockRegistry.js';
import { landform } from './Height2.js';
import { villagesNear } from '../structures/VillagePlan.js';

// Generator version 2: turns the landforms of Height2.js into blocks.
//
// Two things here are new against version 1. The ground is no longer only a
// heightfield: where it is steep, a 3D noise field moves the surface in and
// out, so cliffs have ledges, undercuts and the odd overhang instead of being
// a clean staircase. And what a column is covered with depends on its slope
// as well as its biome and altitude: soil and grass on ground you could walk
// up, bare rock on faces you could not.

const STONE = getBlockId('stone');
const DIRT = getBlockId('dirt');
const GRASS = getBlockId('grass');
const SAND = getBlockId('sand');
const SANDSTONE = getBlockId('sandstone');
const GRAVEL = getBlockId('gravel');
const SNOW = getBlockId('snow');
const CLAY = getBlockId('clay');
const WATER = getBlockId('water');
const BEDROCK = getBlockId('bedrock');
const ANDESITE = getBlockId('andesite');

const S = CHUNK_SIZE;
const G = S + 2;       // the chunk plus one column all round, for slopes
const LAYER = S * S;   // cells per layer of Chunk.blocks; index = y * LAYER + z * S + x
const MAX_H = WORLD_HEIGHT - 6;

const smoothstep = (a, b, x) => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};

// Per-column landform values on the (S+2)² grid, reused between chunks.
const H = new Float32Array(G * G);
const MTN = new Float32Array(G * G);
const TEMP = new Float32Array(G * G);
const HUMID = new Float32Array(G * G);
const L = { h: 0, mtn: 0, plat: 0, rug: 0, temp: 0, humid: 0 };

// The 3D field that roughens steep ground: two octaves, squashed vertically
// so its features are ledges more than pillars. About -1..1.
function ledges(wx, y, wz) {
  return Noise.overhang(wx * 0.045, y * 0.07, wz * 0.045) * 0.65
    + Noise.overhang(wx * 0.1 + 40, y * 0.14, wz * 0.1 + 40) * 0.35;
}

export function generateTerrain2(chunk) {
  const blocks = chunk.blocks;
  const baseX = chunk.cx * S, baseZ = chunk.cz * S;

  for (let gz = 0; gz < G; gz++) {
    for (let gx = 0; gx < G; gx++) {
      landform(baseX + gx - 1, baseZ + gz - 1, L);
      const gi = gz * G + gx;
      H[gi] = L.h; MTN[gi] = L.mtn; TEMP[gi] = L.temp; HUMID[gi] = L.humid;
    }
  }
  // For the cave pass (CaveGen): per column, the height from which a
  // neighbouring column holds open water. Nothing may be cut at or above it
  // (up to sea level), or a lake would stand beside the hole like glass.
  const shore = chunk.shore = new Uint8Array(S * S).fill(255);

  // Villages are laid out on the plain heightfield (Height2.heightV2), so
  // near one the ground has to be exactly that: no ledges under the houses.
  const calm = villagesNear(baseX + S / 2, baseZ + S / 2, 88).length > 0;

  for (let z = 0; z < S; z++) {
    for (let x = 0; x < S; x++) {
      const wx = baseX + x, wz = baseZ + z;
      const gi = (z + 1) * G + (x + 1);
      const hF = H[gi];
      const h = Math.max(2, Math.min(MAX_H, Math.floor(hF)));
      // Steepness, in blocks of rise per block of run, from the neighbours.
      const slope = Math.max(Math.abs(H[gi + 1] - H[gi - 1]), Math.abs(H[gi + G] - H[gi - G])) * 0.5;
      L.h = hF; L.mtn = MTN[gi]; L.temp = TEMP[gi]; L.humid = HUMID[gi];
      const biome = biomeV2(wx, wz, L);
      const col = z * S + x;
      for (const n of [gi - 1, gi + 1, gi - G, gi + G]) {
        const bed = Math.floor(H[n]);
        if (bed < SEA_LEVEL && bed + 1 < shore[col]) shore[col] = Math.max(1, bed + 1);
      }

      // Jitter altitude bands a little so snowlines/rock lines wander
      // organically instead of tracing dead-flat contour lines.
      const dith = Noise.detail(wx, wz, 0.07) * 3;
      const rockLine = 105 + dith; // andesite above, stone below

      // --- What is solid ---
      // Below `lo` the column is plain heightfield. From `lo` to `hi` — the
      // band the 3D field can reach — each cell asks the field. Never below
      // the waterline: an air pocket there would sit beside open water.
      const amp = calm || h <= SEA_LEVEL + 3 ? 0
        : 4 * smoothstep(1.0, 2.4, slope) + 7 * MTN[gi] * smoothstep(0.7, 1.8, slope);
      const lo = amp > 0 ? Math.max(SEA_LEVEL + 2, Math.floor(hF - amp)) : h + 1;
      const hi = amp > 0 ? Math.min(WORLD_HEIGHT - 3, Math.ceil(hF + amp)) : h;
      blocks[col] = BEDROCK;
      const plain = Math.min(h, lo - 1);
      for (let y = 1; y <= plain; y++) blocks[col + y * LAYER] = y > rockLine ? ANDESITE : STONE;
      let top = plain;
      for (let y = lo; y <= hi; y++) {
        if (hF - y + amp * ledges(wx, y, wz) > 0) {
          blocks[col + y * LAYER] = y > rockLine ? ANDESITE : STONE;
          top = y;
        }
      }

      // --- What it is covered with ---
      const submerged = top < SEA_LEVEL;
      const desert = biome === Biome.DESERT;
      const steep = slope > 1.45 + dith * 0.05;                // a face, not a slope: bare
      const broken = !steep && slope > 1.05;                   // rock showing through
      const beach = !submerged && h <= SEA_LEVEL + 1 && slope < 1.3;
      const alpine = h > 88 + dith;                            // above the treeline
      const snowcap = h > 97 + dith || biome === Biome.SNOWY;
      const sandy = submerged || beach || desert;
      const soil = steep ? 1 : 3 + Math.floor(((Noise.detail(wx, wz, 0.03) + 1) / 2) * 3); // 3..5

      let cover;
      if (submerged) {
        // Varied sea/river floor: sand banks, gravel runs, clay pockets.
        const f = Noise.detail(wx, wz, 0.045);
        cover = f > 0.55 ? CLAY : f < (top < SEA_LEVEL - 12 ? 0.05 : -0.4) ? GRAVEL : SAND;
      } else if (steep) {
        cover = desert ? SANDSTONE : Noise.detail(wx, wz, 0.11) > 0.5 ? GRAVEL : 0; // 0: leave the rock
      } else if (snowcap) {
        cover = SNOW;
      } else if (alpine) {
        cover = Noise.detail(wx, wz, 0.11) > 0.45 ? GRAVEL : 0;
      } else if (beach || desert) {
        cover = SAND;
      } else if (broken && Noise.detail(wx, wz, 0.19) > 0.15) {
        cover = 0;
      } else {
        cover = GRASS;
      }
      const bare = steep || alpine || cover === 0;
      const under = sandy ? SAND : bare ? 0 : DIRT;

      // Walk down from the top. `run` counts solid cells since the last
      // opening above, so the floor under an overhang is covered like any
      // other ground, and an overhang itself is rock with one layer on top.
      let run = 0, open = true;
      for (let y = top; y >= 1; y--) {
        const i = col + y * LAYER;
        if (blocks[i] === 0) { open = true; continue; }
        run = open ? 0 : run + 1;
        open = false;
        const depth = y > h ? 1 : soil; // above the heightfield: an overhang
        if (run >= depth) {
          if (y < lo) break; // plain rock from here down
          continue;
        }
        if (run === 0) { if (cover) blocks[i] = cover; }
        else if (sandy) blocks[i] = run < 3 ? SAND : SANDSTONE;
        else if (under) blocks[i] = under;
      }

      // Fill water from the bed up to sea level (oceans, lakes, rivers).
      for (let y = top + 1; y <= SEA_LEVEL; y++) blocks[col + y * LAYER] = WATER;
    }
  }
}
