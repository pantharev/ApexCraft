import { CHUNK_SIZE } from '../../../config.js';
import { mulberry32, getSeed } from '../../noise.js';
import { getBlockId } from '../../../blocks/BlockRegistry.js';
import { FLOOR_Y, put, chunkOutside, cellHash } from '../lib.js';

// "Little Town" — a walled village map for Prop Hunt. A sandstone plaza with a
// well at the centre (the seeker pen), a cross of gravel streets, and four
// quadrants of plank houses with gabled stair roofs, plus a market row, a barn
// with two fenced farm plots, and a stone smithy. Every disguise block occurs
// naturally many times (market goods, farm crops, furniture, scattered props)
// so a frozen hider blends in.

export const id = 'town';
export const name = 'Little Town';
export const desc = 'Streets, houses & market stalls';
export const half = 56;           // map spans [-56, 56] on X and Z
export const baseSurface = 'grass';

// Blocks hiders can disguise as — each is seeded around the town as real props.
export const propBlocks = ['hay_bale', 'pumpkin', 'melon', 'crafting_table', 'furnace', 'chest', 'wool'];

const SQUARE_R = 9;               // central plaza half-size (Chebyshev)
const CLEAR_R = 7;                // spawn pen kept clear at the origin

const PLANKS = getBlockId('oak_planks');
const LOG = getBlockId('oak_log');
const GLASS = getBlockId('glass');
const GRAVEL = getBlockId('gravel');
const SANDSTONE = getBlockId('sandstone');
const STONE = getBlockId('stone');
const ANDESITE = getBlockId('andesite');
const MOSSY = getBlockId('mossy_cobblestone');
const FENCE = getBlockId('fence');
const LADDER = getBlockId('ladder');
const DOOR_OPEN = getBlockId('door_open');
const BED = getBlockId('bed');
const BED_HEAD = getBlockId('bed_head');
const TABLE = getBlockId('crafting_table');
const CHEST = getBlockId('chest');
const FURNACE = getBlockId('furnace');
const HAY = getBlockId('hay_bale');
const PUMPKIN = getBlockId('pumpkin');
const MELON = getBlockId('melon');
const WOOL = getBlockId('wool');
const WATER = getBlockId('water');
const DIRT = getBlockId('dirt');
const GRASS = getBlockId('grass');
const OAK_SLAB = getBlockId('oak_slab');
const STONE_SLAB = getBlockId('stone_slab');
const STAIR_PX = getBlockId('oak_stairs_px');
const STAIR_NX = getBlockId('oak_stairs_nx');
const STAIR_PZ = getBlockId('oak_stairs_pz');
const STAIR_NZ = getBlockId('oak_stairs_nz');
const GLOW = getBlockId('glow_mushroom');
const TALL_GRASS = getBlockId('tall_grass');
const POPPY = getBlockId('poppy');
const DANDELION = getBlockId('dandelion');

// Cached layout, keyed by seed so switching worlds never reuses a stale plan.
let _layout = null;
let _layoutSeed = null;

// House lots per quadrant (mirrored by sign). Some are omitted where a civic
// spot (farm/barn, smithy, market) occupies that part of the quadrant.
const LOTS = {
  '1,1': [[14, 14], [32, 12], [12, 32], [46, 16]],                     // SE — farm + barn
  '1,-1': [[14, 14], [32, 12], [12, 32], [46, 16], [16, 46]],          // NE — smithy at (36,-36)
  '-1,1': [[14, 14], [32, 12], [12, 32], [34, 30], [46, 16], [16, 46]],// SW — market row near the plaza
  '-1,-1': [[14, 14], [32, 12], [12, 32], [34, 30], [46, 16], [16, 46]],
};

function layout() {
  const seed = getSeed();
  if (_layout && _layoutSeed === seed) return _layout;

  const rng = mulberry32((seed ^ 0x70b217) >>> 0);
  const houses = [];
  const blocked = []; // rects closed to the loose-prop scatter

  for (const key of Object.keys(LOTS)) {
    const [sx, sz] = key.split(',').map(Number);
    for (const [ax, az] of LOTS[key]) {
      if (rng() < 0.2) continue; // leave some lots empty so seeds read differently
      const w = rng() < 0.5 ? 7 : 9;
      const d = rng() < 0.5 ? 7 : 9;
      const x = sx * ax + Math.round((rng() - 0.5) * 2);
      const z = sz * az + Math.round((rng() - 0.5) * 2);
      // The door faces the nearer of the two streets (the x=0 or z=0 axis).
      const facing = Math.abs(x) < Math.abs(z) ? (x > 0 ? '-x' : '+x') : (z > 0 ? '-z' : '+z');
      const item = [TABLE, CHEST, FURNACE, HAY, WOOL][Math.floor(rng() * 5)];
      houses.push({ x, z, w, d, tall: rng() < 0.3, facing, kind: 'house', item });
    }
  }
  houses.push({ x: 42, z: 38, w: 9, d: 7, tall: false, facing: '-z', kind: 'barn' });
  houses.push({ x: 36, z: -36, w: 7, d: 7, tall: false, facing: '-x', kind: 'smithy' });

  for (const h of houses) {
    blocked.push({
      x0: h.x - (h.w >> 1) - 1, z0: h.z - (h.d >> 1) - 1,
      x1: h.x + (h.w >> 1) + 1, z1: h.z + (h.d >> 1) + 1,
    });
  }

  const farms = [
    { x0: 20, z0: 34, x1: 32, z1: 42 },
    { x0: 20, z0: 46, x1: 32, z1: 54 },
  ];
  blocked.push(...farms);

  const goods = [HAY, PUMPKIN, MELON, WOOL, CHEST];
  const stalls = [-14, -20, -26, -32, -38].map((x, i) => ({ x, z: 5, good: goods[i] }));
  blocked.push({ x0: -40, z0: 3, x1: -12, z1: 7 }); // market row
  const well = { x: 6, z: -6 };
  blocked.push({ x0: 3, z0: -9, x1: 9, z1: -3 });

  const lamps = [[10, 10], [-10, 10], [10, -10], [-10, -10], [44, 2], [-44, 2], [2, 44], [2, -44]];

  // Loose single-block props in alleys and yards (the disguise camouflage).
  const inBlocked = (x, z) => blocked.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  const propIds = propBlocks.map(getBlockId);
  const props = [];
  for (let i = 0; i < 150 && props.length < 30; i++) {
    const x = Math.floor((rng() * 2 - 1) * (half - 4));
    const z = Math.floor((rng() * 2 - 1) * (half - 4));
    if (Math.hypot(x, z) < CLEAR_R + 3) continue;
    if (Math.max(Math.abs(x), Math.abs(z)) <= SQUARE_R + 1) continue;
    if (Math.abs(x) <= 2 || Math.abs(z) <= 2) continue; // keep the streets clear
    if (inBlocked(x, z)) continue;
    props.push({ x, z, block: propIds[Math.floor(rng() * propIds.length)] });
  }

  _layout = { houses, farms, stalls, well, lamps, props };
  _layoutSeed = seed;
  return _layout;
}

// Stamp the whole town into this chunk.
export function generate(chunk) {
  if (chunkOutside(chunk, half)) return;
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const L = layout();

  groundPass(chunk, baseX, baseZ);
  emitWall(chunk, baseX, baseZ);
  for (const h of L.houses) emitBuilding(chunk, h, baseX, baseZ);
  emitWell(chunk, L.well, baseX, baseZ);
  for (const f of L.farms) emitFarm(chunk, f, baseX, baseZ);
  for (const s of L.stalls) emitStall(chunk, s, baseX, baseZ);
  for (const [x, z] of L.lamps) emitLamp(chunk, x, z, baseX, baseZ);
  for (const p of L.props) put(chunk, baseX, baseZ, p.x, FLOOR_Y + 1, p.z, p.block);
  emitFlora(chunk, baseX, baseZ);
}

// Street cross + central plaza, painted into the ground surface.
function groundPass(chunk, baseX, baseZ) {
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wx = baseX + lx, wz = baseZ + lz;
      if (Math.abs(wx) > half || Math.abs(wz) > half) continue;
      if (Math.max(Math.abs(wx), Math.abs(wz)) <= SQUARE_R) chunk.set(lx, FLOOR_Y, lz, SANDSTONE);
      else if (Math.abs(wx) <= 1 || Math.abs(wz) <= 1) chunk.set(lx, FLOOR_Y, lz, GRAVEL);
    }
  }
}

// Sandstone town wall with a fence rail on top.
function emitWall(chunk, baseX, baseZ) {
  for (let wy = FLOOR_Y + 1; wy <= FLOOR_Y + 4; wy++) {
    const wid = wy === FLOOR_Y + 4 ? FENCE : SANDSTONE;
    for (let x = -half; x <= half; x++) {
      put(chunk, baseX, baseZ, x, wy, -half, wid);
      put(chunk, baseX, baseZ, x, wy, half, wid);
    }
    for (let z = -half; z <= half; z++) {
      put(chunk, baseX, baseZ, -half, wy, z, wid);
      put(chunk, baseX, baseZ, half, wy, z, wid);
    }
  }
}

// Houses, the barn, and the smithy share one emitter: plank (or stone) walls
// with log (or andesite) corners, a door facing the street, glass windows, and
// a gabled stair roof. Tall houses get a second floor reached by a ladder.
function emitBuilding(chunk, h, baseX, baseZ) {
  const x0 = h.x - (h.w >> 1), z0 = h.z - (h.d >> 1);
  const x1 = x0 + h.w - 1, z1 = z0 + h.d - 1;
  const fy = FLOOR_Y;
  const barn = h.kind === 'barn', smithy = h.kind === 'smithy';
  const wallTop = fy + (barn ? 5 : h.tall ? 7 : 4);
  const wallId = smithy ? STONE : PLANKS;
  const cornerId = smithy ? ANDESITE : LOG;

  const doorX = h.facing === '+x' ? x1 : h.facing === '-x' ? x0 : h.x;
  const doorZ = h.facing === '+z' ? z1 : h.facing === '-z' ? z0 : h.z;
  // Tall houses: ladder against the wall opposite the door, hole in the floor above.
  const ladX = h.facing === '+x' ? x0 + 1 : h.facing === '-x' ? x1 - 1 : h.x;
  const ladZ = h.facing === '+z' ? z0 + 1 : h.facing === '-z' ? z1 - 1 : h.z;

  const wxA = Math.max(x0, baseX), wxB = Math.min(x1, baseX + CHUNK_SIZE - 1);
  const wzA = Math.max(z0, baseZ), wzB = Math.min(z1, baseZ + CHUNK_SIZE - 1);

  for (let wx = wxA; wx <= wxB; wx++) {
    for (let wz = wzA; wz <= wzB; wz++) {
      const lx = wx - baseX, lz = wz - baseZ;
      const onX = wx === x0 || wx === x1;
      const onZ = wz === z0 || wz === z1;
      const perim = onX || onZ;
      const corner = onX && onZ;

      chunk.set(lx, fy, lz, smithy ? STONE : PLANKS); // floor replaces the grass

      for (let y = fy + 1; y <= wallTop; y++) {
        let bid = 0;
        if (perim) {
          bid = corner ? cornerId : wallId;
          // Barns get a 2-wide open doorway; houses a real (open) door.
          const isDoor = barn
            ? wz === doorZ && (wx === h.x || wx === h.x + 1) && y <= fy + 3
            : wx === doorX && wz === doorZ && y <= fy + 2;
          const isWindow = !barn && !corner && (onX ? wz === h.z : wx === h.x) &&
            !(wx === doorX && wz === doorZ) &&
            (y === fy + 2 || (h.tall && y === fy + 6));
          if (isDoor) bid = barn ? 0 : DOOR_OPEN;
          else if (isWindow) bid = GLASS;
        } else if (h.tall && y === fy + 4) {
          bid = wx === ladX && wz === ladZ ? 0 : PLANKS; // upper floor + ladder hole
        }
        chunk.set(lx, y, lz, bid);
      }

      if (h.tall && wx === ladX && wz === ladZ) {
        for (let y = fy + 1; y <= fy + 5; y++) chunk.set(lx, y, lz, LADDER);
      }

      // Furniture on the interior floor(s).
      if (!perim) {
        if (barn) {
          if (wx <= x0 + 2 && wz >= z1 - 2) {
            chunk.set(lx, fy + 1, lz, HAY); // hay pile in the back corner
            if (wx === x0 + 1 && wz === z1 - 1) chunk.set(lx, fy + 2, lz, HAY);
          } else if (wx === x1 - 1 && wz === z1 - 1) chunk.set(lx, fy + 1, lz, CHEST);
          else if (wx === x1 - 1 && wz === z0 + 1) chunk.set(lx, fy + 1, lz, HAY);
        } else if (smithy) {
          if (wx === x1 - 1 && (wz === z1 - 1 || wz === z1 - 2)) chunk.set(lx, fy + 1, lz, FURNACE);
          else if (wx === x1 - 1 && wz === z0 + 1) chunk.set(lx, fy + 1, lz, TABLE);
          else if (wx === x0 + 1 && wz === z0 + 1) chunk.set(lx, fy + 1, lz, CHEST);
        } else if (!(h.tall && wx === ladX && wz === ladZ)) {
          if (wx === x0 + 1 && wz === z1 - 1) chunk.set(lx, fy + 1, lz, BED);
          else if (wx === x0 + 2 && wz === z1 - 1) chunk.set(lx, fy + 1, lz, BED_HEAD);
          else if (wx === x1 - 1 && wz === z0 + 1) chunk.set(lx, fy + 1, lz, h.item);
          if (h.tall && wx === x0 + 1 && wz === z0 + 1) chunk.set(lx, fy + 5, lz, CHEST);
        }
      }

      // Roof. Smithy: flat stone-slab lid. Others: gabled stair slopes rising
      // to a slab ridge along the long axis, with plank gable ends.
      const roofBase = wallTop + 1;
      if (smithy) {
        chunk.set(lx, roofBase, lz, STONE_SLAB);
      } else if (h.w >= h.d) {
        const steps = (h.d - 1) >> 1;
        for (let k = 0; k <= steps; k++) {
          const y = roofBase + k, lo = z0 + k, hi = z1 - k;
          if (wz === lo && wz === hi) chunk.set(lx, y, lz, OAK_SLAB); // ridge
          else if (wz === lo) chunk.set(lx, y, lz, STAIR_PZ);
          else if (wz === hi) chunk.set(lx, y, lz, STAIR_NZ);
          else if (wz > lo && wz < hi) chunk.set(lx, y, lz, onX ? wallId : 0);
        }
      } else {
        const steps = (h.w - 1) >> 1;
        for (let k = 0; k <= steps; k++) {
          const y = roofBase + k, lo = x0 + k, hi = x1 - k;
          if (wx === lo && wx === hi) chunk.set(lx, y, lz, OAK_SLAB);
          else if (wx === lo) chunk.set(lx, y, lz, STAIR_PX);
          else if (wx === hi) chunk.set(lx, y, lz, STAIR_NX);
          else if (wx > lo && wx < hi) chunk.set(lx, y, lz, onZ ? wallId : 0);
        }
      }
    }
  }
}

// Plaza well: sunken water basin, stone rim with mossy weathering, fence rail,
// plank canopy. (Same shape as the village well, minus the cobble that doesn't
// exist as a block.)
function emitWell(chunk, well, baseX, baseZ) {
  const fy = FLOOR_Y;
  for (let rx = -2; rx <= 2; rx++) {
    for (let rz = -2; rz <= 2; rz++) {
      const wx = well.x + rx, wz = well.z + rz;
      const lx = wx - baseX, lz = wz - baseZ;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
      const ring = Math.max(Math.abs(rx), Math.abs(rz)) === 2;
      const post = Math.abs(rx) === 2 && Math.abs(rz) === 2;
      if (ring) {
        const stone = cellHash(wx, wz) < 0.25 ? MOSSY : STONE;
        chunk.set(lx, fy, lz, stone);
        chunk.set(lx, fy + 1, lz, post ? stone : FENCE);
        chunk.set(lx, fy + 2, lz, post ? STONE : 0);
      } else {
        chunk.set(lx, fy - 1, lz, STONE);
        chunk.set(lx, fy, lz, WATER); // basin sunk into the plaza
      }
      chunk.set(lx, fy + 3, lz, PLANKS); // canopy
    }
  }
}

// Fenced farm plot: tilled crop strips (hay / pumpkin / melon) around a sunken
// irrigation channel, with a gate gap on the street side.
function emitFarm(chunk, f, baseX, baseZ) {
  const fy = FLOOR_Y;
  const mid = (f.x0 + f.x1) >> 1;
  const wxA = Math.max(f.x0, baseX), wxB = Math.min(f.x1, baseX + CHUNK_SIZE - 1);
  const wzA = Math.max(f.z0, baseZ), wzB = Math.min(f.z1, baseZ + CHUNK_SIZE - 1);
  for (let wx = wxA; wx <= wxB; wx++) {
    for (let wz = wzA; wz <= wzB; wz++) {
      const lx = wx - baseX, lz = wz - baseZ;
      const perim = wx === f.x0 || wx === f.x1 || wz === f.z0 || wz === f.z1;
      if (perim) {
        if (!(wx === mid && wz === f.z0)) chunk.set(lx, fy + 1, lz, FENCE);
        continue;
      }
      if (wx === mid) { chunk.set(lx, fy, lz, WATER); continue; }
      const col = wx - f.x0;
      if (col % 2 === 1) {
        chunk.set(lx, fy, lz, DIRT);
        chunk.set(lx, fy + 1, lz, [HAY, PUMPKIN, MELON][(col >> 1) % 3]);
      }
    }
  }
}

// Market stall: four fence posts, a wool canopy, and goods on the street side.
function emitStall(chunk, s, baseX, baseZ) {
  const fy = FLOOR_Y;
  for (let rx = -1; rx <= 1; rx++) {
    for (let rz = -1; rz <= 1; rz++) {
      const wx = s.x + rx, wz = s.z + rz;
      const lx = wx - baseX, lz = wz - baseZ;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
      const post = Math.abs(rx) === 1 && Math.abs(rz) === 1;
      if (post) { chunk.set(lx, fy + 1, lz, FENCE); chunk.set(lx, fy + 2, lz, FENCE); }
      else if (rx === 0 && rz <= 0) chunk.set(lx, fy + 1, lz, s.good);
      chunk.set(lx, fy + 3, lz, WOOL); // canopy
    }
  }
}

// Lamp post: fence column with a glow mushroom "lantern". Torches placed at
// generation time never register with world.torches (that's edit-driven), so
// gen-time light must go through chunk.lights like cave glow flora does.
function emitLamp(chunk, x, z, baseX, baseZ) {
  const lx = x - baseX, lz = z - baseZ;
  if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
  chunk.set(lx, FLOOR_Y + 1, lz, FENCE);
  chunk.set(lx, FLOOR_Y + 2, lz, FENCE);
  chunk.set(lx, FLOOR_Y + 3, lz, GLOW);
  if (!chunk.lights) chunk.lights = [];
  chunk.lights.push([x, FLOOR_Y + 3, z]);
}

// Grass tufts and flowers wherever the ground is still bare grass.
function emitFlora(chunk, baseX, baseZ) {
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wx = baseX + lx, wz = baseZ + lz;
      if (Math.abs(wx) >= half || Math.abs(wz) >= half) continue;
      const r = cellHash(wx, wz);
      if (r >= 0.07) continue;
      if (chunk.get(lx, FLOOR_Y, lz) !== GRASS || chunk.get(lx, FLOOR_Y + 1, lz) !== 0) continue;
      chunk.set(lx, FLOOR_Y + 1, lz, r < 0.05 ? TALL_GRASS : r < 0.06 ? POPPY : DANDELION);
    }
  }
}

// ---- Spawns ----

// Curated hider drop-off points in yards, lanes, and behind buildings; hiders
// relocate during the 20 s hide phase anyway.
const HIDER_SPOTS = [
  { x: 26, z: 44 },   // farm lane between the plots
  { x: 50, z: 44 },   // behind the barn
  { x: 26, z: -26 },  // NE yards
  { x: 44, z: -44 },  // NE corner
  { x: -26, z: -26 }, // NW yards
  { x: -44, z: -44 }, // NW corner
  { x: -26, z: 26 },  // SW yards
  { x: -44, z: 44 },  // SW corner
  { x: -23, z: 8 },   // behind the market stalls
  { x: 13, z: -6 },   // by the well
  { x: 0, z: -34 },   // north street
  { x: 0, z: 34 },    // south street
];

// Seekers start penned on the plaza at the centre.
export function seekerSpawn(i = 0) {
  const a = (i / 4) * Math.PI * 2;
  return { x: Math.cos(a) * 1.5 + 0.5, y: FLOOR_Y + 1, z: Math.sin(a) * 1.5 + 0.5 };
}

export function hiderSpawns(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = HIDER_SPOTS[i % HIDER_SPOTS.length];
    const k = Math.floor(i / HIDER_SPOTS.length); // nudge repeats apart in big lobbies
    out.push({ x: s.x + k + 0.5, y: FLOOR_Y + 1, z: s.z + 0.5 });
  }
  return out;
}

// Where the local player stands while waiting in the lobby.
export function lobbySpawn() { return { x: 0.5, y: FLOOR_Y + 1, z: 0.5 }; }

// Waypoints seeker bots patrol between (they can't climb, so all ground-level).
export const botSpots = [
  { x: 0, z: 0 }, { x: 24, z: 0 }, { x: -24, z: 0 }, { x: 0, z: 24 }, { x: 0, z: -24 },
  { x: -26, z: 10 },  // market
  { x: 42, z: 32 },   // barn front
  { x: 26, z: 44 },   // farm lane
  { x: 32, z: -34 },  // smithy front
  { x: -34, z: -34 }, { x: -34, z: 34 }, { x: 34, z: -14 },
];
