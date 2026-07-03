import { CHUNK_SIZE } from '../../../config.js';
import { mulberry32, getSeed } from '../../noise.js';
import { getBlockId } from '../../../blocks/BlockRegistry.js';
import { FLOOR_Y, put, fillBox, chunkOutside, cellHash } from '../lib.js';

// "The Playroom" — a Prop Hunt map where everyone is mouse-sized inside a
// giant child's bedroom (~7× furniture scale). An enclosed shell: floorboards,
// sandstone wainscot under wool wallpaper, and a beamed glass skylight roof
// that daylights the room (skylight is per-column with no horizontal bleed, so
// the todos spec's plank-major ceiling is inverted: plank beams over glass —
// otherwise the floor sits at cave darkness). Shadow pools under the big
// furniture are the natural hiding spots.
//
// Furniture: a giant table (ladder up a leg; fruit bowl + chess set on top),
// two chairs with under-seat crawl spaces, a walkable bookshelf with runs of
// "books", a giant bed with a 2-high under-bed crawl, a fireplace with a
// fence-guarded lava firebox and a mantel, and a toy corner with night lights.
// Bots patrol the floor only — tabletops, shelves, and the mantel are
// ladder-reachable human territory.

export const id = 'playroom';
export const name = 'The Playroom';
export const desc = 'Giant furniture & shadowy crawl spaces';
export const half = 40;             // room spans [-40, 40] on X and Z
export const baseSurface = 'oak_planks';

// Blocks hiders can disguise as — all seeded as toys, books, and clutter.
export const propBlocks = ['wool', 'melon', 'pumpkin', 'hay_bale', 'chest', 'crafting_table', 'chess_table'];

const PLANKS = getBlockId('oak_planks');
const LOG = getBlockId('oak_log');
const GLASS = getBlockId('glass');
const SANDSTONE = getBlockId('sandstone');
const STONE = getBlockId('stone');
const STONE_SLAB = getBlockId('stone_slab');
const OAK_SLAB = getBlockId('oak_slab');
const WOOL = getBlockId('wool');
const SNOW = getBlockId('snow');
const LADDER = getBlockId('ladder');
const FENCE = getBlockId('fence');
const LAVA = getBlockId('lava');
const HAY = getBlockId('hay_bale');
const MELON = getBlockId('melon');
const PUMPKIN = getBlockId('pumpkin');
const CHEST = getBlockId('chest');
const TABLE = getBlockId('crafting_table');
const CHESS = getBlockId('chess_table');
const GLOW = getBlockId('glow_mushroom');

const FY = FLOOR_Y;
const CEIL = FY + 26;               // roof plane (walls h≈26)
const RUG = { x0: -10, z0: -7, x1: 9, z1: 6 };  // 20×14 wool rug = seeker pen

// Giant table (NE of the rug): 22×16 plank top on 3×3 log legs.
const TAB = { x0: 9, z0: -22, x1: 30, z1: -7, topY: FY + 11 };
// Two chairs south of the table, mirrored across x=0.
const CHAIRS = [{ cx: 14 }, { cx: -14 }];
const CHAIR_Z = { z0: 0, z1: 8 };   // 9-deep seat, backrest on the south edge
// Bookshelf against the north wall.
const SHELF = { x0: -32, z0: -39, x1: -9, z1: -36, boards: [FY + 4, FY + 9, FY + 14, FY + 19] };
// Giant bed along the west wall.
const BED = { x0: -39, z0: 14, x1: -22, z1: 24 };
// Fireplace chimney on the east wall.
const FIRE = { x0: 36, z0: -3, x1: 39, z1: 3 };
// Toy corner (SE).
const TOY = { x0: 20, z0: 20, x1: 36, z1: 36 };

// Seed-varied clutter: toy blocks in the corner + floor prop scatter.
let _layout = null;
let _layoutSeed = null;

function layout() {
  const seed = getSeed();
  if (_layout && _layoutSeed === seed) return _layout;
  const rng = mulberry32((seed ^ 0x91a7c3) >>> 0);

  // Never drop seeded clutter onto a spawn point or bot waypoint — a hider
  // materialising inside a melon is a bad start to a round.
  const spots = [...HIDER_SPOTS, ...botSpots];
  const nearSpot = (x, z) => spots.some((s) => Math.abs(x - s.x) <= 1 && Math.abs(z - s.z) <= 1);

  // Toy blocks: scattered single/stacked cubes in the toy corner.
  const toyIds = [WOOL, SANDSTONE, PLANKS, MELON, PUMPKIN];
  const toys = [];
  for (let i = 0; i < 40 && toys.length < 14; i++) {
    const x = TOY.x0 + Math.floor(rng() * (TOY.x1 - TOY.x0 - 8)); // keep clear of the castle
    const z = TOY.z0 + Math.floor(rng() * (TOY.z1 - TOY.z0));
    if (x >= 27 && z >= 26) continue; // toy castle plot
    if (nearSpot(x, z)) continue;
    toys.push({ x, z, block: toyIds[Math.floor(rng() * toyIds.length)], tall: rng() < 0.3 });
  }

  // Loose floor props (never on the rug or inside furniture footprints).
  const rects = [RUG, TAB, SHELF, BED, FIRE,
    ...CHAIRS.map((c) => ({ x0: c.cx - 4, z0: CHAIR_Z.z0, x1: c.cx + 4, z1: CHAIR_Z.z1 }))];
  const inRect = (x, z) => rects.some((r) => x >= r.x0 - 1 && x <= r.x1 + 1 && z >= r.z0 - 1 && z <= r.z1 + 1);
  const ids = propBlocks.map(getBlockId);
  const props = [];
  for (let i = 0; i < 140 && props.length < 24; i++) {
    const x = Math.floor((rng() * 2 - 1) * (half - 3));
    const z = Math.floor((rng() * 2 - 1) * (half - 3));
    if (inRect(x, z) || nearSpot(x, z)) continue;
    props.push({ x, z, block: ids[Math.floor(rng() * ids.length)] });
  }

  _layout = { toys, props };
  _layoutSeed = seed;
  return _layout;
}

export function generate(chunk) {
  if (chunkOutside(chunk, half)) return;
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const L = layout();

  emitShell(chunk, baseX, baseZ);
  emitRug(chunk, baseX, baseZ);
  emitTable(chunk, baseX, baseZ);
  for (const c of CHAIRS) emitChair(chunk, c.cx, baseX, baseZ);
  emitBookshelf(chunk, baseX, baseZ);
  emitBed(chunk, baseX, baseZ);
  emitFireplace(chunk, baseX, baseZ);
  emitToyCorner(chunk, L, baseX, baseZ);
  for (const p of L.props) put(chunk, baseX, baseZ, p.x, FY + 1, p.z, p.block);
}

// Walls (sandstone wainscot under wool wallpaper) + the beamed skylight roof.
function emitShell(chunk, baseX, baseZ) {
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wx = baseX + lx, wz = baseZ + lz;
      if (Math.abs(wx) > half || Math.abs(wz) > half) continue;
      const onWall = Math.abs(wx) === half || Math.abs(wz) === half;
      if (onWall) {
        for (let y = FY + 1; y <= CEIL; y++) {
          chunk.set(lx, y, lz, y <= FY + 4 ? SANDSTONE : y === CEIL ? PLANKS : WOOL);
        }
      } else {
        // Roof: plank beams every 8 rows (2 wide) + a plank trim ring by the
        // walls; everything else is skylight glass so the room stays daylit.
        const beam = ((wz % 8) + 8) % 8 < 2;
        const trim = Math.abs(wx) >= half - 2 || Math.abs(wz) >= half - 2;
        chunk.set(lx, CEIL, lz, beam || trim ? PLANKS : GLASS);
      }
    }
  }
}

// The wool rug at the origin — the seeker pen.
function emitRug(chunk, baseX, baseZ) {
  for (let x = RUG.x0; x <= RUG.x1; x++) {
    for (let z = RUG.z0; z <= RUG.z1; z++) put(chunk, baseX, baseZ, x, FY, z, WOOL);
  }
}

// Giant table: 3×3 log legs (h=10), 22×16 plank top, ladder up the SW leg,
// fruit bowl + a chess set + a workbench on top.
function emitTable(chunk, baseX, baseZ) {
  const { x0, z0, x1, z1, topY } = TAB;
  // Legs at the four corners.
  for (const [lx0, lz0] of [[x0 + 1, z0 + 1], [x1 - 3, z0 + 1], [x0 + 1, z1 - 3], [x1 - 3, z1 - 3]]) {
    fillBox(chunk, baseX, baseZ, lx0, FY + 1, lz0, lx0 + 2, topY - 1, lz0 + 2, LOG);
  }
  // Top slab (one block thick).
  fillBox(chunk, baseX, baseZ, x0, topY, z0, x1, topY, z1, PLANKS);
  // Ladder up the south face of the SW leg, ending level with the top — the
  // topmost cell doubles as a hatch through the tabletop.
  for (let y = FY + 1; y <= topY; y++) put(chunk, baseX, baseZ, x0 + 2, y, z1, LADDER);

  // Fruit bowl: a stone ring with melons and pumpkins heaped inside.
  const bx = 15, bz = -15;
  for (let rx = -2; rx <= 2; rx++) {
    for (let rz = -2; rz <= 2; rz++) {
      const ring = Math.max(Math.abs(rx), Math.abs(rz)) === 2;
      const bid = ring ? STONE : (rx + rz) % 2 === 0 ? MELON : PUMPKIN;
      put(chunk, baseX, baseZ, bx + rx, topY + 1, bz + rz, bid);
    }
  }
  put(chunk, baseX, baseZ, bx, topY + 2, bz, MELON); // heaped centre

  // Chess set mid-game + a workbench, further down the table.
  put(chunk, baseX, baseZ, 25, topY + 1, -13, CHESS);
  put(chunk, baseX, baseZ, 25, topY + 1, -16, CHESS);
  put(chunk, baseX, baseZ, 11, topY + 1, -19, TABLE);
}

// Chair: 9×9 seat plate on corner legs (crawl space under), backrest to h=15.
function emitChair(chunk, cx, baseX, baseZ) {
  const x0 = cx - 4, x1 = cx + 4;
  const { z0, z1 } = CHAIR_Z;
  const seatY = FY + 6;
  for (const [lx0, lz0] of [[x0, z0], [x1 - 1, z0], [x0, z1 - 1], [x1 - 1, z1 - 1]]) {
    fillBox(chunk, baseX, baseZ, lx0, FY + 1, lz0, lx0 + 1, seatY - 1, lz0 + 1, LOG);
  }
  fillBox(chunk, baseX, baseZ, x0, seatY, z0, x1, seatY, z1, PLANKS);          // seat
  fillBox(chunk, baseX, baseZ, x0, seatY + 1, z1 - 1, x1, FY + 15, z1, PLANKS); // backrest
}

// Bookshelf: plank end pillars, four walkable shelf boards, runs of "books"
// (wool/hay/melon/pumpkin/chest, some double-height, with hide gaps), and a
// side ladder ending level with the top board.
function emitBookshelf(chunk, baseX, baseZ) {
  const { x0, z0, x1, z1, boards } = SHELF;
  const top = boards[boards.length - 1];
  fillBox(chunk, baseX, baseZ, x0, FY + 1, z0, x0 + 1, top, z1, PLANKS);       // west pillar
  fillBox(chunk, baseX, baseZ, x1 - 1, FY + 1, z0, x1, top, z1, PLANKS);      // east pillar
  for (const y of boards) {
    // Boards run the full depth to the wall — no sealed shaft behind them.
    fillBox(chunk, baseX, baseZ, x0 + 2, y, z0, x1 - 2, y, z1, PLANKS);
    if (y === top) continue; // the top board shows off its skyline of books
    for (let x = x0 + 2; x <= x1 - 2; x++) {
      const r = cellHash(x, y);
      if (r < 0.25) continue;                                                  // hide gap
      const book = [WOOL, HAY, MELON, PUMPKIN, CHEST][Math.floor(r * 5) % 5];
      put(chunk, baseX, baseZ, x, y + 1, z0 + 1, book);                        // back row
      if (r > 0.8) put(chunk, baseX, baseZ, x, y + 2, z0 + 1, book);           // tall book
    }
  }
  // Books on the top board too — sparser, so there's room to stand.
  for (let x = x0 + 2; x <= x1 - 2; x += 3) {
    if (cellHash(x, top) < 0.5) put(chunk, baseX, baseZ, x, top + 1, z0 + 1, [WOOL, HAY, CHEST][x % 3 ? 1 : 0]);
  }
  // Side ladder on the east pillar, ending level with the top board.
  for (let y = FY + 1; y <= top; y++) put(chunk, baseX, baseZ, x1 + 1, y, z0 + 2, LADDER);
}

// Giant bed: plank frame on a 2-high crawl space, wool mattress, snow pillows,
// and a ladder up the foot end.
function emitBed(chunk, baseX, baseZ) {
  const { x0, z0, x1, z1 } = BED;
  // Corner feet hold the frame up; underneath stays open (the crawl space).
  for (const [fx, fz] of [[x0, z0], [x1 - 1, z0], [x0, z1 - 1], [x1 - 1, z1 - 1]]) {
    fillBox(chunk, baseX, baseZ, fx, FY + 1, fz, fx + 1, FY + 2, fz + 1, PLANKS);
  }
  fillBox(chunk, baseX, baseZ, x0, FY + 3, z0, x1, FY + 3, z1, PLANKS); // frame
  fillBox(chunk, baseX, baseZ, x0, FY + 4, z0, x1, FY + 4, z1, WOOL);   // mattress
  // Pillows at the head (north end), two puffy 3×2 blocks of snow.
  fillBox(chunk, baseX, baseZ, x0 + 3, FY + 5, z0 + 1, x0 + 5, FY + 5, z0 + 2, SNOW);
  fillBox(chunk, baseX, baseZ, x0 + 10, FY + 5, z0 + 1, x0 + 12, FY + 5, z0 + 2, SNOW);
  // Ladder up the foot-end frame, level with the mattress; kept beside the
  // corner foot so every rung has a solid block behind it.
  for (let y = FY + 1; y <= FY + 4; y++) put(chunk, baseX, baseZ, x1 + 1, y, z1 - 1, LADDER);
}

// Fireplace: stone chimney to the ceiling, fence-guarded lava firebox, and a
// slab mantel with its own little ladder.
function emitFireplace(chunk, baseX, baseZ) {
  const { x0, z0, x1, z1 } = FIRE;
  fillBox(chunk, baseX, baseZ, x0, FY + 1, z0, x1, CEIL, z1, STONE);
  // Firebox cavity opening toward the room, with lava sunk into its floor.
  fillBox(chunk, baseX, baseZ, x0, FY + 1, -1, x0 + 2, FY + 3, 1, 0);
  for (let z = -1; z <= 1; z++) {
    put(chunk, baseX, baseZ, x0 + 1, FY, z, LAVA);
    put(chunk, baseX, baseZ, x0 + 1, FY - 1, z, STONE); // sealed basin
    put(chunk, baseX, baseZ, x0 - 1, FY + 1, z, FENCE); // guard rail
  }
  // Mantel shelf across the chimney face + ladder hung on the chimney's
  // south flank, ending level with the mantel.
  for (let z = z0; z <= z1; z++) put(chunk, baseX, baseZ, x0 - 1, FY + 5, z, STONE_SLAB);
  for (let y = FY + 1; y <= FY + 5; y++) put(chunk, baseX, baseZ, x0, y, z1 + 1, LADDER);
}

// Toy corner: scattered toy cubes, a sandstone toy castle, and glow-mushroom
// night lights (gen-time light must ride chunk.lights, like cave flora).
function emitToyCorner(chunk, L, baseX, baseZ) {
  for (const t of L.toys) {
    put(chunk, baseX, baseZ, t.x, FY + 1, t.z, t.block);
    if (t.tall) put(chunk, baseX, baseZ, t.x, FY + 2, t.z, t.block);
  }
  // Toy castle: a knee-high sandstone fort with corner towers and a doorway.
  const c = { x0: 28, z0: 27, x1: 35, z1: 34 };
  for (let x = c.x0; x <= c.x1; x++) {
    for (let z = c.z0; z <= c.z1; z++) {
      const onWall = x === c.x0 || x === c.x1 || z === c.z0 || z === c.z1;
      const corner = (x === c.x0 || x === c.x1) && (z === c.z0 || z === c.z1);
      if (!onWall) continue;
      const h = corner ? 4 : 3;
      const door = x === c.x0 && (z === c.z0 + 3 || z === c.z0 + 4);
      for (let y = FY + 1; y <= FY + h; y++) {
        if (door && y <= FY + 2) continue;
        put(chunk, baseX, baseZ, x, y, z, SANDSTONE);
      }
    }
  }
  put(chunk, baseX, baseZ, 31, FY + 1, 30, CHEST);  // toy chest inside the fort
  put(chunk, baseX, baseZ, 22, FY + 1, 34, TABLE);  // craft bench
  put(chunk, baseX, baseZ, 22, FY + 1, 21, CHESS);  // spare chess set on the floor
  // Night lights: three glow mushrooms tucked around the corner.
  for (const [gx, gz] of [[21, 26], [35, 22], [26, 36]]) {
    const lx = gx - baseX, lz = gz - baseZ;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
    chunk.set(lx, FY + 1, lz, GLOW);
    if (!chunk.lights) chunk.lights = [];
    chunk.lights.push([gx, FY + 1, gz]);
  }
}

// ---- Spawns ----

// Floor-heavy hider drop-offs (crawl spaces, shadows, clutter); the high
// spots (tabletop, shelves, mantel) are for players who climb during hiding.
const HIDER_SPOTS = [
  { x: 20, z: -14 },  // under the table
  { x: -30, z: 19 },  // under-bed crawl space
  { x: 14, z: 4 },    // under chair A
  { x: -14, z: 4 },   // under chair B
  { x: -20, z: -34 }, // in front of the bookshelf
  { x: 33, z: 32 },   // inside the toy castle (clear of the toy chest)
  { x: 24, z: 24 },   // among the toy blocks
  { x: 37, z: 6 },    // beside the chimney
  { x: -34, z: 30 },  // past the bed, SW corner
  { x: 34, z: -34 },  // NE corner
  { x: -35, z: -20 }, // west wall clutter
  { x: 5, z: 25 },    // open floor south of the rug
];

// Seekers pen on the rug. Golden-angle spiral: no roster size shares a cell.
export function seekerSpawn(i = 0) {
  const a = i * 2.399963;
  const r = Math.min(5.5, 1.5 + i * 0.3);
  return { x: Math.cos(a) * r + 0.5, y: FY + 1, z: Math.sin(a) * r * 0.7 + 0.5 };
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

// Roofed map: the framework must use this instead of surface scans.
export function lobbySpawn() { return { x: 0.5, y: FY + 1, z: 0.5 }; }

// Bot patrol waypoints — open floor only (no crawl spaces or ladders).
export const botSpots = [
  { x: 0, z: 0 }, { x: 20, z: -14 },   // rug + the lane under the table
  { x: 0, z: -30 },                     // along the bookshelf front
  { x: -20, z: 10 },                    // between rug and bed
  { x: -30, z: 28 },                    // bed foot
  { x: 30, z: 0 },                      // fireplace front
  { x: 24, z: 30 },                     // toy corner (west of the toy castle)
  { x: 0, z: 30 },                      // south floor
  { x: 14, z: 12 }, { x: -14, z: 12 },  // chair fronts
  { x: 34, z: -28 }, { x: -34, z: -28 },// far north corners
];
