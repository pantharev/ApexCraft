import { CHUNK_SIZE } from '../../../config.js';
import { mulberry32, getSeed } from '../../noise.js';
import { getBlockId } from '../../../blocks/BlockRegistry.js';
import { FLOOR_Y, put, fillBox, chunkOutside, cellHash } from '../lib.js';

// "Castle Dracul" — a brooding fortress map for Prop Hunt. A crenellated
// curtain wall with a walkable parapet and four hollow corner towers encloses
// a courtyard (the seeker pen), a great-hall keep, a stable and smithy
// lean-to, and a west graveyard whose mausoleum hides a ladder down into a
// glow-lit crypt. The parapets and crypt are human territory — seeker bots
// can't climb, so their patrol stays on the main floor.
//
// Layout is fully deterministic; only the loose prop scatter and which graves
// exist vary by seed. Weathering (mossy stone) is a per-cell hash so every
// chunk stamps identically.

export const id = 'castle';
export const name = 'Castle Dracul';
export const desc = 'Walls, crypt & graveyard';
export const half = 44;            // map spans [-44, 44] on X and Z
export const baseSurface = 'grass';

// Blocks hiders can disguise as — each occurs naturally around the castle.
export const propBlocks = ['mossy_cobblestone', 'chest', 'furnace', 'hay_bale', 'crafting_table', 'pumpkin'];

const STONE = getBlockId('stone');
const ANDESITE = getBlockId('andesite');
const MOSSY = getBlockId('mossy_cobblestone');
const STONE_SLAB = getBlockId('stone_slab');
const OAK_SLAB = getBlockId('oak_slab');
const PLANKS = getBlockId('oak_planks');
const LOG = getBlockId('oak_log');
const FENCE = getBlockId('fence');
const LADDER = getBlockId('ladder');
const PANE = getBlockId('glass_pane');
const DOOR_OPEN = getBlockId('door_open');
const LAVA = getBlockId('lava');
const DIRT = getBlockId('dirt');
const GRASS = getBlockId('grass');
const GRAVEL = getBlockId('gravel');
const WATER = getBlockId('water');
const HAY = getBlockId('hay_bale');
const PUMPKIN = getBlockId('pumpkin');
const CHEST = getBlockId('chest');
const FURNACE = getBlockId('furnace');
const TABLE = getBlockId('crafting_table');
const WOOL = getBlockId('wool');
const GLOW = getBlockId('glow_mushroom');
const POPPY = getBlockId('poppy');
const TALL_GRASS = getBlockId('tall_grass');
const STAIR_PZ = getBlockId('oak_stairs_pz');
const STAIR_NZ = getBlockId('oak_stairs_nz');

const FY = FLOOR_Y;                // grass floor level (64)
const PEN_R = 8;                   // seeker pen radius at the origin (Chebyshev)

// Curtain wall rings (Chebyshev radius): inner carries the wall-walk, outer
// the crenellations. Towers overwrite the corners.
const WALL_IN = 43, WALL_OUT = 44;
const WALL_TOP = FY + 8;           // solid stone up to here (h≈9 with the crown)

// Keep footprint (great hall) along the north wall.
const KEEP = { x0: -10, z0: -34, x1: 10, z1: -22 };
// West graveyard enclosure.
const YARD = { x0: -38, z0: 10, x1: -16, z1: 34 };
// Mausoleum cell (ladder shaft down to the crypt).
const MAUS = { x: -27, z: 20 };
// Crypt interior (carved out of the solid understone), floor at CRYPT_Y.
const CRYPT = { x0: -34, z0: 16, x1: -20, z1: 24 };
const CRYPT_Y = 59;                // interior air y59..61 (floor 58, roof 62)

// ~30% deterministic mossy weathering, varying per cell (not just per column).
const masonry = (wx, wy, wz) => (cellHash(wx + wy * 57, wz - wy * 31) < 0.3 ? MOSSY : STONE);

// Seed-varied bits: loose prop scatter + which graves exist.
let _layout = null;
let _layoutSeed = null;

function layout() {
  const seed = getSeed();
  if (_layout && _layoutSeed === seed) return _layout;
  const rng = mulberry32((seed ^ 0xd4ac01) >>> 0);

  // Graves: rows through the yard, some skipped so seeds read differently.
  const graves = [];
  for (let gx = YARD.x0 + 3; gx <= YARD.x1 - 3; gx += 4) {
    for (let gz = YARD.z0 + 3; gz <= YARD.z1 - 4; gz += 6) {
      if (Math.abs(gx - MAUS.x) <= 2 && Math.abs(gz - MAUS.z) <= 3) continue; // mausoleum plot
      if (rng() < 0.3) continue;
      graves.push({ x: gx, z: gz });
    }
  }

  // Loose disguise props in the courtyard (never in the pen or on paths).
  const ids = propBlocks.map(getBlockId);
  const props = [];
  for (let i = 0; i < 120 && props.length < 22; i++) {
    const x = Math.floor((rng() * 2 - 1) * (half - 5));
    const z = Math.floor((rng() * 2 - 1) * (half - 5));
    if (Math.max(Math.abs(x), Math.abs(z)) <= PEN_R + 2) continue;       // pen
    if (Math.abs(x) <= 2 && z > 0) continue;                              // gate path
    if (x >= KEEP.x0 - 1 && x <= KEEP.x1 + 1 && z >= KEEP.z0 - 1 && z <= KEEP.z1 + 1) continue;
    if (x >= YARD.x0 && x <= YARD.x1 && z >= YARD.z0 && z <= YARD.z1) continue;
    if (Math.max(Math.abs(x), Math.abs(z)) >= WALL_IN - 1) continue;      // wall footing
    props.push({ x, z, block: ids[Math.floor(rng() * ids.length)] });
  }

  _layout = { graves, props };
  _layoutSeed = seed;
  return _layout;
}

// Stamp the whole castle into this chunk.
export function generate(chunk) {
  if (chunkOutside(chunk, half)) return;
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const L = layout();

  groundPass(chunk, baseX, baseZ);
  emitWall(chunk, baseX, baseZ);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) emitTower(chunk, sx, sz, baseX, baseZ);
  emitGatehouse(chunk, baseX, baseZ);
  emitKeep(chunk, baseX, baseZ);
  emitWell(chunk, 12, 8, baseX, baseZ);
  emitStable(chunk, baseX, baseZ);
  emitSmithy(chunk, baseX, baseZ);
  emitGraveyard(chunk, L, baseX, baseZ);
  emitCrypt(chunk, baseX, baseZ);
  for (const p of L.props) put(chunk, baseX, baseZ, p.x, FY + 1, p.z, p.block);
  emitFlora(chunk, baseX, baseZ);
}

// Courtyard paving: patchy stone/mossy pen at the centre, a gravel way from
// the gate to the pen and on to the keep's door.
function groundPass(chunk, baseX, baseZ) {
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wx = baseX + lx, wz = baseZ + lz;
      if (Math.abs(wx) > half || Math.abs(wz) > half) continue;
      const r = cellHash(wx, wz);
      if (Math.max(Math.abs(wx), Math.abs(wz)) <= PEN_R) {
        // Patchy paving: mostly stone, mossy veins, the odd worn grass gap.
        if (r < 0.28) chunk.set(lx, FY, lz, MOSSY);
        else if (r < 0.85) chunk.set(lx, FY, lz, STONE);
      } else if (Math.abs(wx) <= 1 && wz > PEN_R && wz < WALL_IN) {
        chunk.set(lx, FY, lz, GRAVEL);            // gate way
      } else if (Math.abs(wx) <= 1 && wz < -PEN_R && wz > KEEP.z1) {
        chunk.set(lx, FY, lz, GRAVEL);            // way to the keep door
      }
    }
  }
}

// Crenellated 2-thick curtain wall with a slab wall-walk on the inner course
// and ladders up at the north/east/west midpoints (south is the gatehouse).
function emitWall(chunk, baseX, baseZ) {
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wx = baseX + lx, wz = baseZ + lz;
      const r = Math.max(Math.abs(wx), Math.abs(wz));
      if (r < WALL_IN || r > WALL_OUT) continue;
      if (Math.abs(wx) >= 38 && Math.abs(wz) >= 38) continue; // towers own the corners
      // Gate opening (south): the gatehouse emitter shapes this stretch.
      if (wz === WALL_IN || wz === WALL_OUT) {
        if (wz > 0 && wx >= -2 && wx <= 1) continue;
      }
      for (let y = FY + 1; y <= WALL_TOP; y++) chunk.set(lx, y, lz, masonry(wx, y, wz));
      if (r === WALL_IN) {
        chunk.set(lx, WALL_TOP + 1, lz, STONE_SLAB);           // wall-walk
      } else if (((wx + wz) & 1) === 0) {
        chunk.set(lx, WALL_TOP + 1, lz, masonry(wx, WALL_TOP + 1, wz)); // merlons
      }
    }
  }
  // Ladders up to the wall-walk, hung on the inner face at the midpoints.
  // They end level with the walk — the climb's feet-check + momentum carries
  // players over the lip, Minecraft-style.
  for (const [x, z] of [[0, -(WALL_IN - 1)], [WALL_IN - 1, 0], [-(WALL_IN - 1), 0]]) {
    for (let y = FY + 1; y <= WALL_TOP + 1; y++) put(chunk, baseX, baseZ, x, y, z, LADDER);
  }
}

// Hollow 7×7 corner tower: solid shell to h≈15 with pane arrow slits, an
// interior ladder to the open crenellated top, and a doorway to the courtyard.
function emitTower(chunk, sx, sz, baseX, baseZ) {
  const x0 = sx > 0 ? 38 : -44, x1 = sx > 0 ? 44 : -38;
  const z0 = sz > 0 ? 38 : -44, z1 = sz > 0 ? 44 : -38;
  const top = FY + 14;                      // roof floor sits here (h≈15)
  const cx = (x0 + x1) >> 1, cz = (z0 + z1) >> 1;
  // Doorway on the courtyard-facing corner cell of the shell.
  const doorX = sx > 0 ? x0 : x1;
  // Ladder cell in the interior corner nearest the courtyard, flush against
  // the shell so the mesher hangs it on a solid wall.
  const ladX = cx - 2 * sx, ladZ = cz - 2 * sz;

  const wxA = Math.max(x0, baseX), wxB = Math.min(x1, baseX + CHUNK_SIZE - 1);
  const wzA = Math.max(z0, baseZ), wzB = Math.min(z1, baseZ + CHUNK_SIZE - 1);
  for (let wx = wxA; wx <= wxB; wx++) {
    for (let wz = wzA; wz <= wzB; wz++) {
      const lx = wx - baseX, lz = wz - baseZ;
      const shell = wx === x0 || wx === x1 || wz === z0 || wz === z1;
      chunk.set(lx, FY, lz, STONE);         // stone footing replaces grass
      for (let y = FY + 1; y <= top; y++) {
        let bid = 0;
        if (shell) {
          bid = masonry(wx, y, wz);
          // Doorway to the courtyard at ground level.
          if (wx === doorX && wz === cz && y <= FY + 2) bid = 0;
          // Arrow slits on the two outward faces, at watch heights.
          const outward = (sx > 0 ? wx === x1 : wx === x0) || (sz > 0 ? wz === z1 : wz === z0);
          if (outward && (wx === cx || wz === cz) && (y === FY + 5 || y === FY + 10)) bid = PANE;
        }
        chunk.set(lx, y, lz, bid);
      }
      // Open crenellated top: floor slab-height stone, merlons on the rim.
      chunk.set(lx, top, lz, STONE);
      if (shell && ((wx + wz) & 1) === 0) chunk.set(lx, top + 1, lz, masonry(wx, top + 1, wz));
      if (wx === ladX && wz === ladZ) {
        chunk.set(lx, top, lz, 0);          // hatch in the roof floor
        for (let y = FY + 1; y <= top; y++) chunk.set(lx, y, lz, LADDER);
      }
    }
  }
  // Ground-floor furnishing in the far interior corner (more honest prop
  // sightings for disguised hiders to blend against).
  const gear = { '1,1': TABLE, '1,-1': CHEST, '-1,1': HAY, '-1,-1': FURNACE }[`${sx},${sz}`];
  put(chunk, baseX, baseZ, cx + 2 * sx, FY + 1, cz + 2 * sz, gear);
}

// South gatehouse: a 4-wide arch through the wall, a fence portcullis with
// walk-through gaps, and recessed fence-guarded lava trenches flanking the
// entry — gen-time torches never light, so the gate glows molten instead.
function emitGatehouse(chunk, baseX, baseZ) {
  // Arch: opening y≤FY+4, stone above (the wall pass leaves this stretch empty).
  for (let x = -3; x <= 2; x++) {
    for (let z = WALL_IN; z <= WALL_OUT; z++) {
      for (let y = FY + 1; y <= WALL_TOP; y++) {
        const rim = x === -3 || x === 2;
        if (rim || y > FY + 4) put(chunk, baseX, baseZ, x, y, z, masonry(x, y, z));
      }
      put(chunk, baseX, baseZ, x, WALL_TOP + 1, z, z === WALL_IN ? STONE_SLAB : ((x + z) & 1) === 0 ? STONE : 0);
      put(chunk, baseX, baseZ, x, FY, z, GRAVEL); // threshold
    }
  }
  // Portcullis: fence bars across the outer arch, gaps at x = -1 and 1.
  for (const x of [-2, 0]) {
    for (let y = FY + 1; y <= FY + 4; y++) put(chunk, baseX, baseZ, x, y, WALL_OUT, FENCE);
  }
  // Lava trenches flanking the entry, sunk one block and fence-railed.
  for (const side of [-1, 1]) {
    for (let z = 39; z <= 41; z++) {
      const x = side * 5;
      put(chunk, baseX, baseZ, x, FY, z, LAVA);          // recessed molten light
      put(chunk, baseX, baseZ, x, FY - 1, z, STONE);     // sealed basin
      put(chunk, baseX, baseZ, x - side, FY + 1, z, FENCE); // rail on the path side
    }
    put(chunk, baseX, baseZ, side * 5, FY + 1, 38, FENCE);  // end rails
    put(chunk, baseX, baseZ, side * 5, FY + 1, 42, FENCE);
  }
}

// The keep: a stone great hall with andesite corners, pane windows, a slab
// lid, a dais throne, a long dining table, and a kitchen along the west wall.
function emitKeep(chunk, baseX, baseZ) {
  const { x0, z0, x1, z1 } = KEEP;
  const top = FY + 8;
  const wxA = Math.max(x0, baseX), wxB = Math.min(x1, baseX + CHUNK_SIZE - 1);
  const wzA = Math.max(z0, baseZ), wzB = Math.min(z1, baseZ + CHUNK_SIZE - 1);
  for (let wx = wxA; wx <= wxB; wx++) {
    for (let wz = wzA; wz <= wzB; wz++) {
      const lx = wx - baseX, lz = wz - baseZ;
      const onX = wx === x0 || wx === x1;
      const onZ = wz === z0 || wz === z1;
      const corner = onX && onZ;
      chunk.set(lx, FY, lz, STONE); // hall floor
      for (let y = FY + 1; y <= top; y++) {
        let bid = 0;
        if (onX || onZ) {
          bid = corner ? ANDESITE : masonry(wx, y, wz);
          // Grand door on the courtyard face.
          if (wz === z1 && (wx === 0 || wx === -1) && y <= FY + 3) bid = 0;
          // Pane windows down both long faces (modulo kept positive so the
          // west half gets its windows too).
          if (onZ && !corner && y === FY + 3 && ((wx % 4) + 4) % 4 === 2) bid = PANE;
          if (onX && !corner && y === FY + 3 && ((wz % 4) + 4) % 4 === 0) bid = PANE;
        }
        chunk.set(lx, y, lz, bid);
      }
      chunk.set(lx, top + 1, lz, STONE_SLAB); // lid
    }
  }

  // Throne on a raised dais at the north end.
  fillBox(chunk, baseX, baseZ, -1, FY + 1, z0 + 1, 1, FY + 1, z0 + 2, STONE);
  put(chunk, baseX, baseZ, 0, FY + 2, z0 + 1, WOOL);
  for (let x = -1; x <= 1; x++) put(chunk, baseX, baseZ, x, FY + 1, z0 + 3, STONE_SLAB); // step
  // Dining table: fence legs, slab top, stair chairs down both sides.
  for (let x = -4; x <= 2; x++) {
    if (x === -4 || x === 2) put(chunk, baseX, baseZ, x, FY + 1, -28, FENCE);
    put(chunk, baseX, baseZ, x, FY + 2, -28, OAK_SLAB);
    if ((x & 1) === 0) {
      put(chunk, baseX, baseZ, x, FY + 1, -29, STAIR_PZ);
      put(chunk, baseX, baseZ, x, FY + 1, -27, STAIR_NZ);
    }
  }
  // Kitchen along the west wall: furnaces, worktable, larder chests, hay sacks.
  put(chunk, baseX, baseZ, x0 + 1, FY + 1, -30, FURNACE);
  put(chunk, baseX, baseZ, x0 + 1, FY + 1, -29, FURNACE);
  put(chunk, baseX, baseZ, x0 + 1, FY + 1, -27, TABLE);
  put(chunk, baseX, baseZ, x0 + 1, FY + 1, z0 + 1, CHEST);
  put(chunk, baseX, baseZ, x0 + 2, FY + 1, z0 + 1, CHEST);
  put(chunk, baseX, baseZ, x0 + 1, FY + 1, z1 - 1, HAY);
  put(chunk, baseX, baseZ, x0 + 2, FY + 1, z1 - 1, HAY);
  put(chunk, baseX, baseZ, x0 + 1, FY + 2, z1 - 1, HAY);
}

// Mossy courtyard well (same bones as the town well, weathered harder).
function emitWell(chunk, wxC, wzC, baseX, baseZ) {
  for (let rx = -2; rx <= 2; rx++) {
    for (let rz = -2; rz <= 2; rz++) {
      const wx = wxC + rx, wz = wzC + rz;
      const lx = wx - baseX, lz = wz - baseZ;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
      const ring = Math.max(Math.abs(rx), Math.abs(rz)) === 2;
      const post = Math.abs(rx) === 2 && Math.abs(rz) === 2;
      if (ring) {
        const stone = cellHash(wx, wz) < 0.5 ? MOSSY : STONE;
        chunk.set(lx, FY, lz, stone);
        chunk.set(lx, FY + 1, lz, post ? stone : FENCE);
        chunk.set(lx, FY + 2, lz, post ? MOSSY : 0);
      } else {
        chunk.set(lx, FY - 1, lz, STONE);
        chunk.set(lx, FY, lz, WATER);
      }
      chunk.set(lx, FY + 3, lz, PLANKS);
    }
  }
}

// Stable lean-to against the east wall: log posts, slab roof, hay inside.
function emitStable(chunk, baseX, baseZ) {
  for (let z = -6; z <= 2; z++) {
    for (let x = 37; x <= 41; x++) put(chunk, baseX, baseZ, x, FY + 4, z, OAK_SLAB); // roof
  }
  for (const z of [-6, 2]) {
    for (let y = FY + 1; y <= FY + 3; y++) put(chunk, baseX, baseZ, 37, y, z, LOG);
  }
  put(chunk, baseX, baseZ, 39, FY + 1, -5, HAY);
  put(chunk, baseX, baseZ, 40, FY + 1, -5, HAY);
  put(chunk, baseX, baseZ, 40, FY + 2, -5, HAY);
  put(chunk, baseX, baseZ, 40, FY + 1, 0, HAY);
  put(chunk, baseX, baseZ, 39, FY + 1, 1, CHEST);
  put(chunk, baseX, baseZ, 40, FY + 1, 1, TABLE); // tack bench
  for (const z of [-3, -1]) put(chunk, baseX, baseZ, 37, FY + 1, z, FENCE); // hitch rail
}

// Smithy lean-to against the west wall: twin furnaces, bench, scrap chest.
function emitSmithy(chunk, baseX, baseZ) {
  for (let z = -4; z <= 2; z++) {
    for (let x = -41; x <= -37; x++) put(chunk, baseX, baseZ, x, FY + 4, z, STONE_SLAB); // roof
  }
  for (const z of [-4, 2]) {
    for (let y = FY + 1; y <= FY + 3; y++) put(chunk, baseX, baseZ, -37, y, z, ANDESITE);
  }
  put(chunk, baseX, baseZ, -40, FY + 1, -3, FURNACE);
  put(chunk, baseX, baseZ, -40, FY + 1, -2, FURNACE);
  put(chunk, baseX, baseZ, -40, FY + 1, 0, TABLE);
  put(chunk, baseX, baseZ, -40, FY + 1, 1, CHEST);
}

// West graveyard: fenced plot of dirt mounds and slab headstones, a pumpkin
// patch, bare dead trees, and the mausoleum over the crypt shaft.
function emitGraveyard(chunk, L, baseX, baseZ) {
  const { x0, z0, x1, z1 } = YARD;
  // Fence with a gate gap mid-east (toward the courtyard).
  for (let x = x0; x <= x1; x++) {
    put(chunk, baseX, baseZ, x, FY + 1, z0, FENCE);
    put(chunk, baseX, baseZ, x, FY + 1, z1, FENCE);
  }
  for (let z = z0; z <= z1; z++) {
    put(chunk, baseX, baseZ, x0, FY + 1, z, FENCE);
    if (Math.abs(z - (z0 + z1) / 2) > 1) put(chunk, baseX, baseZ, x1, FY + 1, z, FENCE);
  }

  // Graves: slab headstone with a low dirt mound stretching south of it.
  for (const g of L.graves) {
    put(chunk, baseX, baseZ, g.x, FY + 1, g.z, STONE_SLAB);
    put(chunk, baseX, baseZ, g.x, FY, g.z + 1, DIRT);
    put(chunk, baseX, baseZ, g.x, FY, g.z + 2, DIRT);
    if (cellHash(g.x, g.z) < 0.4) put(chunk, baseX, baseZ, g.x + 1, FY + 1, g.z + 1, POPPY);
  }

  // Pumpkin patch in the south-east corner of the yard.
  for (let x = x1 - 5; x <= x1 - 1; x++) {
    for (let z = z1 - 4; z <= z1 - 1; z++) {
      const r = cellHash(x, z);
      if (r < 0.35) { put(chunk, baseX, baseZ, x, FY, z, DIRT); put(chunk, baseX, baseZ, x, FY + 1, z, PUMPKIN); }
    }
  }

  // Dead trees: bare log trunks with one crooked arm.
  for (const [tx, tz, h] of [[x0 + 3, z0 + 3, 5], [x1 - 3, z0 + 4, 4], [x0 + 4, z1 - 3, 5]]) {
    for (let y = FY + 1; y <= FY + h; y++) put(chunk, baseX, baseZ, tx, y, tz, LOG);
    put(chunk, baseX, baseZ, tx + 1, FY + h - 1, tz, LOG);
    put(chunk, baseX, baseZ, tx, FY, tz, DIRT);
  }

  // Mausoleum: a stone vault with the ladder shaft down into the crypt.
  for (let x = MAUS.x - 2; x <= MAUS.x + 2; x++) {
    for (let z = MAUS.z - 2; z <= MAUS.z + 2; z++) {
      const shell = Math.abs(x - MAUS.x) === 2 || Math.abs(z - MAUS.z) === 2;
      for (let y = FY + 1; y <= FY + 3; y++) {
        let bid = shell ? masonry(x, y, z) : 0;
        if (x === MAUS.x && z === MAUS.z + 2 && y <= FY + 2) bid = 0; // south doorway
        put(chunk, baseX, baseZ, x, y, z, bid);
      }
      put(chunk, baseX, baseZ, x, FY + 4, z, STONE_SLAB);
      if (!shell) put(chunk, baseX, baseZ, x, FY, z, STONE); // vault floor
    }
  }
}

// The crypt: a low vault carved from the understone, reached by the mausoleum
// shaft. Slab coffins, grave-goods chests, and glow mushrooms for the only
// light — gen-time light has to ride chunk.lights (the glow pool), like cave
// flora does.
function emitCrypt(chunk, baseX, baseZ) {
  const { x0, z0, x1, z1 } = CRYPT;
  // Hollow the vault (walls/floor/ceiling stay natural understone).
  fillBox(chunk, baseX, baseZ, x0, CRYPT_Y, z0, x1, CRYPT_Y + 2, z1, 0);

  // Ladder shaft from the mausoleum floor down to the vault, with a stone
  // pillar beside it inside the vault so the ladder has a wall to hang on.
  fillBox(chunk, baseX, baseZ, MAUS.x, CRYPT_Y, MAUS.z - 1, MAUS.x, CRYPT_Y + 2, MAUS.z - 1, STONE);
  for (let y = CRYPT_Y; y <= FY; y++) {
    put(chunk, baseX, baseZ, MAUS.x, y, MAUS.z, LADDER);
  }

  // Coffins: paired slabs in two rows, headstones toward the walls.
  for (const cx of [x0 + 2, x0 + 6, x0 + 10]) {
    for (const cz of [z0 + 2, z1 - 3]) {
      if (Math.abs(cx - MAUS.x) <= 1 && Math.abs(cz - MAUS.z) <= 2) continue; // keep the shaft clear
      put(chunk, baseX, baseZ, cx, CRYPT_Y, cz, STONE_SLAB);
      put(chunk, baseX, baseZ, cx, CRYPT_Y, cz + 1, STONE_SLAB);
    }
  }
  put(chunk, baseX, baseZ, x1 - 1, CRYPT_Y, z0 + 1, CHEST);
  put(chunk, baseX, baseZ, x0 + 1, CRYPT_Y, z1 - 1, CHEST);

  // Five glow mushrooms — near-dark vault, lit only by the glow pool.
  const glows = [
    [x0 + 1, z0 + 1], [x1 - 1, z1 - 1], [x0 + 1, z1 - 1], [x1 - 1, z0 + 1], [MAUS.x + 2, MAUS.z],
  ];
  for (const [gx, gz] of glows) {
    const lx = gx - baseX, lz = gz - baseZ;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
    chunk.set(lx, CRYPT_Y, lz, GLOW);
    if (!chunk.lights) chunk.lights = [];
    chunk.lights.push([gx, CRYPT_Y, gz]);
  }
}

// Tufts and flowers on the untouched courtyard grass.
function emitFlora(chunk, baseX, baseZ) {
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wx = baseX + lx, wz = baseZ + lz;
      if (Math.abs(wx) >= half || Math.abs(wz) >= half) continue;
      const r = cellHash(wx, wz);
      if (r >= 0.06) continue;
      if (chunk.get(lx, FY, lz) !== GRASS || chunk.get(lx, FY + 1, lz) !== 0) continue;
      chunk.set(lx, FY + 1, lz, r < 0.045 ? TALL_GRASS : POPPY);
    }
  }
}

// ---- Spawns ----

// Hider drop-offs: yards, corners, and the odd sneaky nook; they relocate
// during the hide phase anyway.
const HIDER_SPOTS = [
  { x: -30, z: 28 },  // graveyard, among the graves
  { x: -27, z: 24 },  // mausoleum door
  { x: -22, z: 13 },  // graveyard north fence
  { x: 5, z: -28 },   // inside the keep
  { x: -6, z: -37 },  // behind the keep
  { x: 40, z: 40 },   // SE tower ground floor
  { x: -40, z: -40 }, // NW tower ground floor
  { x: 39, z: -2 },   // in the stable
  { x: -39, z: 1 },   // by the smithy
  { x: 0, z: 36 },    // inside the gate
  { x: 12, z: 11 },   // behind the well
  { x: 28, z: -30 },  // NE courtyard
];

// Seekers pen at the courtyard centre. Golden-angle spiral so no two indexes
// ever share a cell, whatever the roster size.
export function seekerSpawn(i = 0) {
  const a = i * 2.399963;
  const r = Math.min(PEN_R - 2, 1.5 + i * 0.35);
  return { x: Math.cos(a) * r + 0.5, y: FY + 1, z: Math.sin(a) * r + 0.5 };
}

export function hiderSpawns(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = HIDER_SPOTS[i % HIDER_SPOTS.length];
    const k = Math.floor(i / HIDER_SPOTS.length);
    out.push({ x: s.x + k + 0.5, y: FY + 1, z: s.z + 0.5 });
  }
  return out;
}

export function lobbySpawn() { return { x: 0.5, y: FY + 1, z: 0.5 }; }

// Seeker-bot patrol waypoints — main floor only (bots can't climb ladders, so
// the parapets, tower tops, and crypt stay human hiding territory).
export const botSpots = [
  { x: 0, z: 0 }, { x: 0, z: 30 },     // pen + gate approach
  { x: 0, z: -18 },                     // keep door
  { x: 5, z: -28 },                     // inside the keep
  { x: -14, z: 22 },                    // graveyard gate
  { x: -27, z: 28 },                    // graveyard rows
  { x: 34, z: -2 },                     // stable front
  { x: -34, z: -1 },                    // smithy front
  { x: 12, z: 12 },                     // well
  { x: 28, z: 28 }, { x: -28, z: -28 }, // far corners
  { x: 28, z: -28 },
];
