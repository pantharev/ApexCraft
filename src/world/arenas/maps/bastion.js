import { CHUNK_SIZE } from '../../../config.js';
import { mulberry32, getSeed } from '../../noise.js';
import { getBlockId } from '../../../blocks/BlockRegistry.js';
import { FLOOR_Y, put, fillBox, chunkOutside, cellHash } from '../lib.js';

// "The Bastion" — the Zombies wave-defense arena. An indestructible bedrock
// curtain wall encloses a grass killing field around a low central keep the
// team fortifies. Zombies pour in through four open gateways at the wall
// midpoints (each with a short outer tunnel so the horde reads as marching
// in from the dark); everything inside the shell is buildable/breakable.
//
// Layout is fully deterministic; only the boulder/hay scatter in the field
// varies by seed. Weathering (mossy stone) is a per-cell hash so every chunk
// stamps identically.

export const id = 'bastion';
export const name = 'The Bastion';
export const desc = 'Hold the keep against the horde';
export const half = 36;            // map spans [-36, 36] on X and Z
export const baseSurface = 'grass';

// Arena-map contract stubs (Prop Hunt concepts — unused by Zombies).
export const propBlocks = [];
export const botSpots = [];

const STONE = getBlockId('stone');
const PLANKS = getBlockId('oak_planks');
const GLASS = getBlockId('glass');
const PANE = getBlockId('glass_pane');
const ANDESITE = getBlockId('andesite');
const MOSSY = getBlockId('mossy_cobblestone');
const STONE_SLAB = getBlockId('stone_slab');
const BEDROCK = getBlockId('bedrock');
const GRAVEL = getBlockId('gravel');
const FENCE = getBlockId('fence');
const LADDER = getBlockId('ladder');
const TORCH = getBlockId('torch');
const GLOW = getBlockId('glow_mushroom');
const HAY = getBlockId('hay_bale');
const CHEST = getBlockId('chest');
const TABLE = getBlockId('crafting_table');
const FURNACE = getBlockId('furnace');
const MYSTERY_BOX = getBlockId('mystery_box');
const WALLBUY_M14 = getBlockId('wallbuy_m14');
const WALLBUY_AK74U = getBlockId('wallbuy_ak74u');
const WALLBUY_GALIL = getBlockId('wallbuy_galil');

const FY = FLOOR_Y;                // grass floor level (64)

// Bedrock curtain wall rings (Chebyshev radius). The shell rises all the way
// to the roof line, sealing the fortress into a closed siege arena.
const WALL_IN = 32, WALL_OUT = 34;
const ROOF_LEVEL = FY + 16;
const WALL_TOP = ROOF_LEVEL; // the shell caps its own 3-wide top ring
// Gate opening: 3 wide (|coord| <= 1), 3 high, one per wall midpoint.
const GATE_HALF = 1;
const GATE_TOP = FY + 3;
// Outer gate tunnels extend this far beyond the wall.
const TUNNEL_LEN = 6;

// Keep: the enclosed castle the team holds — tall masonry walls with pane
// arrow-slit windows, two arched entries (the barricade chokepoints), and its
// own beamed skylight roof under the arena canopy.
const KEEP_R = 12;                 // Chebyshev radius of the keep wall
const KEEP_WALL_TOP = FY + 6;      // walls meet the keep roof one above
const KEEP_ROOF = KEEP_WALL_TOP + 1;
const PLATFORM_R = 9;              // archer platform corners sit at (±R, ±R)

// Middle curtain wall: a ruined stone ring between keep and shell that breaks
// the open field into courtyards and lanes. Ordinary masonry — players can
// build it up, creepers can breach it. Zombies funnel through the cardinal
// gates and clamber over the crumbled (1-high) breach spans, so the direct-
// steering AI keeps flowing instead of humping an unbroken wall.
const MID_R = 22;                  // Chebyshev radius of the ring
const MID_TOP = FY + 3;            // intact wall height; slab parapet above
const MID_GATE_HALF = 2;           // gates are 5 wide, on the gravel lanes

// Roof: plank beams over a glass-major skylight at ROOF_LEVEL (the Playroom
// rule — glass keeps the per-column skylight alive; a solid roof would drop
// the whole arena to cave darkness).

// ~30% deterministic mossy weathering on the keep masonry.
const masonry = (wx, wy, wz) => (cellHash(wx + wy * 57, wz - wy * 31) < 0.3 ? MOSSY : STONE);

// Seed-varied killing-field scatter: andesite boulders and hay bales for
// cover, never on the gate paths, the keep, or the wall footing.
let _layout = null;
let _layoutSeed = null;

function layout() {
  const seed = getSeed();
  if (_layout && _layoutSeed === seed) return _layout;
  const rng = mulberry32((seed ^ 0xba5710) >>> 0);
  const scatter = [];
  for (let i = 0; i < 60 && scatter.length < 10; i++) {
    const x = Math.floor((rng() * 2 - 1) * (WALL_IN - 4));
    const z = Math.floor((rng() * 2 - 1) * (WALL_IN - 4));
    const cheb = Math.max(Math.abs(x), Math.abs(z));
    if (cheb <= KEEP_R + 2) continue;                                // keep + skirt
    if (Math.abs(x) <= 2 || Math.abs(z) <= 2) continue;              // gate paths
    if (cheb >= WALL_IN - 2) continue;                               // wall footing
    if (Math.abs(cheb - MID_R) <= 1) continue;                       // mid-wall line
    scatter.push({ x, z, block: rng() < 0.35 ? HAY : ANDESITE, tall: rng() < 0.3 });
  }

  // Ruined breaches in the curtain wall: crumbled spans per side, never on
  // the gates or the ring's corner towers. Stored as [{side, at, span}]
  // where `at` is the tangential offset along that side.
  const rollBreaches = (perSideMin, extraP, reach, spanMax) => {
    const out = [];
    for (let side = 0; side < 4; side++) {
      const n = perSideMin + (rng() < extraP ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const at = Math.floor(6 + rng() * (reach - 6)) * (rng() < 0.5 ? -1 : 1);
        out.push({ side, at, span: 3 + Math.floor(rng() * (spanMax - 2)) });
      }
    }
    return out;
  };
  const breaches = rollBreaches(1, 0.5, MID_R - 6, 5); // mid ring: 1–2/side, 3–5 wide
  _layout = { scatter, breaches };
  _layoutSeed = seed;
  return _layout;
}

// Is ring-cell (side, offset) inside a crumbled breach span?
function inBreach(list, side, off) {
  for (const b of list) {
    if (b.side === side && Math.abs(off - b.at) <= b.span / 2) return true;
  }
  return false;
}

// Stamp the whole arena into this chunk.
export function generate(chunk) {
  if (chunkOutside(chunk, half + TUNNEL_LEN)) return;
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;
  const L = layout();

  groundPass(chunk, baseX, baseZ);
  emitWall(chunk, baseX, baseZ);
  emitTunnels(chunk, baseX, baseZ);
  emitMidWall(chunk, L, baseX, baseZ);
  emitKeep(chunk, baseX, baseZ);
  emitWallBuys(chunk, baseX, baseZ);
  emitRoof(chunk, baseX, baseZ);
  for (const s of L.scatter) {
    put(chunk, baseX, baseZ, s.x, FY + 1, s.z, s.block);
    if (s.tall) put(chunk, baseX, baseZ, s.x, FY + 2, s.z, s.block);
  }
}

// Castle flooring: the entire interior is patchwork flagstone — the arena is
// the inside of the fortress, not an outdoor field. Gravel lanes still run
// gate → keep for wayfinding.
function groundPass(chunk, baseX, baseZ) {
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wx = baseX + lx, wz = baseZ + lz;
      const r = Math.max(Math.abs(wx), Math.abs(wz));
      if (r >= WALL_IN) continue; // the shell + outside keep the flat base
      if ((Math.abs(wx) <= 1 || Math.abs(wz) <= 1)) {
        chunk.set(lx, FY, lz, GRAVEL); // gate ways
        continue;
      }
      // Patchy paving: mostly stone, mossy veins, andesite slabs of wear.
      const h = cellHash(wx, wz);
      chunk.set(lx, FY, lz, h < 0.22 ? MOSSY : h < 0.85 ? STONE : ANDESITE);
    }
  }
}

// The indestructible bedrock curtain wall, with a gate opening at each of the
// four midpoints. Explosions skip bedrock, so the shell can never be breached
// — the gates are the only way in.
function emitWall(chunk, baseX, baseZ) {
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wx = baseX + lx, wz = baseZ + lz;
      const r = Math.max(Math.abs(wx), Math.abs(wz));
      if (r < WALL_IN || r > WALL_OUT) continue;
      const onGateX = Math.abs(wx) <= GATE_HALF && Math.abs(wz) >= WALL_IN; // N/S gates
      const onGateZ = Math.abs(wz) <= GATE_HALF && Math.abs(wx) >= WALL_IN; // E/W gates
      for (let y = FY + 1; y <= WALL_TOP; y++) {
        if ((onGateX || onGateZ) && y <= GATE_TOP) continue; // gate arch
        chunk.set(lx, y, lz, BEDROCK);
      }
      chunk.set(lx, FY, lz, BEDROCK); // footing (no digging under the wall)
    }
  }
}

// Short roofed bedrock tunnels outside each gate — the horde's way in. Their
// far mouths stay open; a torch pair marks each inner mouth.
function emitTunnels(chunk, baseX, baseZ) {
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    for (let d = 1; d <= TUNNEL_LEN; d++) {
      const cw = WALL_OUT + d; // distance of this tunnel slice from the origin
      for (let s = -GATE_HALF - 1; s <= GATE_HALF + 1; s++) {
        const wx = dx === 0 ? s : dx * cw;
        const wz = dz === 0 ? s : dz * cw;
        const rim = Math.abs(s) === GATE_HALF + 1;
        // Side walls + roof; the bore itself stays air over a gravel bed.
        for (let y = FY + 1; y <= GATE_TOP; y++) {
          if (rim) put(chunk, baseX, baseZ, wx, y, wz, BEDROCK);
        }
        put(chunk, baseX, baseZ, wx, GATE_TOP + 1, wz, BEDROCK);
        put(chunk, baseX, baseZ, wx, FY, wz, rim ? BEDROCK : GRAVEL);
      }
    }
    // Torch pair on the ground flanking the inner gate mouth.
    const in2 = WALL_IN - 2;
    if (dx === 0) {
      put(chunk, baseX, baseZ, -(GATE_HALF + 1), FY + 1, dz * in2, TORCH);
      put(chunk, baseX, baseZ, GATE_HALF + 1, FY + 1, dz * in2, TORCH);
    } else {
      put(chunk, baseX, baseZ, dx * in2, FY + 1, -(GATE_HALF + 1), TORCH);
      put(chunk, baseX, baseZ, dx * in2, FY + 1, GATE_HALF + 1, TORCH);
    }
  }
}

// Height of the covered galleries roofing the curtain walls. Parapet walkers
// (standing on the FY+4 slab) clear it: 4.5 + 1.8 < 7.
const GALLERY_Y = FY + 7;

// A ruined curtain-wall ring: intact spans carry a slab parapet, weathered
// columns sag a block, breach spans are down to hop-able rubble (zombies can
// climb one block, so the horde keeps flowing). A slab gallery roof spans the
// wall line three wide — the walls read as covered castle corridors — with
// the roof torn open over every breach.
function emitRuinRing(chunk, baseX, baseZ, { r, top, gateHalf, breaches, sagP, skipCorners }) {
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wx = baseX + lx, wz = baseZ + lz;
      const m = Math.max(Math.abs(wx), Math.abs(wz));

      // Gallery roof band (r±1), holed over breaches.
      if (m >= r - 1 && m <= r + 1) {
        const gOnZ = Math.abs(wz) >= Math.abs(wx);
        const gOff = gOnZ ? wx : wz;
        const gSide = gOnZ ? (wz < 0 ? 0 : 1) : (wx < 0 ? 2 : 3);
        if (!inBreach(breaches, gSide, gOff)) chunk.set(lx, GALLERY_Y, lz, STONE_SLAB);
      }

      if (m !== r) continue;
      if (skipCorners && Math.abs(wx) === r && Math.abs(wz) === r) continue;
      // Which side of the ring, and how far along it?
      const onZ = Math.abs(wz) === r; // north/south run
      const off = onZ ? wx : wz;
      const side = onZ ? (wz < 0 ? 0 : 1) : (wx < 0 ? 2 : 3);
      if (Math.abs(off) <= gateHalf) continue;                   // lane gate
      if (inBreach(breaches, side, off)) {
        chunk.set(lx, FY + 1, lz, MOSSY);                        // rubble — zombies hop it
        continue;
      }
      // Intact wall, with weathered columns sagging one block.
      const sag = cellHash(wx * 7, wz * 11) < sagP;
      const colTop = sag ? top - 1 : top;
      for (let y = FY + 1; y <= colTop; y++) chunk.set(lx, y, lz, masonry(wx, y, wz));
      if (!sag) chunk.set(lx, top + 1, lz, STONE_SLAB);          // parapet walk
    }
  }
}

// The ruined middle curtain wall: the shared ring plus squat watchtowers
// anchoring the four corners.
function emitMidWall(chunk, L, baseX, baseZ) {
  emitRuinRing(chunk, baseX, baseZ, {
    r: MID_R, top: MID_TOP, gateHalf: MID_GATE_HALF,
    breaches: L.breaches, sagP: 0.15, skipCorners: true,
  });

  // Corner watchtowers: solid 3×3 masonry stumps with a fenced top and a
  // ladder up the keep-facing face (ends level with the platform floor).
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const cx = sx * MID_R, cz = sz * MID_R;
    const top = FY + 4;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let y = FY + 1; y <= top; y++) {
          put(chunk, baseX, baseZ, cx + dx, y, cz + dz, masonry(cx + dx, y, cz + dz));
        }
      }
    }
    // Fence rail on the two outward rims of the top.
    for (let s = -1; s <= 1; s++) {
      put(chunk, baseX, baseZ, cx + sx, top + 1, cz + s, FENCE);
      put(chunk, baseX, baseZ, cx + s, top + 1, cz + sz, FENCE);
    }
    for (let y = FY + 1; y <= top; y++) {
      put(chunk, baseX, baseZ, cx - 2 * sx, y, cz - sz, LADDER);
    }
  }
}

// The keep: an enclosed castle hall — tall masonry walls with pane arrow-slit
// windows, arched east/west entries (the team's choke points to barricade),
// its own beamed skylight roof, four corner archer platforms with ladders,
// and a supply corner (table/chest/furnace/mystery box). Unlike the shell it
// is ordinary stone — creepers can crack it open.
function emitKeep(chunk, baseX, baseZ) {
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wx = baseX + lx, wz = baseZ + lz;
      const r = Math.max(Math.abs(wx), Math.abs(wz));
      if (r > KEEP_R + 1) continue;
      if (r === KEEP_R) {
        // The wall ring. Entries: 2-wide, 2-high arches at the east and west
        // midpoints; pane slit windows high up every 4th column.
        const onEntry = Math.abs(wz) <= 1 && Math.abs(wx) === KEEP_R;
        const corner = Math.abs(wx) === KEEP_R && Math.abs(wz) === KEEP_R;
        const off = Math.abs(wz) === KEEP_R ? wx : wz;
        for (let y = FY + 1; y <= KEEP_WALL_TOP; y++) {
          if (onEntry && y <= FY + 2) continue; // arched doorway
          const slit = !corner && !onEntry && y === FY + 4 && ((off % 4) + 4) % 4 === 0;
          chunk.set(lx, y, lz, slit ? PANE : masonry(wx, y, wz));
        }
        chunk.set(lx, KEEP_ROOF, lz, masonry(wx, KEEP_ROOF, wz)); // roof rim
      } else if (r < KEEP_R) {
        // The keep roof: plank beams on a 4-grid over glass, so the striped
        // night light of the arena canopy carries down into the hall.
        const beam = (wx & 3) === 0 || (wz & 3) === 0;
        chunk.set(lx, KEEP_ROOF, lz, beam ? PLANKS : GLASS);
      } else {
        chunk.set(lx, KEEP_ROOF, lz, STONE_SLAB); // eaves overhang the wall
      }
    }
  }

  // Corner archer platforms: 3×3 stone decks on pillars, ladder up the inner face.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const cx = sx * PLATFORM_R, cz = sz * PLATFORM_R;
    const deckY = FY + 4;
    fillBox(chunk, baseX, baseZ, cx - 1, deckY, cz - 1, cx + 1, deckY, cz + 1, STONE);
    // Fence rail on the two outward rims.
    for (let s = -1; s <= 1; s++) {
      put(chunk, baseX, baseZ, cx + sx, deckY + 1, cz + s * 1, FENCE);
      put(chunk, baseX, baseZ, cx + s * 1, deckY + 1, cz + sz, FENCE);
    }
    // Support pillar + ladder hung on its keep-centre face (face-adjacent —
    // the mesher needs a solid wall behind a ladder).
    for (let y = FY + 1; y < deckY; y++) {
      put(chunk, baseX, baseZ, cx, y, cz, masonry(cx, y, cz));
      put(chunk, baseX, baseZ, cx - sx, y, cz, LADDER);
    }
    put(chunk, baseX, baseZ, cx - sx, deckY, cz, LADDER); // hatch over the lip
  }

  // Supply corner by the north wall: worktable, storage, smelter, hay seats —
  // and the Mystery Box (right-click between waves for a random gun).
  put(chunk, baseX, baseZ, -2, FY + 1, -KEEP_R + 2, TABLE);
  put(chunk, baseX, baseZ, -1, FY + 1, -KEEP_R + 2, CHEST);
  put(chunk, baseX, baseZ, 0, FY + 1, -KEEP_R + 2, FURNACE);
  put(chunk, baseX, baseZ, 2, FY + 1, -KEEP_R + 2, HAY);
  put(chunk, baseX, baseZ, 4, FY + 1, -KEEP_R + 2, MYSTERY_BOX);

  // Glow mushrooms light the keep at night (gen-time torches never light;
  // the glow pool has only 6 slots — spend them all here at the heart).
  const glows = [
    [-PLATFORM_R, -PLATFORM_R + 2], [PLATFORM_R, PLATFORM_R - 2],
    [-PLATFORM_R + 2, PLATFORM_R], [PLATFORM_R - 2, -PLATFORM_R],
    [0, 3], [0, -3],
  ];
  for (const [gx, gz] of glows) {
    const lx = gx - baseX, lz = gz - baseZ;
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
    chunk.set(lx, FY + 1, lz, GLOW);
    if (!chunk.lights) chunk.lights = [];
    chunk.lights.push([gx, FY + 1, gz]);
  }
}

// The fortress roof: plank beams on an 8-block grid over a glass skylight,
// spanning wall to wall at ROOF_LEVEL. Glass-major keeps the per-column
// skylight alive (a solid roof would put the whole floor at cave darkness);
// the bedrock shell rises to meet it, so the arena reads as one closed hall.
function emitRoof(chunk, baseX, baseZ) {
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wx = baseX + lx, wz = baseZ + lz;
      if (Math.max(Math.abs(wx), Math.abs(wz)) >= WALL_IN) continue; // shell owns the rim
      const beam = (wx & 7) === 0 || (wz & 7) === 0;
      chunk.set(lx, ROOF_LEVEL, lz, beam ? PLANKS : GLASS);
    }
  }
}

// Wall-buy gun stations, priced by how dangerous they are to reach: the M14
// on the keep's inner north wall (safe starter), the AK-74u across on the
// south wall, and the Galil out on the curtain wall beside the east gate — a
// risky sprint once a wave is running. Stamped last so they overwrite the
// masonry/bedrock cell they sit in.
function emitWallBuys(chunk, baseX, baseZ) {
  put(chunk, baseX, baseZ, 4, FY + 2, -KEEP_R, WALLBUY_M14);
  put(chunk, baseX, baseZ, -4, FY + 2, KEEP_R, WALLBUY_AK74U);
  put(chunk, baseX, baseZ, WALL_IN, FY + 2, 6, WALLBUY_GALIL);
}

// ---- Spawns ----

// Team spawns: a golden-angle spiral around the keep centre so no two indexes
// ever share a cell, whatever the roster size.
export function playerSpawns(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2.399963;
    const r = Math.min(PLATFORM_R - 2, 1.5 + i * 0.6);
    out.push({ x: Math.cos(a) * r + 0.5, y: FY + 1, z: Math.sin(a) * r + 0.5 });
  }
  return out;
}

// Where waves emerge: just inside each gate, at the tunnel's inner mouth.
export function zombieGates() {
  const g = WALL_IN - 2;
  return [
    { x: 0.5, y: FY + 1, z: -g + 0.5 },
    { x: 0.5, y: FY + 1, z: g + 0.5 },
    { x: -g + 0.5, y: FY + 1, z: 0.5 },
    { x: g + 0.5, y: FY + 1, z: 0.5 },
  ];
}

export function lobbySpawn() { return { x: 0.5, y: FY + 1, z: 0.5 }; }

// Contract stubs (Prop Hunt spawn helpers — Zombies never calls these).
export function seekerSpawn() { return lobbySpawn(); }
export function hiderSpawns(n) { return playerSpawns(n); }
