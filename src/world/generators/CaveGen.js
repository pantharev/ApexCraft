import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from '../../config.js';
import { Noise } from '../noise.js';
import { isSolid } from '../../blocks/BlockRegistry.js';
import { getBlockId } from '../../blocks/BlockRegistry.js';

const WATER = getBlockId('water');

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Underground carving pass, run after surface generation. Three systems:
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
//
// Tuned in node across seeds: tunnels carve ~3% of underground volume,
// caverns ~5-8%, rifts touch ~2% of land columns. Ocean floors are left
// intact so the sea doesn't drain into the underworld.
export function carveCaves(chunk) {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const TF = 0.017, TY = 0.028; // tunnel field frequencies

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
          if (cv > 0.66 - (42 - y) * 0.003) chunk.set(x, y, z, 0);
        }
      }
    }
  }
}
