import { CHUNK_SIZE, WORLD_HEIGHT, WATER_DROP } from '../config.js';
import { getBlock, isOpaque, isSolid, getBlockId, liquidKind } from '../blocks/BlockRegistry.js';
import { Noise } from '../world/noise.js';

// The chunk mesher. It runs in the chunk workers (core/chunkWorker.js) and,
// for edits next to the player, on the page — so it must not import three.js
// or touch the DOM. It reads a chunk from a padded snapshot of its voxels and
// returns plain typed arrays; World turns those into BufferGeometry.

// --- The snapshot ------------------------------------------------------------
// A chunk's mesh depends on a one-block ring of its neighbours (face culling,
// ambient occlusion, the sky-light of border columns), so a mesh job is given
// the chunk plus that ring in one array, padded by one cell on every side —
// PAD x (WORLD_HEIGHT + 2) x PAD — where local (lx, y, lz), with lx/lz in
// -1..CHUNK_SIZE and y in -1..WORLD_HEIGHT, sits at volIndex(lx, y, lz). The
// layers below and above the world stay air, so the mesher can read any
// neighbour of any cell without a bounds check. The snapshot is a copy, so it
// can be handed to a worker and the live chunk can keep changing.
export const PAD = CHUNK_SIZE + 2;
const PLANE = PAD * PAD; // cells per horizontal layer; also the index step for +y
export const VOL_SIZE = PLANE * (WORLD_HEIGHT + 2);
export const volIndex = (lx, y, lz) => (y + 1) * PLANE + (lz + 1) * PAD + lx + 1;

// Build the snapshot for one chunk. `blocksAt(dx, dz)` returns the block array
// of the chunk at that offset from it (0,0 = the chunk itself), or null if it
// is not generated — its cells then read as air. Pass a previous snapshot as
// `vol` to reuse its memory: every cell inside the world is written again,
// and the padding layers above and below are never written at all.
export function buildVolume(blocksAt, vol = new Uint8Array(VOL_SIZE)) {
  const S = CHUNK_SIZE, H = WORLD_HEIGHT, E = PAD - 1;
  const c = blocksAt(0, 0);
  const w = blocksAt(-1, 0), e = blocksAt(1, 0), n = blocksAt(0, -1), s = blocksAt(0, 1);
  const nw = blocksAt(-1, -1), ne = blocksAt(1, -1), sw = blocksAt(-1, 1), se = blocksAt(1, 1);
  for (let y = 0; y < H; y++) {
    const row = (y + 1) * PAD; // volume row index of (y, lz = -1)
    for (let z = 0; z < S; z++) {
      const src = (y * S + z) * S;
      const dst = (row + z + 1) * PAD;
      for (let x = 0; x < S; x++) vol[dst + x + 1] = c[src + x];
      vol[dst] = w ? w[src + S - 1] : 0;
      vol[dst + E] = e ? e[src] : 0;
    }
    const north = row * PAD, south = (row + E) * PAD;
    const nSrc = (y * S + S - 1) * S, sSrc = y * S * S;
    for (let x = 0; x < S; x++) {
      vol[north + x + 1] = n ? n[nSrc + x] : 0;
      vol[south + x + 1] = s ? s[sSrc + x] : 0;
    }
    vol[north] = nw ? nw[nSrc + S - 1] : 0;
    vol[north + E] = ne ? ne[nSrc] : 0;
    vol[south] = sw ? sw[sSrc + S - 1] : 0;
    vol[south + E] = se ? se[sSrc] : 0;
  }
  return vol;
}

// --- Tile tables -------------------------------------------------------------
// Which texture-array layer each block face uses, and each layer's buffer,
// variation and glow. They are derived from the texture atlas, which needs a
// canvas, so the page builds them (World.js) and hands them over — to this
// module directly, and to each worker in its init message.
let FACE_TOP = new Uint16Array(256), FACE_SIDE = FACE_TOP, FACE_BOTTOM = FACE_TOP;
let TILE_KIND = [0], TILE_VARIATION = [0], TILE_GLOW = [0];
export function setTileTables(t) {
  FACE_TOP = t.top; FACE_SIDE = t.side; FACE_BOTTOM = t.bottom;
  TILE_KIND = t.kind; TILE_VARIATION = t.variation; TILE_GLOW = t.glow;
}
const faceMaterialIndex = (id, face) => (face === 'top' ? FACE_TOP[id] : face === 'bottom' ? FACE_BOTTOM[id] : FACE_SIDE[id]);

const SHADE = { top: 1.0, bottom: 0.5, side: 0.8 };
const WATER = getBlockId('water');
const LAVA = getBlockId('lava'); // opaque glowing liquid; culls its own internal faces like water
const TORCH = getBlockId('torch'); // rendered as a separate stick mesh, not in the chunk
const GRASS = getBlockId('grass');
const LEAVES = getBlockId('oak_leaves');
const TALL_GRASS = getBlockId('tall_grass');
// Cross-plants render as two diagonal quads, not cubes.
// GLOW_MUSHROOM (id 52) is added here so it renders as crossed quads underground.
const CAVE_VINE = getBlockId('cave_vine'); // hangs: its lowest block draws the tip tile
const PLANTS = new Set([TALL_GRASS, getBlockId('poppy'), getBlockId('dandelion'), getBlockId('glow_mushroom'), CAVE_VINE]);
// Non-cube blocks drawn by the special pass below (skipped by greedy meshing).
const DOOR = getBlockId('door');
const DOOR_OPEN = getBlockId('door_open');
const BED = getBlockId('bed');
const BED_HEAD = getBlockId('bed_head');
const FENCE = getBlockId('fence');
const LADDER = getBlockId('ladder');
const PANE = getBlockId('glass_pane');
const SLABS = new Set([getBlockId('oak_slab'), getBlockId('stone_slab')]);
const STAIR_DIR = {
  [getBlockId('oak_stairs_px')]: 'px', [getBlockId('oak_stairs_nx')]: 'nx',
  [getBlockId('oak_stairs_pz')]: 'pz', [getBlockId('oak_stairs_nz')]: 'nz',
};
const SPECIAL = new Set([...PLANTS, DOOR, DOOR_OPEN, BED, BED_HEAD, FENCE, LADDER, PANE,
  ...SLABS, ...Object.keys(STAIR_DIR).map(Number)]);
// Flowing liquid blocks (see systems/Liquids.js): drawn in the special pass as
// boxes whose height falls with flowLevel, so streams visibly thin as they
// spread. id -> { kind: 'water'|'lava', height: rendered box height }.
const FLOW = new Map();
for (let id = 0; id < 256; id++) {
  const d = getBlock(id);
  if (d && d.id === id && d.flowLevel) FLOW.set(id, { kind: d.liquidType, height: d.liquidHeight });
}

// Per-block-id lookups for the greedy pass, which visits every cell of the
// chunk six times: flat tables instead of registry calls and Set lookups.
const OPAQUE = new Uint8Array(256);   // solid and not transparent
const NON_CUBE = new Uint8Array(256); // drawn by the special pass (or not at all)
const SELF_CULL = new Uint8Array(256); // hides faces against its own kind
const WATERY = new Uint8Array(256);   // water, still or flowing
for (let id = 0; id < 256; id++) {
  WATERY[id] = liquidKind(id) === 'water' ? 1 : 0;
  OPAQUE[id] = isOpaque(id) ? 1 : 0;
  NON_CUBE[id] = (id === TORCH || SPECIAL.has(id) || FLOW.has(id)) ? 1 : 0;
  SELF_CULL[id] = (getBlock(id).transparent || id === LAVA) ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Skylight system — gives caves genuine darkness while leaving the surface
// unchanged.  A cell is "fully sky-lit" (skylight = 1.0) when no opaque block
// sits above it in its column.  Below the first opaque roof the light falls off
// with depth over a soft FADE_BLOCKS gradient, reaching DARK_FLOOR at the bottom.
//
// DARK_FLOOR (0.15): chosen so a placed torch / glow mushroom point-light
// still registers visibly on cave walls.  Near-zero would black out dynamic
// lights; near 0.5 would make caves feel merely "dim."  0.15 is the sweet spot:
// visibly dark, torch-readable, tunable.
//
// The precompute is O(PAD² × WORLD_HEIGHT) per chunk mesh and runs once per
// meshVolume call.
// ---------------------------------------------------------------------------
const DARK_FLOOR   = 0.15;  // minimum vertex brightness deep underground
const FADE_BLOCKS  = 6;     // blocks below the roof over which light transitions

// Per-column sky-roof heights for the snapshot: roof[volIndex % PLANE] = y of
// the first opaque block scanned top-down (the roof that blocks the sky). The
// WORLD_HEIGHT sentinel means the column is fully open to the sky; skylightAt
// treats roofY >= WORLD_HEIGHT as fully lit. WORLD_HEIGHT (128) fits a Uint8Array.
//
// It covers the one-block ring outside the chunk too: border side faces are
// lit by the *neighbour's* column, and clamping back into the chunk (whose
// roof is the terrain above the face) painted dark seams on daylight cliff
// walls at every chunk boundary.
//
// Also returns the height of the chunk's highest non-air block, so the passes
// below can stop there instead of sweeping the empty sky.
function scanColumns(vol) {
  const roof = new Uint8Array(PAD * PAD).fill(WORLD_HEIGHT);
  let top = -1;
  for (let lz = -1; lz <= CHUNK_SIZE; lz++) {
    for (let lx = -1; lx <= CHUNK_SIZE; lx++) {
      const inside = lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE;
      const col = (lz + 1) * PAD + lx + 1;
      let first = -1;
      for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
        const id = vol[(y + 1) * PLANE + col];
        if (id === 0) continue;
        if (first < 0) first = y;
        if (OPAQUE[id]) { roof[col] = y; break; }
      }
      if (inside && first > top) top = first;
    }
  }
  return { roof, top };
}

// Skylight value for a single voxel cell given its column's sky roof.
//
// roofY = y of the first opaque block when scanning top-down.
// WORLD_HEIGHT (128) is the sentinel for "no opaque block found = open sky."
//
// Behaviour:
//   • roofY >= WORLD_HEIGHT  → fully open sky column, every cell = 1.0.
//   • y >= roofY             → at or above the solid roof = 1.0 (surface block
//                              itself, or blocks level with / above the roof
//                              in an overhanging section).
//   • depth in [1, FADE_BLOCKS] → soft gradient so cave mouths fade naturally.
//   • depth > FADE_BLOCKS    → fully enclosed cave = DARK_FLOOR (0.15).
function skylightAt(y, roofY) {
  if (roofY >= WORLD_HEIGHT) return 1.0; // open-sky column — no roof at all
  if (y >= roofY) return 1.0;            // at or above the roof (surface)
  const depth = roofY - y;              // how far below the first solid roof
  if (depth <= FADE_BLOCKS) {
    // Soft gradient just under the roof: cave mouths feel like shade, not
    // instant blackness.  t = 0 at the roof, 1 at FADE_BLOCKS below it.
    const t = depth / FADE_BLOCKS;
    return 1.0 - t * (1.0 - DARK_FLOOR);
  }
  return DARK_FLOOR; // deep enclosed cave — visibly dark, torch-readable
}

// Mask entries pack the block id with the face's 4-corner ambient-occlusion
// pattern, so greedy merging only joins cells that shade identically (AO stays
// exact across merged quads). Water skips AO (sentinel) to merge maximally.
const ID_BITS = 9, ID_MASK = (1 << ID_BITS) - 1;
const AO_UNIFORM = 255;
// Corner sample offsets in (u, v): a00, a10, a11, a01 — matches vertex order.
const AO_CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
// Snapshot index steps per axis (x, y, z), and the index of local (0, 0, 0).
const STRIDE = [1, PLANE, PAD];
const ORIGIN = PLANE + PAD + 1;

// A geometry under construction. Terrain buffers also collect the per-vertex
// `tile` attribute — (texture-array layer, variation, glow) — that the terrain
// shader reads; `tile` is the tile the next faces pushed belong to (-1 for
// the water buffer, which has its own material and collects a per-vertex
// `depth` instead: 0 at the shore, 1 in deep water).
function emptyBuf() {
  return { positions: [], normals: [], uvs: [], colors: [], tiles: [], depths: [], indices: [], tile: -1 };
}

// Added to a tile's variation when its face is under water (the terrain
// shader darkens such ground with depth and plays light across it).
const WET = 4;

// Stamp the four vertices just pushed with the buffer's current tile.
function stampTile(buf, wet = 0) {
  const t = buf.tile;
  if (t < 0) return;
  const v = TILE_VARIATION[t] + (wet ? WET : 0), g = TILE_GLOW[t];
  buf.tiles.push(t, v, g, t, v, g, t, v, g, t, v, g);
}

// The `depth` given to flowing water: a stream is a thin sheet, so it reads
// as shallow — lighter and clearer than a lake — but not as shore foam.
const FLOW_DEPTH = 0.45;

// How deep the water is at one cell of a column, looking down: 0 if the cell
// is not water, else 1..3 blocks (capped).
function columnDepth(vol, idx) {
  if (!WATERY[vol[idx]]) return 0;
  if (!WATERY[vol[idx - PLANE]]) return 1;
  return WATERY[vol[idx - 2 * PLANE]] ? 3 : 2;
}

// The depth of the water around one corner of a water cell's top face, 0..3:
// 0 where the corner touches anything that is not water — the shore — and
// otherwise the average depth of the four columns that meet there. Corners
// are shared, so neighbouring cells (and chunks) agree and the result blends
// smoothly across the surface.
function shoreDepth(vol, idx, ou, ov) {
  const b = columnDepth(vol, idx + ou), c = columnDepth(vol, idx + ov), d = columnDepth(vol, idx + ou + ov);
  if (b === 0 || c === 0 || d === 0) return 0;
  return Math.min(3, Math.round((columnDepth(vol, idx) + b + c + d) / 4));
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Climate tint for living surfaces: lush (wet) areas read deep green, hot dry
// areas turn yellow-brown, blended per-vertex so the gradient is seamless.
// It is four noise lookups, and the grass and leaf quads of a chunk share
// most of their corners, so each corner column is worked out once per mesh.
const TINT_SPAN = CHUNK_SIZE + 1; // vertex columns across a chunk
const tintCache = new Array(TINT_SPAN * TINT_SPAN);
let tintBaseX = 0, tintBaseZ = 0;
function resetTints(baseX, baseZ) {
  tintCache.fill(null);
  tintBaseX = baseX; tintBaseZ = baseZ;
}
function climateTint(wx, wz) {
  const k = (wz - tintBaseZ) * TINT_SPAN + (wx - tintBaseX);
  let t = tintCache[k];
  if (!t) {
    const dry = clamp01(0.5 + (Noise.temperature(wx, wz) - Noise.humidity(wx, wz)) * 0.55);
    t = tintCache[k] = [0.88 + 0.24 * dry, 1.04 - 0.07 * dry, 0.95 - 0.17 * dry];
  }
  return t;
}

// Push one quad (4 verts) into a buffer. uvLocal tiles 0..w / 0..h so the tile
// repeats across a greedy-merged quad (textures use RepeatWrapping).
//
// q.skylight: per-quad skylight factor (0..1).  For greedy-merged quads spanning
// a uniform AO + uniform skylight bucket the factor is the same for all four
// corners; this keeps the merge-key valid (see meshVolume).  The slight
// loss of per-vertex gradient within a merged quad is imperceptible at the coarse
// bucket granularity we use (4-bucket: 0.0/0.33/0.67/1.0).
// Corner k of a quad sits at (i + QU[k]·w, j + QV[k]·h) on its face plane.
const QU = [0, 1, 1, 0], QV = [0, 0, 1, 1];
const corner = [0, 0, 0];
//
// Water quads differ in three ways (see the mask notes in meshVolume): the
// surface is lowered by WATER_DROP — a top face entirely, a side face of the
// body's top layer (q.flag) along its upper edge; q.ao holds corner depths,
// not occlusion, and goes out as the `depth` attribute; and nothing darkens.
function pushQuad(buf, q) {
  const shade = SHADE[q.faceType];
  const sl = (q.skylight !== undefined) ? q.skylight : 1.0; // skylight factor
  const tinted = (q.id === GRASS && q.faceType === 'top') || q.id === LEAVES;
  const water = q.id === WATER;
  const surface = water && q.faceType === 'top';
  const lip = water && q.flag === 1 && q.faceType === 'side';
  const vi = buf.positions.length / 3;
  corner[q.axis] = q.faceCoord;
  for (let k = 0; k < 4; k++) {
    const du = QU[k] * q.w, dv = QV[k] * q.h;
    corner[q.u] = q.i + du; corner[q.v] = q.j + dv;
    const x = q.baseX + corner[0], z = q.baseZ + corner[2];
    let y = corner[1];
    if (surface || (lip && (q.u === 1 ? QU[k] : QV[k]) === 1)) y -= WATER_DROP;
    buf.positions.push(x, y, z);
    buf.normals.push(q.normal[0], q.normal[1], q.normal[2]);
    buf.uvs.push(du, dv);
    if (water) buf.depths.push(surface ? q.ao[k] / 3 : 1);
    // Corners tucked against neighbouring blocks darken (soft contact shadow).
    // Skylight (sl) multiplied in so underground faces are genuinely dark while
    // surface faces (sl=1.0) are unchanged from the previous behaviour.
    const aoF = water ? 1 : 0.6 + 0.4 * (q.ao[k] / 3);
    const bright = shade * aoF * sl;
    if (tinted) {
      const t = climateTint(x, z);
      buf.colors.push(bright * t[0], bright * t[1], bright * t[2]);
    } else {
      buf.colors.push(bright, bright, bright);
    }
  }
  stampTile(buf, q.flag);
  // Split the quad across the brighter diagonal so AO interpolates smoothly
  // (the classic anisotropy fix), honouring the face winding direction.
  const flip = q.ao[0] + q.ao[2] > q.ao[1] + q.ao[3];
  if (q.dir > 0) {
    if (flip) buf.indices.push(vi + 1, vi + 2, vi + 3, vi + 1, vi + 3, vi);
    else buf.indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
  } else {
    if (flip) buf.indices.push(vi + 1, vi + 3, vi + 2, vi + 1, vi, vi + 3);
    else buf.indices.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
  }
}

// Turn one or more buffers into one geometry's worth of typed arrays,
// concatenated in the order given. Sized up front and filled with typed-array
// copies — no per-element pushes or argument spreading, whatever the chunk's
// size. Returns null when there is nothing to draw.
function assemble(...bufs) {
  let verts = 0, idx = 0, tiled = false, deep = false;
  for (const b of bufs) {
    verts += b.positions.length / 3;
    idx += b.indices.length;
    if (b.tiles.length) tiled = true;
    if (b.depths.length) deep = true;
  }
  if (verts === 0) return null;
  const position = new Float32Array(verts * 3);
  const normal = new Float32Array(verts * 3);
  const uv = new Float32Array(verts * 2);
  const color = new Float32Array(verts * 3);
  const tile = tiled ? new Float32Array(verts * 3) : null;
  const depth = deep ? new Float32Array(verts) : null;
  const index = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  let v = 0, i = 0;
  for (const b of bufs) {
    position.set(b.positions, v * 3);
    normal.set(b.normals, v * 3);
    uv.set(b.uvs, v * 2);
    color.set(b.colors, v * 3);
    if (tile) tile.set(b.tiles, v * 3);
    if (depth) depth.set(b.depths, v);
    const src = b.indices;
    for (let k = 0; k < src.length; k++) index[i + k] = src[k] + v;
    v += b.positions.length / 3;
    i += src.length;
  }
  // Bounding sphere, the way three's computeBoundingSphere does it (centre of
  // the bounding box, radius to the farthest vertex) — worked out here so the
  // page does not have to walk the vertices again.
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let p = 0; p < position.length; p += 3) {
    const x = position[p], y = position[p + 1], z = position[p + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const sx = (x0 + x1) / 2, sy = (y0 + y1) / 2, sz = (z0 + z1) / 2;
  let r2 = 0;
  for (let p = 0; p < position.length; p += 3) {
    const dx = position[p] - sx, dy = position[p + 1] - sy, dz = position[p + 2] - sz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > r2) r2 = d;
  }
  return { position, normal, uv, color, tile, depth, index, sphere: [sx, sy, sz, Math.sqrt(r2)], leafCount: 0 };
}

// The ArrayBuffers of a meshVolume result, for postMessage's transfer list.
export function meshTransferables(mesh) {
  const out = [];
  for (const g of [mesh.solid, mesh.cutout, mesh.water]) {
    if (!g) continue;
    out.push(g.position.buffer, g.normal.buffer, g.uv.buffer, g.color.buffer, g.index.buffer);
    if (g.tile) out.push(g.tile.buffer);
    if (g.depth) out.push(g.depth.buffer);
  }
  return out;
}

const decodeAO = (bits) => bits === AO_UNIFORM
  ? [3, 3, 3, 3]
  : [bits & 3, (bits >> 2) & 3, (bits >> 4) & 3, (bits >> 6) & 3];

// Mask entries pack: block id (9 bits) | AO bits (8 bits) | skylight bucket (2 bits).
// The skylight bucket keeps greedy merging correct: quads spanning a light
// discontinuity stay split so each merged quad has a single uniform brightness.
// 4 buckets: 0=DARK_FLOOR, 1=low, 2=mid, 3=full (≈1.0). This is a deliberate
// coarse quantisation — fine enough for smooth caves, coarse enough to keep the
// bucket simple and not shatter every face into tiny quads.
const SL_BITS = 2;
const SL_SHIFT = ID_BITS + 8; // sits above the AO byte
// One more bit above the skylight bucket, so faces that differ in it never
// merge. For terrain it marks a face that looks into water (the ground under
// a lake). For water it marks the top layer of the body, whose surface is
// lowered — and a water top face reuses the AO byte for its corner depths.
const FLAG_SHIFT = SL_SHIFT + 2;
const SL_MASK = (1 << SL_BITS) - 1; // 0b11
const SL_BUCKETS = 4; // 0..3

// Quantise a 0..1 skylight value to a 0..3 bucket index.
function slBucket(sl) {
  return Math.min(SL_BUCKETS - 1, Math.floor(sl * SL_BUCKETS));
}

// Decode bucket index back to a representative skylight value used for
// pushQuad. Midpoint of each bucket so colours are consistent within a merged
// quad regardless of where the merge boundary fell.
const SL_VALUES = [
  DARK_FLOOR,                              // bucket 0: deep underground
  DARK_FLOOR + (1.0 - DARK_FLOOR) / 3,    // bucket 1: transition low
  DARK_FLOOR + (1.0 - DARK_FLOOR) * 2/3,  // bucket 2: transition high
  1.0,                                     // bucket 3: full surface light
];

// Greedy mesh of one chunk from its snapshot (see buildVolume). Returns
// { solid, cutout, water } — typed arrays for up to three geometries, any of
// which may be null: every solid face in one, every cut-out face (leaves
// first, `leafCount` indices of them) in another, and the translucent water
// sheet in the third.
export function meshVolume(vol, cx, cz) {
  const terrain = [emptyBuf(), emptyBuf(), emptyBuf()]; // by TILE_KIND: solid, leaves, other cut-outs
  const water = emptyBuf();
  // The buffer a tile's faces go in, primed so the next faces pushed into it
  // are stamped with that tile.
  const bufFor = (tile) => {
    const buf = terrain[TILE_KIND[tile]];
    buf.tile = tile;
    return buf;
  };
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  resetTints(baseX, baseZ);

  // Any cell of the snapshot: lx/lz in -1..CHUNK_SIZE, ly in -1..WORLD_HEIGHT.
  const at = (lx, ly, lz) => vol[(ly + 1) * PLANE + (lz + 1) * PAD + lx + 1];

  // Sky-roof height of every column (ring included), and how high the chunk
  // goes: nothing above `top` can have a face, so the passes stop there.
  const { roof, top } = scanColumns(vol);
  if (top < 0) return { solid: null, cutout: null, water: null };
  const DIMS = [CHUNK_SIZE, top + 1, CHUNK_SIZE];

  // One mask for every layer. The merge below zeroes each cell it consumes,
  // so the mask is clean again by the time the next layer fills it.
  const mask = new Int32Array(CHUNK_SIZE * Math.max(CHUNK_SIZE, top + 1));

  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3;
    const du = DIMS[u], dv = DIMS[v];
    // The sweep walks the snapshot by index: one step along an axis is a
    // fixed stride, so a cell's neighbours are plain offsets from it.
    const sa = STRIDE[axis], su = STRIDE[u], sv = STRIDE[v];

    for (let dir = -1; dir <= 1; dir += 2) {
      const faceType = axis === 1 ? (dir > 0 ? 'top' : 'bottom') : 'side';
      const normal = [0, 0, 0]; normal[axis] = dir;
      const step = sa * dir; // from a cell to the one its face looks at

      for (let layer = 0; layer < DIMS[axis]; layer++) {
        let faces = 0;
        const layerAt = ORIGIN + layer * sa;
        for (let j = 0; j < dv; j++) {
          let idx = layerAt + j * sv;
          for (let i = 0; i < du; i++, idx += su) {
            const id = vol[idx];
            if (id === 0 || NON_CUBE[id]) continue; // non-cubes drawn separately
            const nIdx = idx + step;
            const neighbor = vol[nIdx];
            if (OPAQUE[neighbor]) continue;
            // Skip faces between two cells of the same non-cube liquid (lava is
            // opaque but still merges its surface like water).
            if (SELF_CULL[id] && neighbor === id) continue;

            // 4-corner AO for this face (liquids skip it to merge maximally):
            // each corner looks at the two cells beside it in the face's
            // plane and the one diagonal. A water top face puts the depth of
            // the water around each corner there instead (see FLAG_SHIFT).
            let aoBits = AO_UNIFORM, flag;
            if (id === WATER) {
              flag = WATERY[vol[idx + PLANE]] ^ 1; // nothing but air (or land) above: the surface layer
              if (faceType === 'top') {
                aoBits = 0;
                for (let ci = 0; ci < 4; ci++) {
                  aoBits |= shoreDepth(vol, idx, AO_CORNERS[ci][0] * su, AO_CORNERS[ci][1] * sv) << (ci * 2);
                }
              }
            } else {
              flag = WATERY[neighbor]; // the face is under water
              if (id !== LAVA) {
                aoBits = 0;
                for (let ci = 0; ci < 4; ci++) {
                  const ou = AO_CORNERS[ci][0] * su, ov = AO_CORNERS[ci][1] * sv;
                  const s1 = OPAQUE[vol[nIdx + ou]], s2 = OPAQUE[vol[nIdx + ov]];
                  const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + OPAQUE[vol[nIdx + ou + ov]]);
                  aoBits |= ao << (ci * 2);
                }
              }
            }

            // Skylight bucket, from the sky-roof of the column the face is
            // in: for a side face that is the neighbour air cell's column —
            // it is lit by whatever sky reaches *that* column, even across a
            // chunk border — and for top/bottom faces it is the cell's own
            // (the same column as the neighbour's, one layer up or down).
            const y = axis === 1 ? layer : (u === 1 ? i : j);
            const sl = skylightAt(y, roof[nIdx % PLANE]);

            mask[j * du + i] = id | (aoBits << ID_BITS) | (slBucket(sl) << SL_SHIFT) | (flag << FLAG_SHIFT);
            faces++;
          }
        }
        if (faces === 0) continue;

        const faceCoord = layer + (dir > 0 ? 1 : 0);
        for (let j = 0; j < dv; j++) {
          for (let i = 0; i < du; ) {
            const key = mask[j * du + i];
            if (key === 0) { i++; continue; }

            let w = 1;
            while (i + w < du && mask[j * du + i + w] === key) w++;
            let h = 1, grow = true;
            while (j + h < dv && grow) {
              for (let k = 0; k < w; k++) if (mask[(j + h) * du + i + k] !== key) { grow = false; break; }
              if (grow) h++;
            }

            const id = key & ID_MASK;
            const ao = decodeAO((key >>> ID_BITS) & 0xff);
            const skylight = SL_VALUES[(key >>> SL_SHIFT) & SL_MASK];
            const flag = (key >>> FLAG_SHIFT) & 1;
            const q = { axis, u, v, faceCoord, i, j, w, h, dir, normal, faceType, baseX, baseZ, id, ao, skylight, flag };
            if (id === WATER) {
              pushQuad(water, q);
            } else {
              pushQuad(bufFor(faceMaterialIndex(id, faceType)), q);
            }

            for (let l = 0; l < h; l++) for (let k = 0; k < w; k++) mask[(j + l) * du + i + k] = 0;
            i += w;
          }
        }
      }
    }
  }

  // Special pass: non-cube blocks. Plants become crossed quads; doors thin
  // panels (orientation read from the wall they sit in); stairs two boxes;
  // beds a low mattress slab.
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let y = 1; y <= top && y < WORLD_HEIGHT - 1; y++) {
        const id = at(lx, y, lz);
        if (!NON_CUBE[id]) continue;
        const flow = FLOW.get(id);
        if (!SPECIAL.has(id) && !flow) continue; // a torch: drawn as a stick mesh elsewhere
        const wx = baseX + lx, wz = baseZ + lz;

        // Per-cell skylight for the special pass (plants, boxes).  Same
        // column lookup as the greedy pass so special blocks underground darken
        // consistently with the surrounding cube faces.
        const roofY = roof[(lz + 1) * PAD + lx + 1];
        const cellSl = skylightAt(y, roofY);

        if (flow) {
          // Fed from above: draw the full cell so falling streams read as one
          // continuous column instead of a stack of short boxes.
          const above = at(lx, y + 1, lz);
          const below = at(lx, y - 1, lz);
          const h = liquidKind(above) === flow.kind ? 1 : flow.height;
          // Water shares the translucent water buffer/material; lava flows use
          // the emissive lava tile via the grouped material array.
          const buf = flow.kind === 'water' ? water : bufFor(faceMaterialIndex(id, 'side'));
          const open = (nb) => !isOpaque(nb) && liquidKind(nb) !== flow.kind;
          pushLiquidBox(buf, wx, y, wz, h, {
            top: liquidKind(above) !== flow.kind,
            bottom: !isOpaque(below) && liquidKind(below) !== flow.kind,
            px: open(at(lx + 1, y, lz)), nx: open(at(lx - 1, y, lz)),
            pz: open(at(lx, y, lz + 1)), nz: open(at(lx, y, lz - 1)),
          }, cellSl);
        } else if (PLANTS.has(id)) {
          const tint = id === TALL_GRASS ? climateTint(wx, wz) : [1, 1, 1];
          const face = id === CAVE_VINE && at(lx, y - 1, lz) !== CAVE_VINE ? 'top' : 'side';
          pushCross(bufFor(faceMaterialIndex(id, face)), wx, y, wz, tint, cellSl);
        } else if (id === DOOR || id === DOOR_OPEN) {
          // Hinge orientation from the wall: solid x-neighbours = doorway runs
          // along x (panel spans x); otherwise it spans z. The open panel
          // swings to the cell edge so the passage is clear.
          const wallX = isSolid(at(lx - 1, y, lz)) || isSolid(at(lx + 1, y, lz));
          const isTop = at(lx, y - 1, lz) === DOOR || at(lx, y - 1, lz) === DOOR_OPEN;
          const mat = faceMaterialIndex(DOOR, isTop ? 'top' : 'side');
          let b; // panel bounds [x0,y0,z0,x1,y1,z1] within the cell
          if (id === DOOR) {
            b = wallX ? [0, 0, 0.42, 1, 1, 0.58] : [0.42, 0, 0, 0.58, 1, 1];
          } else {
            b = wallX ? [0.84, 0, 0, 1, 1, 1] : [0, 0, 0.84, 1, 1, 1];
          }
          pushBox(bufFor, wx + b[0], y + b[1], wz + b[2], wx + b[3], y + b[4], wz + b[5], mat, mat, mat, cellSl);
        } else if (STAIR_DIR[id]) {
          const matT = faceMaterialIndex(id, 'top');
          const matS = faceMaterialIndex(id, 'side');
          const matB = faceMaterialIndex(id, 'bottom');
          // Bottom slab + the high half on the ascending side.
          pushBox(bufFor, wx, y, wz, wx + 1, y + 0.5, wz + 1, matT, matS, matB, cellSl);
          const d = STAIR_DIR[id];
          const u = d === 'px' ? [0.5, 0, 1, 1] : d === 'nx' ? [0, 0, 0.5, 1]
            : d === 'pz' ? [0, 0.5, 1, 1] : [0, 0, 1, 0.5]; // [x0,z0,x1,z1]
          pushBox(bufFor, wx + u[0], y + 0.5, wz + u[1], wx + u[2], y + 1, wz + u[3], matT, matS, matB, cellSl);
        } else if (id === BED || id === BED_HEAD) {
          // Mattress slab; halves extend to meet their partner cell flush.
          let bx0 = 0.03, bx1 = 0.97, bz0 = 0.03, bz1 = 0.97;
          const partner = id === BED ? BED_HEAD : BED;
          if (at(lx + 1, y, lz) === partner) bx1 = 1;
          if (at(lx - 1, y, lz) === partner) bx0 = 0;
          if (at(lx, y, lz + 1) === partner) bz1 = 1;
          if (at(lx, y, lz - 1) === partner) bz0 = 0;
          pushBox(bufFor,
            wx + bx0, y, wz + bz0, wx + bx1, y + 0.55, wz + bz1,
            faceMaterialIndex(id, 'top'), faceMaterialIndex(id, 'side'), faceMaterialIndex(id, 'bottom'), cellSl);
        } else if (SLABS.has(id)) {
          pushBox(bufFor, wx, y, wz, wx + 1, y + 0.5, wz + 1,
            faceMaterialIndex(id, 'top'), faceMaterialIndex(id, 'side'), faceMaterialIndex(id, 'bottom'), cellSl);
        } else if (id === LADDER) {
          // Flat against whichever neighbouring wall it hangs on.
          const mat = faceMaterialIndex(LADDER, 'side');
          let b = [0.42, 0, 0, 0.5, 1, 1]; // default: centred, spanning z
          if (isSolid(at(lx, y, lz - 1))) b = [0, 0, 0.02, 1, 1, 0.1];
          else if (isSolid(at(lx, y, lz + 1))) b = [0, 0, 0.9, 1, 1, 0.98];
          else if (isSolid(at(lx - 1, y, lz))) b = [0.02, 0, 0, 0.1, 1, 1];
          else if (isSolid(at(lx + 1, y, lz))) b = [0.9, 0, 0, 0.98, 1, 1];
          pushBox(bufFor, wx + b[0], y + b[1], wz + b[2], wx + b[3], y + b[4], wz + b[5], mat, mat, mat, cellSl);
        } else if (id === PANE) {
          // Thin glass sheet aligned with its solid neighbours (cross if both).
          const mat = faceMaterialIndex(PANE, 'side');
          const xConn = isSolid(at(lx - 1, y, lz)) || isSolid(at(lx + 1, y, lz));
          const zConn = isSolid(at(lx, y, lz - 1)) || isSolid(at(lx, y, lz + 1));
          if (xConn || !zConn) pushBox(bufFor, wx, y, wz + 0.44, wx + 1, y + 1, wz + 0.56, mat, mat, mat, cellSl);
          if (zConn) pushBox(bufFor, wx + 0.44, y, wz, wx + 0.56, y + 1, wz + 1, mat, mat, mat, cellSl);
        } else if (id === FENCE) {
          const mat = faceMaterialIndex(FENCE, 'side');
          // Centre post...
          pushBox(bufFor, wx + 0.36, y, wz + 0.36, wx + 0.64, y + 1, wz + 0.64, mat, mat, mat, cellSl);
          // ...with two rails toward each solid/fence neighbour.
          const rails = [
            [1, 0, wx + 0.64, wx + 1, wz + 0.42, wz + 0.58],
            [-1, 0, wx, wx + 0.36, wz + 0.42, wz + 0.58],
            [0, 1, wx + 0.42, wx + 0.58, wz + 0.64, wz + 1],
            [0, -1, wx + 0.42, wx + 0.58, wz, wz + 0.36],
          ];
          for (const [dx, dz, rx0, rx1, rz0, rz1] of rails) {
            if (!isSolid(at(lx + dx, y, lz + dz))) continue;
            pushBox(bufFor, rx0, y + 0.3, rz0, rx1, y + 0.45, rz1, mat, mat, mat, cellSl);
            pushBox(bufFor, rx0, y + 0.72, rz0, rx1, y + 0.87, rz1, mat, mat, mat, cellSl);
          }
        }
      }
    }
  }

  const cutout = assemble(terrain[1], terrain[2]);
  // Leaves sit first in the cut-out geometry, so World can draw just them
  // (as the canopy's shadow caster) with a draw range.
  if (cutout) cutout.leafCount = terrain[1].indices.length;
  return { solid: assemble(terrain[0]), cutout, water: assemble(water) };
}

// Push an axis-aligned box with per-face materials, face shading, and UVs
// scaled to each face's size. Used by the special (non-cube) block pass.
// sl = skylight multiplier (1.0 at surface, DARK_FLOOR deep underground).
function pushBox(bufFor, x0, y0, z0, x1, y1, z1, matTop, matSide, matBottom, sl = 1.0) {
  const faces = [
    [matSide, [1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], SHADE.side, z1 - z0, y1 - y0],
    [matSide, [-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], SHADE.side, z1 - z0, y1 - y0],
    [matTop, [0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], SHADE.top, x1 - x0, z1 - z0],
    [matBottom, [0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], SHADE.bottom, x1 - x0, z1 - z0],
    [matSide, [0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], SHADE.side, x1 - x0, y1 - y0],
    [matSide, [0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], SHADE.side, x1 - x0, y1 - y0],
  ];
  for (const [mat, n, c, shade, su, sv] of faces) {
    const buf = bufFor(mat);
    const vi = buf.positions.length / 3;
    const uvs = [[0, 0], [su, 0], [su, sv], [0, sv]];
    const bright = shade * sl;
    for (let k = 0; k < 4; k++) {
      buf.positions.push(c[k][0], c[k][1], c[k][2]);
      buf.normals.push(n[0], n[1], n[2]);
      buf.uvs.push(uvs[k][0], uvs[k][1]);
      buf.colors.push(bright, bright, bright);
    }
    stampTile(buf);
    buf.indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
  }
}

// Push a unit-footprint box of height h into a single buffer, drawing only the
// requested faces (neighbouring same-liquid cells and opaque walls are culled
// by the caller). Used for flowing-liquid cells.
function pushLiquidBox(buf, x, y, z, h, faces, sl = 1.0) {
  const x0 = x, x1 = x + 1, z0 = z, z1 = z + 1, y0 = y, y1 = y + h;
  const defs = [
    ['px', [1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], SHADE.side, 1, h],
    ['nx', [-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], SHADE.side, 1, h],
    ['top', [0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], SHADE.top, 1, 1],
    ['bottom', [0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], SHADE.bottom, 1, 1],
    ['pz', [0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], SHADE.side, 1, h],
    ['nz', [0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], SHADE.side, 1, h],
  ];
  for (const [face, n, c, shade, su, sv] of defs) {
    if (!faces[face]) continue;
    const vi = buf.positions.length / 3;
    const uvs = [[0, 0], [su, 0], [su, sv], [0, sv]];
    const bright = shade * sl;
    for (let k = 0; k < 4; k++) {
      buf.positions.push(c[k][0], c[k][1], c[k][2]);
      buf.normals.push(n[0], n[1], n[2]);
      buf.uvs.push(uvs[k][0], uvs[k][1]);
      buf.colors.push(bright, bright, bright);
      if (buf.tile < 0) buf.depths.push(FLOW_DEPTH); // the water buffer
    }
    stampTile(buf);
    buf.indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
  }
}

// Two crossed quads spanning a cell's diagonals (slightly inset).
// sl = skylight multiplier so cave plants darken underground like cube faces.
function pushCross(buf, x, y, z, tint, sl = 1.0) {
  const a = 0.15, b = 0.85;
  const quads = [
    [[x + a, z + a], [x + b, z + b]], // diagonal /
    [[x + a, z + b], [x + b, z + a]], // diagonal \
  ];
  for (const [[x0, z0], [x1, z1]] of quads) {
    const vi = buf.positions.length / 3;
    const corners = [[x0, y, z0], [x1, y, z1], [x1, y + 1, z1], [x0, y + 1, z0]];
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let k = 0; k < 4; k++) {
      buf.positions.push(corners[k][0], corners[k][1], corners[k][2]);
      buf.normals.push(0, 1, 0); // lit like the ground it grows from
      buf.uvs.push(uvs[k][0], uvs[k][1]);
      buf.colors.push(tint[0] * sl, tint[1] * sl, tint[2] * sl);
    }
    stampTile(buf);
    buf.indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
  }
}
