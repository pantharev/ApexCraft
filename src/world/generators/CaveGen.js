import { CHUNK_SIZE, WORLD_HEIGHT } from '../../config.js';
import { Noise } from '../noise.js';
import { isSolid } from '../../blocks/BlockRegistry.js';
import { getBlockId } from '../../blocks/BlockRegistry.js';

const WATER = getBlockId('water');

// 3D-noise carving pass: hollow out solid blocks where the cave field is high.
// Runs after surface generation so caves cut through stone/dirt but leave the
// ocean water column intact.
export function carveCaves(chunk) {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const freq = 0.06;
  const yFreq = 0.09;

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const wx = baseX + x;
      const wz = baseZ + z;
      for (let y = 2; y < 60; y++) {
        const cur = chunk.get(x, y, z);
        if (cur === 0 || cur === WATER || !isSolid(cur)) continue;

        // Two perpendicular noise samples produce tube/worm-like caverns
        // rather than spherical blobs.
        const n1 = Noise.cave(wx * freq, y * yFreq, wz * freq);
        const n2 = Noise.cave(wx * freq + 100, y * yFreq, wz * freq + 100);
        if (Math.abs(n1) < 0.12 && Math.abs(n2) < 0.12) {
          chunk.set(x, y, z, 0);
        } else if (n1 > 0.78 && y < 50) {
          chunk.set(x, y, z, 0);
        }
      }
    }
  }
}
