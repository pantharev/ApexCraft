import * as THREE from 'three';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../config.js';
import { getBlock, isOpaque, isSolid, getBlockId } from '../blocks/BlockRegistry.js';
import { faceMaterialIndex, WATER_MATERIAL_INDEX } from '../textures/atlas.js';
import { Noise } from '../world/noise.js';

const SHADE = { top: 1.0, bottom: 0.5, side: 0.8 };
const DIMS = [CHUNK_SIZE, WORLD_HEIGHT, CHUNK_SIZE];
const WATER = getBlockId('water');
const LAVA = getBlockId('lava'); // opaque glowing liquid; culls its own internal faces like water
const TORCH = getBlockId('torch'); // rendered as a separate stick mesh, not in the chunk
const GRASS = getBlockId('grass');
const LEAVES = getBlockId('oak_leaves');
const TALL_GRASS = getBlockId('tall_grass');
// Cross-plants render as two diagonal quads, not cubes.
// GLOW_MUSHROOM (id 52) is added here so it renders as crossed quads underground.
const PLANTS = new Set([TALL_GRASS, getBlockId('poppy'), getBlockId('dandelion'), getBlockId('glow_mushroom')]);
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
// The precompute is O(CHUNK_SIZE² × WORLD_HEIGHT) per chunk mesh and runs once
// per buildChunkGeometry call — well within the existing chunk-budget structure.
// ---------------------------------------------------------------------------
const DARK_FLOOR   = 0.15;  // minimum vertex brightness deep underground
const FADE_BLOCKS  = 6;     // blocks below the roof over which light transitions

// Per-column sky-roof heights for the chunk: skyHeight[lz*CHUNK_SIZE+lx] = y of
// the first opaque block scanned top-down (the roof that blocks the sky). The
// WORLD_HEIGHT sentinel means the column is fully open to the sky; skylightAt
// treats roofY >= WORLD_HEIGHT as fully lit. WORLD_HEIGHT (128) fits a Uint8Array.
function buildSkyHeightMap(chunk) {
  const skyHeight = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(WORLD_HEIGHT);
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
        if (isOpaque(chunk.get(lx, y, lz))) {
          skyHeight[lz * CHUNK_SIZE + lx] = y;
          break;
        }
      }
    }
  }
  return skyHeight;
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

function emptyBuf() { return { positions: [], normals: [], uvs: [], colors: [], indices: [] }; }

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Climate tint for living surfaces: lush (wet) areas read deep green, hot dry
// areas turn yellow-brown, blended per-vertex so the gradient is seamless.
function climateTint(wx, wz) {
  const dry = clamp01(0.5 + (Noise.temperature(wx, wz) - Noise.humidity(wx, wz)) * 0.55);
  return [0.88 + 0.24 * dry, 1.04 - 0.07 * dry, 0.95 - 0.17 * dry];
}

// Push one quad (4 verts) into a buffer. uvLocal tiles 0..w / 0..h so the tile
// repeats across a greedy-merged quad (textures use RepeatWrapping).
//
// q.skylight: per-quad skylight factor (0..1).  For greedy-merged quads spanning
// a uniform AO + uniform skylight bucket the factor is the same for all four
// corners; this keeps the merge-key valid (see buildChunkGeometry).  The slight
// loss of per-vertex gradient within a merged quad is imperceptible at the coarse
// bucket granularity we use (4-bucket: 0.0/0.33/0.67/1.0).
function pushQuad(buf, q) {
  const shade = SHADE[q.faceType];
  const sl = (q.skylight !== undefined) ? q.skylight : 1.0; // skylight factor
  const corner = (uu, vv) => {
    const a = [0, 0, 0];
    a[q.axis] = q.faceCoord; a[q.u] = uu; a[q.v] = vv;
    return [q.baseX + a[0], a[1], q.baseZ + a[2]];
  };
  const verts = [
    [corner(q.i, q.j), 0, 0],
    [corner(q.i + q.w, q.j), q.w, 0],
    [corner(q.i + q.w, q.j + q.h), q.w, q.h],
    [corner(q.i, q.j + q.h), 0, q.h],
  ];
  const tinted = (q.id === GRASS && q.faceType === 'top') || q.id === LEAVES;
  const vi = buf.positions.length / 3;
  for (let k = 0; k < 4; k++) {
    const [c, u, v] = verts[k];
    buf.positions.push(c[0], c[1], c[2]);
    buf.normals.push(q.normal[0], q.normal[1], q.normal[2]);
    buf.uvs.push(u, v);
    // Corners tucked against neighbouring blocks darken (soft contact shadow).
    // Skylight (sl) multiplied in so underground faces are genuinely dark while
    // surface faces (sl=1.0) are unchanged from the previous behaviour.
    const aoF = 0.6 + 0.4 * (q.ao[k] / 3);
    const bright = shade * aoF * sl;
    if (tinted) {
      const t = climateTint(c[0], c[2]);
      buf.colors.push(bright * t[0], bright * t[1], bright * t[2]);
    } else {
      buf.colors.push(bright, bright, bright);
    }
  }
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

// Assemble one BufferGeometry from a set of per-material buffers, adding a draw
// group per material so a single mesh can use the shared material array.
function assembleGrouped(byMat) {
  const positions = [], normals = [], uvs = [], colors = [], indices = [];
  const groups = [];
  let vBase = 0;
  for (const [matIndex, b] of byMat) {
    if (b.positions.length === 0) continue;
    const start = indices.length;
    positions.push(...b.positions);
    normals.push(...b.normals);
    uvs.push(...b.uvs);
    colors.push(...b.colors);
    for (const idx of b.indices) indices.push(idx + vBase);
    vBase += b.positions.length / 3;
    groups.push({ start, count: b.indices.length, materialIndex: matIndex });
  }
  if (positions.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  for (const gr of groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  g.computeBoundingSphere();
  return g;
}

function assembleSingle(buf) {
  if (buf.positions.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(buf.colors, 3));
  g.setIndex(buf.indices);
  g.computeBoundingSphere();
  return g;
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

// Greedy mesh + texture grouping. Returns { opaque, water } geometries.
export function buildChunkGeometry(chunk, worldGet) {
  const byMat = new Map();   // matIndex -> buffer (opaque + cutout)
  const water = emptyBuf();
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;

  const at = (lx, ly, lz) =>
    (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE && ly >= 0 && ly < WORLD_HEIGHT)
      ? chunk.get(lx, ly, lz)
      : worldGet(baseX + lx, ly, baseZ + lz);
  const occ = (x, y, z) => (isOpaque(at(x, y, z)) ? 1 : 0);

  // Precompute per-column sky-roof heights once for the whole chunk.
  // skyHeight[lz * CHUNK_SIZE + lx] = y of the first solid block from top.
  const skyHeightMap = buildSkyHeightMap(chunk);

  // Sky-roof height for any column, including the one-block ring outside this
  // chunk: border faces sample the *neighbour's* column, and clamping back into
  // the local chunk (whose roof is the terrain surface above the face) painted
  // dark seams on daylight cliff walls at every chunk boundary. Neighbour
  // columns are scanned on demand via worldGet and cached — at most the 4×16
  // border ring per mesh build (World.update generates neighbours first, so the
  // scan always sees real terrain).
  const borderRoof = new Map();
  const roofAt = (lx, lz) => {
    if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
      return skyHeightMap[lz * CHUNK_SIZE + lx];
    }
    const k = (lx + 1) * (CHUNK_SIZE + 2) + (lz + 1); // lx/lz ∈ -1..CHUNK_SIZE
    let r = borderRoof.get(k);
    if (r === undefined) {
      r = WORLD_HEIGHT; // open sky unless an opaque roof is found
      const wx = baseX + lx, wz = baseZ + lz;
      for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
        if (isOpaque(worldGet(wx, y, wz))) { r = y; break; }
      }
      borderRoof.set(k, r);
    }
    return r;
  };

  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3;
    const du = DIMS[u], dv = DIMS[v];

    for (let dir = -1; dir <= 1; dir += 2) {
      const faceType = axis === 1 ? (dir > 0 ? 'top' : 'bottom') : 'side';
      const normal = [0, 0, 0]; normal[axis] = dir;

      for (let layer = 0; layer < DIMS[axis]; layer++) {
        const mask = new Array(du * dv).fill(0);
        const cell = [0, 0, 0];
        for (let j = 0; j < dv; j++) {
          for (let i = 0; i < du; i++) {
            cell[axis] = layer; cell[u] = i; cell[v] = j;
            const id = at(cell[0], cell[1], cell[2]);
            if (id === 0 || id === TORCH || SPECIAL.has(id)) continue; // non-cubes drawn separately
            const nb = [cell[0], cell[1], cell[2]]; nb[axis] += dir;
            const neighbor = at(nb[0], nb[1], nb[2]);
            const block = getBlock(id);
            if (isOpaque(neighbor)) continue;
            // Skip faces between two cells of the same non-cube liquid (lava is
            // opaque but still merges its surface like water).
            if ((block.transparent || id === LAVA) && neighbor === id) continue;

            // 4-corner AO for this face (liquids skip it to merge maximally).
            let aoBits = AO_UNIFORM;
            if (id !== WATER && id !== LAVA) {
              aoBits = 0;
              for (let ci = 0; ci < 4; ci++) {
                const [su, sv] = AO_CORNERS[ci];
                const p1 = [nb[0], nb[1], nb[2]]; p1[u] += su;
                const p2 = [nb[0], nb[1], nb[2]]; p2[v] += sv;
                const pc = [nb[0], nb[1], nb[2]]; pc[u] += su; pc[v] += sv;
                const s1 = occ(p1[0], p1[1], p1[2]);
                const s2 = occ(p2[0], p2[1], p2[2]);
                const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + occ(pc[0], pc[1], pc[2]));
                aoBits |= ao << (ci * 2);
              }
            }

            // Skylight bucket: side faces (axis 0/2) sample the neighbour air
            // cell's column — the face surface lives at nb, so it's lit by
            // whatever sky reaches that column, even across a chunk border.
            // Top/bottom faces use the cell's own column.
            const faceLx = (axis === 0) ? nb[0] : cell[0];
            const faceLz = (axis === 2) ? nb[2] : cell[2];
            const sl = skylightAt(cell[1], roofAt(faceLx, faceLz));
            const slB = slBucket(sl);

            mask[j * du + i] = id | (aoBits << ID_BITS) | (slB << SL_SHIFT);
          }
        }

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
            const q = { axis, u, v, faceCoord, i, j, w, h, dir, normal, faceType, baseX, baseZ, id, ao, skylight };
            if (id === WATER) {
              pushQuad(water, q);
            } else {
              const matIndex = faceMaterialIndex(id, faceType);
              let buf = byMat.get(matIndex);
              if (!buf) { buf = emptyBuf(); byMat.set(matIndex, buf); }
              pushQuad(buf, q);
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
  const bufFor = (matIndex) => {
    let buf = byMat.get(matIndex);
    if (!buf) { buf = emptyBuf(); byMat.set(matIndex, buf); }
    return buf;
  };
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let y = 1; y < WORLD_HEIGHT - 1; y++) {
        const id = chunk.get(lx, y, lz);
        if (!SPECIAL.has(id)) continue;
        const wx = baseX + lx, wz = baseZ + lz;

        // Per-cell skylight for the special pass (plants, boxes).  Same
        // column lookup as the greedy pass so special blocks underground darken
        // consistently with the surrounding cube faces.
        const roofY = skyHeightMap[lz * CHUNK_SIZE + lx];
        const cellSl = skylightAt(y, roofY);

        if (PLANTS.has(id)) {
          const tint = id === TALL_GRASS ? climateTint(wx, wz) : [1, 1, 1];
          pushCross(bufFor(faceMaterialIndex(id, 'side')), wx, y, wz, tint, cellSl);
        } else if (id === DOOR || id === DOOR_OPEN) {
          // Hinge orientation from the wall: solid x-neighbours = doorway runs
          // along x (panel spans x); otherwise it spans z. The open panel
          // swings to the cell edge so the passage is clear.
          const wallX = isSolid(at(lx - 1, y, lz)) || isSolid(at(lx + 1, y, lz));
          const isTop = chunk.get(lx, y - 1, lz) === DOOR || chunk.get(lx, y - 1, lz) === DOOR_OPEN;
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

  return { opaque: assembleGrouped(byMat), water: assembleSingle(water) };
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
    buf.indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
  }
}
