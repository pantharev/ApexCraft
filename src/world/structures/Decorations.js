import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from '../../config.js';
import { Noise, mulberry32 } from '../noise.js';
import { getBlockId } from '../../blocks/BlockRegistry.js';

const GRASS = getBlockId('grass');
const SAND = getBlockId('sand');
const TALL_GRASS = getBlockId('tall_grass');
const POPPY = getBlockId('poppy');
const DANDELION = getBlockId('dandelion');
const CACTUS = getBlockId('cactus');
const PUMPKIN = getBlockId('pumpkin');
const MELON = getBlockId('melon');

const SCAN_TOP = 100; // decorations only on lowland surfaces

// Different salt than Tree.js so trees and plants don't correlate.
function hash(x, z) {
  return (Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263)) >>> 0;
}

// Surface flora, run after trees:
//   • tall grass tufts on grass — denser where humid, gathered into meadows by
//     a patch field rather than uniform static
//   • flowers (poppies + dandelions) — mostly inside rare "flower field"
//     patches, with a sprinkle of loners elsewhere
//   • cactus columns (1-3 tall) on desert sand, away from the shore
export function generateDecorations(chunk) {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;

  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wx = baseX + lx, wz = baseZ + lz;

      // Find the surface block (top-down; trees already placed, so skip
      // columns whose surface cell is occupied by trunks/leaves via air check).
      let surf = -1;
      for (let y = SCAN_TOP; y > SEA_LEVEL; y--) {
        if (chunk.get(lx, y, lz) !== 0) { surf = y; break; }
      }
      if (surf < 0 || chunk.get(lx, surf + 1, lz) !== 0) continue;
      const ground = chunk.get(lx, surf, lz);
      const rand = mulberry32(hash(wx, wz));

      if (ground === GRASS) {
        // Meadows: humid regions grow thick grass, gathered in patches.
        const humid = (Noise.humidity(wx, wz) + 1) / 2;
        const patch = (Noise.detail(wx, wz, 0.03) + 1) / 2;
        const grassP = (0.04 + humid * 0.3) * patch * patch;

        // Flower fields: rare patches bloom densely; loners elsewhere.
        const field = Noise.detail(wx + 4096, wz - 4096, 0.016);
        const flowerP = field > 0.52 ? 0.16 : 0.006;

        const roll = rand();
        if (roll < flowerP) {
          // Each field favours one species (by field sign elsewhere).
          const species = Noise.detail(wx - 2048, wz + 2048, 0.01) > 0 ? POPPY : DANDELION;
          chunk.set(lx, surf + 1, lz, rand() < 0.8 ? species : (species === POPPY ? DANDELION : POPPY));
        } else if (roll < flowerP + grassP) {
          chunk.set(lx, surf + 1, lz, TALL_GRASS);
        } else if (roll < flowerP + grassP + 0.0012) {
          // The odd wild pumpkin (or melon where it's hot and humid).
          const hot = Noise.temperature(wx, wz) > 0.3 && humid > 0.6;
          chunk.set(lx, surf + 1, lz, hot ? MELON : PUMPKIN);
        }
      } else if (
        ground === SAND && surf > SEA_LEVEL + 2 &&
        Noise.temperature(wx, wz) > 0.3 && Noise.humidity(wx, wz) < 0.05
      ) {
        // Desert cactus: sparse 1-3 block columns with clear air above.
        if (rand() < 0.008) {
          const h = 1 + Math.floor(rand() * 3);
          if (surf + h + 1 < WORLD_HEIGHT &&
              chunk.get(lx, surf + 2, lz) === 0 && chunk.get(lx, surf + 3, lz) === 0) {
            for (let i = 1; i <= h; i++) chunk.set(lx, surf + i, lz, CACTUS);
          }
        }
      }
    }
  }
}
