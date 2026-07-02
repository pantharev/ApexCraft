import { isSolid, getBlock } from '../blocks/BlockRegistry.js';

// Amanatides & Woo voxel traversal: step a ray through the grid cell-by-cell
// and stop at the first targetable block — solid, or a plant (flowers/grass
// have no collision but can still be broken). Returns the hit block
// coordinates plus the empty cell just before it (for placement), or null.
// hitLiquid additionally stops at water/lava cells (bucket targeting).
export function raycastVoxel(world, origin, dir, maxDist = 6, hitLiquid = false) {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = Math.sign(dir.x);
  const stepY = Math.sign(dir.y);
  const stepZ = Math.sign(dir.z);

  // Distance along the ray to cross one cell in each axis.
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;

  // Distance to the first cell boundary on each axis.
  const distToBoundary = (s, o, step) =>
    step > 0 ? (Math.floor(o) + 1 - o) : (o - Math.floor(o));
  let tMaxX = stepX !== 0 ? distToBoundary(x, origin.x, stepX) * tDeltaX : Infinity;
  let tMaxY = stepY !== 0 ? distToBoundary(y, origin.y, stepY) * tDeltaY : Infinity;
  let tMaxZ = stepZ !== 0 ? distToBoundary(z, origin.z, stepZ) * tDeltaZ : Infinity;

  // Track the face we entered through, so placement goes on the correct side.
  let face = [0, 0, 0];

  let t = 0;
  while (t <= maxDist) {
    const id = world.getBlock(x, y, z);
    const def = getBlock(id);
    if (isSolid(id) || def.plant || def.door || (hitLiquid && def.liquid)) {
      return {
        block: { x, y, z },
        place: { x: x + face[0], y: y + face[1], z: z + face[2] },
      };
    }

    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      face = [-stepX, 0, 0];
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      face = [0, -stepY, 0];
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      face = [0, 0, -stepZ];
    }
  }
  return null;
}
