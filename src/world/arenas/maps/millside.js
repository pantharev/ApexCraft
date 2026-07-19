import { CHUNK_SIZE } from '../../../config.js';
import { getBlockId } from '../../../blocks/BlockRegistry.js';
import { FLOOR_Y, put, fillBox, chunkOutside, cellHash } from '../lib.js';

// "Millside" — the Tycoon mode map. Four identical lumber-mill plots, one per
// player, mirrored into the quadrants around a central hub plaza. Each plot
// has a step-on claim pad by the avenue, a shop wall with three purchase pads
// (worker / mill / house), a grove of oaks, a starter mill, an empty house
// pad, and a straight flat gravel work route the AI workers shuttle along
// (steering is straight-line only — never put anything on the route).
//
// The mill/house upgrade buildings are NOT emitted here: TycoonMode stamps
// them as ordinary world edits (millStamp/houseStamp below), so they sync and
// persist through the existing edit machinery.
//
// Layout is fully deterministic; only the flower scatter varies by seed via
// cellHash. half=46 keeps every chunk of the map inside LOAD_RADIUS (8 chunks
// = 128 blocks) from any point in it, so host-simulated workers never stand
// in an unloaded chunk whatever plot the host wanders to.

export const id = 'millside';
export const name = 'Millside';
export const desc = 'Claim a plot, work the wood, get rich';
export const half = 46;            // map spans [-46, 46] on X and Z
export const baseSurface = 'grass';

// Arena-map contract stubs (Prop Hunt concepts — unused by Tycoon).
export const propBlocks = [];
export const botSpots = [];

const STONE = getBlockId('stone');
const STONE_SLAB = getBlockId('stone_slab');
const ANDESITE = getBlockId('andesite');
const MOSSY = getBlockId('mossy_cobblestone');
const PLANKS = getBlockId('oak_planks');
const LOG = getBlockId('oak_log');
const LEAVES = getBlockId('oak_leaves');
const OAK_SLAB = getBlockId('oak_slab');
const GLASS = getBlockId('glass');
const PANE = getBlockId('glass_pane');
const DOOR_OPEN = getBlockId('door_open');
const FENCE = getBlockId('fence');
const TORCH = getBlockId('torch');
const GLOW = getBlockId('glow_mushroom');
const GRAVEL = getBlockId('gravel');
const BEDROCK = getBlockId('bedrock');
const FURNACE = getBlockId('furnace');
const TABLE = getBlockId('crafting_table');
const HAY = getBlockId('hay_bale');
const FLOWER = getBlockId('dandelion');
const CLAIM = getBlockId('tycoon_claim');
const PAD_WORKER = getBlockId('tycoon_pad_worker');
const PAD_MILL = getBlockId('tycoon_pad_mill');
const PAD_HOUSE = getBlockId('tycoon_pad_house');

const FY = FLOOR_Y;                // grass floor level (64)

// Perimeter hedge: leaf ring over a bedrock core — unclimbable, unbreakable,
// keeps everyone inside the every-chunk-loaded guarantee.
const HEDGE_IN = 44, HEDGE_OUT = 46;
const HEDGE_TOP = FY + 3;

// Hub plaza (Chebyshev radius) and the gravel avenues along the axes that
// separate the four plots.
const PLAZA_R = 6;
const AVENUE_HALF = 2;             // avenues span |x|<=2 / |z|<=2

// Master plot geometry, authored in the (+x,+z) quadrant and mirrored into
// the others with sign flips. All coordinates are quadrant-local positives.
// The work route runs along z=ROUTE_Z from the mill door to the grove.
const ROUTE_Z = 28;                // route centreline
const MILL_X0 = 12, MILL_X1 = 18;  // mill build volume (x)
const MILL_Z0 = 24, MILL_Z1 = 32;  // mill build volume (z)
const MILL_DOOR_X = 19;            // delivery point just outside the volume
const GROVE_X = 33;                // where workers chop
const HOUSE_X0 = 24, HOUSE_X1 = 32;
const HOUSE_Z0 = 10, HOUSE_Z1 = 16;
const CLAIM_X0 = 9, CLAIM_Z0 = 4;  // 2x2 claim pad beside the z-avenue
// Shop wall two blocks clear of the mill volume, so its pads stay reachable
// even after the tier-3+ mill walls rise at MILL_X0.
const SHOP_X = 9;                  // pads face +x, across a 2-wide aisle
const SHOP_Z0 = 25, SHOP_Z1 = 31;

// Plot quadrant signs, in plot-index order (0..3).
const SIGNS = [[1, 1], [-1, 1], [1, -1], [-1, -1]];

// Per-plot data consumed by TycoonMode: claim-pad footprint (world-space,
// inclusive), purchase-pad cells, and the two worker stations. Workers walk
// source <-> mill in a straight line along the gravel route.
export const PLOTS = SIGNS.map(([sx, sz]) => ({
  sx, sz,
  claim: {
    x0: Math.min(sx * CLAIM_X0, sx * (CLAIM_X0 + 1)),
    x1: Math.max(sx * CLAIM_X0, sx * (CLAIM_X0 + 1)),
    z0: Math.min(sz * CLAIM_Z0, sz * (CLAIM_Z0 + 1)),
    z1: Math.max(sz * CLAIM_Z0, sz * (CLAIM_Z0 + 1)),
  },
  padWorker: { x: sx * SHOP_X, y: FY + 2, z: sz * (ROUTE_Z - 2) },
  padMill: { x: sx * SHOP_X, y: FY + 2, z: sz * ROUTE_Z },
  padHouse: { x: sx * SHOP_X, y: FY + 2, z: sz * (ROUTE_Z + 2) },
  mill: { x: sx * MILL_DOOR_X + 0.5, z: sz * ROUTE_Z + 0.5 },
  source: { x: sx * GROVE_X + 0.5, z: sz * ROUTE_Z + 0.5 },
}));

// Which plot owns world position (x,z)? -1 in the hub/avenues.
export function plotOf(x, z) {
  if (Math.abs(x) <= AVENUE_HALF || Math.abs(z) <= AVENUE_HALF) return -1;
  return (x > 0 ? 0 : 1) + (z > 0 ? 0 : 2);
}

// Stamp the whole map into this chunk.
export function generate(chunk) {
  if (chunkOutside(chunk, half)) return;
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;

  groundPass(chunk, baseX, baseZ);
  emitHedge(chunk, baseX, baseZ);
  emitHub(chunk, baseX, baseZ);
  for (let i = 0; i < PLOTS.length; i++) emitPlot(chunk, baseX, baseZ, SIGNS[i]);
}

// Ground: grass base with gravel avenues along the axes, a stone plaza at the
// hub, the gravel work routes, and the golden claim tiles.
function groundPass(chunk, baseX, baseZ) {
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wx = baseX + lx, wz = baseZ + lz;
      const r = Math.max(Math.abs(wx), Math.abs(wz));
      if (r >= HEDGE_IN) continue; // hedge ring owns its footing
      if (r <= PLAZA_R) {
        // Plaza paving: stone with slab-wear patches.
        const h = cellHash(wx, wz);
        chunk.set(lx, FY, lz, h < 0.15 ? ANDESITE : h < 0.9 ? STONE : MOSSY);
        continue;
      }
      if (Math.abs(wx) <= AVENUE_HALF || Math.abs(wz) <= AVENUE_HALF) {
        chunk.set(lx, FY, lz, GRAVEL); // the avenues between plots
        continue;
      }
      const ax = Math.abs(wx), az = Math.abs(wz);
      // Work route: 3 wide, mill door to grove.
      if (Math.abs(az - ROUTE_Z) <= 1 && ax >= MILL_X0 && ax <= GROVE_X + 2) {
        chunk.set(lx, FY, lz, GRAVEL);
        continue;
      }
      // Claim pad tiles.
      if (ax >= CLAIM_X0 && ax <= CLAIM_X0 + 1 && az >= CLAIM_Z0 && az <= CLAIM_Z0 + 1) {
        chunk.set(lx, FY, lz, CLAIM);
        continue;
      }
      // Flower scatter on the open grass (seedless — pure cellHash).
      if (cellHash(wx, wz) < 0.02 && FLOWER) chunk.set(lx, FY + 1, lz, FLOWER);
    }
  }
}

// Leaf hedge over a bedrock core: 3 high, unbreakable, no footholds.
function emitHedge(chunk, baseX, baseZ) {
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wx = baseX + lx, wz = baseZ + lz;
      const r = Math.max(Math.abs(wx), Math.abs(wz));
      if (r < HEDGE_IN || r > HEDGE_OUT) continue;
      chunk.set(lx, FY, lz, BEDROCK); // footing
      for (let y = FY + 1; y <= HEDGE_TOP; y++) {
        chunk.set(lx, y, lz, r === HEDGE_IN + 1 ? BEDROCK : LEAVES);
      }
    }
  }
}

// Hub plaza: lamp posts on the corners and a hay-bench notice corner. The
// centre stays open — it is the lobby spawn.
function emitHub(chunk, baseX, baseZ) {
  for (const [sx, sz] of SIGNS) {
    const cx = sx * (PLAZA_R - 2), cz = sz * (PLAZA_R - 2);
    put(chunk, baseX, baseZ, cx, FY + 1, cz, FENCE);
    put(chunk, baseX, baseZ, cx, FY + 2, cz, FENCE);
    put(chunk, baseX, baseZ, cx, FY + 3, cz, GLOW);
    const gx = cx, gz = cz;
    const lgx = gx - baseX, lgz = gz - baseZ;
    if (lgx >= 0 && lgx < CHUNK_SIZE && lgz >= 0 && lgz < CHUNK_SIZE) {
      if (!chunk.lights) chunk.lights = [];
      chunk.lights.push([gx, FY + 3, gz]);
    }
  }
}

// One plot, mirrored by quadrant signs. Everything static lives here; the
// upgrade buildings arrive later as edits via millStamp/houseStamp.
function emitPlot(chunk, baseX, baseZ, [sx, sz]) {
  const X = (x) => sx * x;
  const Z = (z) => sz * z;

  // Shop wall: 3-high plank-trimmed stone spine carrying the purchase pads,
  // facing the mill yard (+x side of the wall in master space).
  for (let z = SHOP_Z0; z <= SHOP_Z1; z++) {
    for (let y = FY + 1; y <= FY + 3; y++) {
      put(chunk, baseX, baseZ, X(SHOP_X), y, Z(z), y === FY + 3 ? PLANKS : STONE);
    }
  }
  put(chunk, baseX, baseZ, X(SHOP_X), FY + 2, Z(ROUTE_Z - 2), PAD_WORKER);
  put(chunk, baseX, baseZ, X(SHOP_X), FY + 2, Z(ROUTE_Z), PAD_MILL);
  put(chunk, baseX, baseZ, X(SHOP_X), FY + 2, Z(ROUTE_Z + 2), PAD_HOUSE);
  put(chunk, baseX, baseZ, X(SHOP_X), FY + 4, Z(ROUTE_Z), TORCH);

  // Starter mill (tier 1): a sawhorse of logs with a plank worktop and a log
  // pile — the delivery end of the work route.
  put(chunk, baseX, baseZ, X(14), FY + 1, Z(27), LOG);
  put(chunk, baseX, baseZ, X(14), FY + 1, Z(29), LOG);
  put(chunk, baseX, baseZ, X(14), FY + 2, Z(27), OAK_SLAB);
  put(chunk, baseX, baseZ, X(14), FY + 2, Z(28), OAK_SLAB);
  put(chunk, baseX, baseZ, X(14), FY + 2, Z(29), OAK_SLAB);
  put(chunk, baseX, baseZ, X(16), FY + 1, Z(26), LOG);
  put(chunk, baseX, baseZ, X(16), FY + 1, Z(30), HAY);

  // The grove: four oaks flanking the end of the route, plus stumps. Trees
  // sit off the routeline so workers never collide with a trunk.
  emitTree(chunk, baseX, baseZ, X(31), Z(25));
  emitTree(chunk, baseX, baseZ, X(36), Z(26));
  emitTree(chunk, baseX, baseZ, X(31), Z(31));
  emitTree(chunk, baseX, baseZ, X(36), Z(30));
  put(chunk, baseX, baseZ, X(34), FY + 1, Z(25), LOG); // felled stump
  put(chunk, baseX, baseZ, X(33), FY + 1, Z(31), LOG);

  // House pad: a plank-outline foundation with a torch, waiting for tier 1.
  for (let x = HOUSE_X0; x <= HOUSE_X1; x++) {
    for (let z = HOUSE_Z0; z <= HOUSE_Z1; z++) {
      const rim = x === HOUSE_X0 || x === HOUSE_X1 || z === HOUSE_Z0 || z === HOUSE_Z1;
      if (rim) put(chunk, baseX, baseZ, X(x), FY, Z(z), PLANKS);
    }
  }
  put(chunk, baseX, baseZ, X(HOUSE_X0), FY + 1, Z(HOUSE_Z0), TORCH);

  // Plot fence along the avenue edges, with gaps at the claim pad and the
  // shop-wall lane so the plot reads as owned ground without blocking entry.
  for (let x = 8; x <= HEDGE_IN - 2; x++) {
    if (x >= CLAIM_X0 - 1 && x <= CLAIM_X0 + 2) continue; // claim gap
    put(chunk, baseX, baseZ, X(x), FY + 1, Z(4), FENCE);
  }
  for (let z = 8; z <= HEDGE_IN - 2; z++) {
    put(chunk, baseX, baseZ, X(4), FY + 1, Z(z), FENCE);
  }
}

// A compact oak: 4-log trunk, 3x3 leaf crown two deep with a capstone.
function emitTree(chunk, baseX, baseZ, wx, wz) {
  for (let y = FY + 1; y <= FY + 4; y++) put(chunk, baseX, baseZ, wx, y, wz, LOG);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      put(chunk, baseX, baseZ, wx + dx, FY + 4, wz + dz, dx || dz ? LEAVES : LOG);
      put(chunk, baseX, baseZ, wx + dx, FY + 5, wz + dz, LEAVES);
    }
  }
  put(chunk, baseX, baseZ, wx, FY + 6, wz, LEAVES);
}

// ---- Upgrade prefabs ----
// Pure functions returning world-space {x,y,z,id} lists. TycoonMode applies
// them as ordinary edits on the authority. Every tier clears the full build
// volume first (air), then builds — so cumulative edit replay on load leaves
// exactly the newest tier standing.

function clearVolume(out, X, Z, x0, z0, x1, z1, y0, y1) {
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) out.push({ x: X(x), y, z: Z(z), id: 0 });
    }
  }
}

// Mill tiers 2..4. The volume excludes the shop wall (x > SHOP_X) and leaves
// the route mouth at MILL_DOOR_X open.
export function millStamp(plotIndex, tier) {
  const [sx, sz] = SIGNS[plotIndex];
  const X = (x) => sx * x, Z = (z) => sz * z;
  const out = [];
  clearVolume(out, X, Z, MILL_X0, MILL_Z0, MILL_X1, MILL_Z1, FY + 1, FY + 8);

  const wall = (x, z) => x === MILL_X0 || x === MILL_X1 || z === MILL_Z0 || z === MILL_Z1;
  const door = (x, z) => x === MILL_X1 && Math.abs(z - ROUTE_Z) <= 1; // route mouth

  if (tier === 2) {
    // Open shed: log posts on the corners, plank roof, saw table inside.
    for (const [px, pz] of [[MILL_X0, MILL_Z0], [MILL_X0, MILL_Z1], [MILL_X1, MILL_Z0], [MILL_X1, MILL_Z1]]) {
      for (let y = FY + 1; y <= FY + 3; y++) out.push({ x: X(px), y, z: Z(pz), id: LOG });
    }
    for (let x = MILL_X0; x <= MILL_X1; x++) {
      for (let z = MILL_Z0; z <= MILL_Z1; z++) out.push({ x: X(x), y: FY + 4, z: Z(z), id: PLANKS });
    }
    out.push({ x: X(14), y: FY + 1, z: Z(28), id: TABLE });
    out.push({ x: X(16), y: FY + 1, z: Z(26), id: LOG });
    out.push({ x: X(16), y: FY + 1, z: Z(30), id: LOG });
  } else if (tier === 3) {
    // Enclosed plank mill: walls with windows, furnace chimney, torch-lit.
    for (let x = MILL_X0; x <= MILL_X1; x++) {
      for (let z = MILL_Z0; z <= MILL_Z1; z++) {
        if (!wall(x, z)) continue;
        for (let y = FY + 1; y <= FY + 4; y++) {
          if (door(x, z) && y <= FY + 2) continue;
          const window = y === FY + 3 && (x + z) % 3 === 0;
          out.push({ x: X(x), y, z: Z(z), id: window ? GLASS : PLANKS });
        }
      }
    }
    for (let x = MILL_X0; x <= MILL_X1; x++) {
      for (let z = MILL_Z0; z <= MILL_Z1; z++) out.push({ x: X(x), y: FY + 5, z: Z(z), id: OAK_SLAB });
    }
    out.push({ x: X(14), y: FY + 1, z: Z(28), id: TABLE });
    out.push({ x: X(13), y: FY + 1, z: Z(26), id: FURNACE });
    out.push({ x: X(13), y: FY + 1, z: Z(30), id: TORCH });
    for (let y = FY + 5; y <= FY + 7; y++) out.push({ x: X(13), y, z: Z(26), id: STONE });
  } else if (tier === 4) {
    // Two-story timber mill: stone ground floor, plank upper, glass band,
    // stone-slab roof, twin chimneys.
    for (let x = MILL_X0; x <= MILL_X1; x++) {
      for (let z = MILL_Z0; z <= MILL_Z1; z++) {
        if (!wall(x, z)) continue;
        for (let y = FY + 1; y <= FY + 7; y++) {
          if (door(x, z) && y <= FY + 2) continue;
          let id = y <= FY + 3 ? STONE : PLANKS;
          if (y === FY + 5 && (x + z) % 2 === 0) id = GLASS;
          if (y === FY + 3 && (x + z) % 3 === 0) id = PANE;
          out.push({ x: X(x), y, z: Z(z), id });
        }
      }
    }
    for (let x = MILL_X0; x <= MILL_X1; x++) {
      for (let z = MILL_Z0; z <= MILL_Z1; z++) {
        out.push({ x: X(x), y: FY + 4, z: Z(z), id: PLANKS });     // upper floor
        out.push({ x: X(x), y: FY + 8, z: Z(z), id: STONE_SLAB }); // roof
      }
    }
    // Reopen the stairwell gap in the upper floor so the interior reads open.
    out.push({ x: X(15), y: FY + 4, z: Z(28), id: 0 });
    out.push({ x: X(14), y: FY + 1, z: Z(28), id: TABLE });
    out.push({ x: X(13), y: FY + 1, z: Z(26), id: FURNACE });
    out.push({ x: X(13), y: FY + 1, z: Z(30), id: FURNACE });
    for (let y = FY + 8; y <= FY + 10; y++) {
      out.push({ x: X(13), y, z: Z(26), id: STONE });
      out.push({ x: X(13), y, z: Z(30), id: STONE });
    }
  }
  return out;
}

// House tiers 1..3 on the house pad.
export function houseStamp(plotIndex, tier) {
  const [sx, sz] = SIGNS[plotIndex];
  const X = (x) => sx * x, Z = (z) => sz * z;
  const out = [];
  clearVolume(out, X, Z, HOUSE_X0, HOUSE_Z0, HOUSE_X1, HOUSE_Z1, FY + 1, FY + 9);

  const x0 = HOUSE_X0, x1 = HOUSE_X1, z0 = HOUSE_Z0, z1 = HOUSE_Z1;
  const midX = (x0 + x1) >> 1;
  const wall = (x, z) => x === x0 || x === x1 || z === z0 || z === z1;
  const doorAt = (x, z) => x === midX && z === z1; // faces the plot interior

  if (tier === 1) {
    // Hut: 5x5 plank cabin centred on the pad, slab roof, door, torch.
    const hx0 = midX - 2, hx1 = midX + 2, hz0 = z0 + 1, hz1 = z1 - 1;
    for (let x = hx0; x <= hx1; x++) {
      for (let z = hz0; z <= hz1; z++) {
        const hw = x === hx0 || x === hx1 || z === hz0 || z === hz1;
        if (!hw) continue;
        for (let y = FY + 1; y <= FY + 3; y++) {
          if (x === midX && z === hz1 && y <= FY + 2) continue; // doorway
          out.push({ x: X(x), y, z: Z(z), id: PLANKS });
        }
      }
    }
    for (let x = hx0; x <= hx1; x++) {
      for (let z = hz0; z <= hz1; z++) out.push({ x: X(x), y: FY + 4, z: Z(z), id: OAK_SLAB });
    }
    out.push({ x: X(midX), y: FY + 1, z: Z(hz1), id: DOOR_OPEN });
    out.push({ x: X(midX), y: FY + 2, z: Z(hz1), id: DOOR_OPEN });
    out.push({ x: X(midX + 1), y: FY + 3, z: Z(hz1), id: TORCH });
  } else if (tier === 2) {
    // Cottage: full-pad walls, glass windows, gable-ish slab roof, door.
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        if (!wall(x, z)) continue;
        for (let y = FY + 1; y <= FY + 3; y++) {
          if (doorAt(x, z) && y <= FY + 2) continue;
          const window = y === FY + 2 && (x + z) % 3 === 0 && !doorAt(x, z);
          out.push({ x: X(x), y, z: Z(z), id: window ? GLASS : PLANKS });
        }
      }
    }
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const rim = x === x0 || x === x1 || z === z0 || z === z1;
        out.push({ x: X(x), y: FY + 4, z: Z(z), id: rim ? OAK_SLAB : PLANKS });
      }
    }
    for (let x = x0 + 1; x <= x1 - 1; x++) {
      for (let z = z0 + 1; z <= z1 - 1; z++) out.push({ x: X(x), y: FY + 5, z: Z(z), id: OAK_SLAB });
    }
    out.push({ x: X(midX), y: FY + 1, z: Z(z1), id: DOOR_OPEN });
    out.push({ x: X(midX), y: FY + 2, z: Z(z1), id: DOOR_OPEN });
    out.push({ x: X(midX - 1), y: FY + 3, z: Z(z1), id: TORCH });
    out.push({ x: X(midX + 1), y: FY + 3, z: Z(z1), id: TORCH });
  } else if (tier === 3) {
    // Manor: stone ground floor, plank upper floor, pane windows, slab roof,
    // glow-lit porch.
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        if (!wall(x, z)) continue;
        for (let y = FY + 1; y <= FY + 6; y++) {
          if (doorAt(x, z) && y <= FY + 2) continue;
          let id = y <= FY + 3 ? STONE : PLANKS;
          if ((y === FY + 2 || y === FY + 5) && (x + z) % 3 === 0 && !doorAt(x, z)) id = PANE;
          out.push({ x: X(x), y, z: Z(z), id });
        }
      }
    }
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        out.push({ x: X(x), y: FY + 4, z: Z(z), id: PLANKS });   // upper floor
        out.push({ x: X(x), y: FY + 7, z: Z(z), id: STONE_SLAB }); // roof
      }
    }
    out.push({ x: X(midX), y: FY + 4, z: Z((z0 + z1) >> 1), id: 0 }); // stair gap
    out.push({ x: X(midX), y: FY + 1, z: Z(z1), id: DOOR_OPEN });
    out.push({ x: X(midX), y: FY + 2, z: Z(z1), id: DOOR_OPEN });
    out.push({ x: X(midX - 1), y: FY + 1, z: Z(z1 + 1), id: GLOW });
    out.push({ x: X(midX + 1), y: FY + 1, z: Z(z1 + 1), id: GLOW });
  }
  return out;
}

// ---- Spawns ----

// Everyone starts on the hub plaza; index fans out along the avenues so no
// two players share a cell.
export function playerSpawns(n) {
  const out = [];
  const spots = [[3, 0], [-3, 0], [0, 3], [0, -3], [3, 3], [-3, -3], [3, -3], [-3, 3]];
  for (let i = 0; i < n; i++) {
    const [x, z] = spots[i % spots.length];
    out.push({ x: x + 0.5, y: FY + 1, z: z + 0.5 });
  }
  return out;
}

export function lobbySpawn() { return { x: 0.5, y: FY + 1, z: 0.5 }; }

// Contract stubs (Prop Hunt / Zombies helpers — Tycoon never calls these).
export function seekerSpawn() { return lobbySpawn(); }
export function hiderSpawns(n) { return playerSpawns(n); }
export function zombieGates() { return []; }
