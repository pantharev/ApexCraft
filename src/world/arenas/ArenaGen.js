import { CHUNK_SIZE } from '../../config.js';
import { mulberry32, getSeed } from '../noise.js';
import { getBlockId } from '../../blocks/BlockRegistry.js';

// Procedural Prop Hunt arena. Unlike the infinite survival world, hide & seek
// plays in a single bounded arena centred on the world origin and stamped onto
// a flat base (see TerrainGen's flat branch). Everything here is a PURE function
// of the world seed, so every chunk computes the same layout independently and
// emits only the cells that fall inside itself — exactly like village stamping.

export const FLOOR_Y = 64;        // grass floor level (matches the flat fill)
export const ARENA_HALF = 48;     // arena spans [-48, 48] on X and Z (~96 blocks)
const WALL_H = 7;                 // perimeter wall height
const CLEAR_R = 7;                // keep a clear pen around origin for spawns

// Blocks that hiders can disguise as — also scattered around the arena as real
// props so a disguised hider blends into a crowd of identical blocks.
export const PROP_BLOCKS = [
  'hay_bale', 'pumpkin', 'melon', 'crafting_table', 'furnace', 'chest', 'wool', 'mossy_cobblestone',
];
// Larger building blocks used for the cover boxes/pillars dotted around.
const OBSTACLE_BLOCKS = ['oak_planks', 'stone', 'mossy_cobblestone', 'sandstone'];

const idOf = (name) => getBlockId(name);

// Cached layout, keyed by seed so switching worlds never reuses a stale plan.
let _layout = null;
let _layoutSeed = null;

// Deterministic arena layout: a grid of cover boxes plus a field of single-block
// props, with a clear pen kept around the origin for spawns.
export function arenaLayout() {
  const seed = getSeed();
  if (_layout && _layoutSeed === seed) return _layout;

  const rng = mulberry32((seed ^ 0x0A12EA) >>> 0);
  const wall = idOf('stone');
  const obstacles = [];
  const props = [];

  // Grid of cover boxes/pillars.
  const STEP = 16;
  for (let gx = -ARENA_HALF + 10; gx <= ARENA_HALF - 10; gx += STEP) {
    for (let gz = -ARENA_HALF + 10; gz <= ARENA_HALF - 10; gz += STEP) {
      if (rng() < 0.7) {
        const jx = gx + Math.floor((rng() - 0.5) * 6);
        const jz = gz + Math.floor((rng() - 0.5) * 6);
        if (Math.hypot(jx, jz) < CLEAR_R) continue;
        obstacles.push({
          x: jx, z: jz,
          w: 2 + Math.floor(rng() * 3),
          d: 2 + Math.floor(rng() * 3),
          h: 2 + Math.floor(rng() * 3),
          block: idOf(OBSTACLE_BLOCKS[Math.floor(rng() * OBSTACLE_BLOCKS.length)]),
        });
      }
    }
  }

  // Scattered single-block props (the disguise camouflage).
  for (let i = 0; i < 70; i++) {
    const x = Math.floor((rng() * 2 - 1) * (ARENA_HALF - 4));
    const z = Math.floor((rng() * 2 - 1) * (ARENA_HALF - 4));
    if (Math.hypot(x, z) < CLEAR_R) continue;
    props.push({ x, z, block: idOf(PROP_BLOCKS[Math.floor(rng() * PROP_BLOCKS.length)]) });
  }

  _layout = { obstacles, props, wall };
  _layoutSeed = seed;
  return _layout;
}

// Stamp world-block (wx,wy,wz) into the chunk if it lies inside it.
function put(chunk, baseX, baseZ, wx, wy, wz, id) {
  const lx = wx - baseX, lz = wz - baseZ;
  if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) chunk.set(lx, wy, lz, id);
}

// Stamp the arena's walls, cover boxes, and props into this chunk.
export function generateArena(chunk) {
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  // Skip chunks entirely outside the arena footprint (walls included).
  if (baseX > ARENA_HALF || baseX + CHUNK_SIZE - 1 < -ARENA_HALF ||
      baseZ > ARENA_HALF || baseZ + CHUNK_SIZE - 1 < -ARENA_HALF) return;

  const { obstacles, props, wall } = arenaLayout();

  // Perimeter walls.
  for (let wy = FLOOR_Y + 1; wy <= FLOOR_Y + WALL_H; wy++) {
    for (let x = -ARENA_HALF; x <= ARENA_HALF; x++) {
      put(chunk, baseX, baseZ, x, wy, -ARENA_HALF, wall);
      put(chunk, baseX, baseZ, x, wy, ARENA_HALF, wall);
    }
    for (let z = -ARENA_HALF; z <= ARENA_HALF; z++) {
      put(chunk, baseX, baseZ, -ARENA_HALF, wy, z, wall);
      put(chunk, baseX, baseZ, ARENA_HALF, wy, z, wall);
    }
  }

  // Cover boxes / pillars.
  for (const o of obstacles) {
    for (let dx = 0; dx < o.w; dx++) {
      for (let dz = 0; dz < o.d; dz++) {
        for (let dy = 0; dy < o.h; dy++) {
          put(chunk, baseX, baseZ, o.x + dx, FLOOR_Y + 1 + dy, o.z + dz, o.block);
        }
      }
    }
  }

  // Single-block props sitting on the floor.
  for (const p of props) put(chunk, baseX, baseZ, p.x, FLOOR_Y + 1, p.z, p.block);
}
