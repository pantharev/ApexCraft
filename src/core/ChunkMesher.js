import * as THREE from 'three';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../config.js';
import { getBlock, isOpaque, getBlockId } from '../blocks/BlockRegistry.js';
import { faceMaterialIndex, WATER_MATERIAL_INDEX } from '../textures/atlas.js';

const SHADE = { top: 1.0, bottom: 0.5, side: 0.8 };
const DIMS = [CHUNK_SIZE, WORLD_HEIGHT, CHUNK_SIZE];
const WATER = getBlockId('water');
const TORCH = getBlockId('torch'); // rendered as a separate stick mesh, not in the chunk

function emptyBuf() { return { positions: [], normals: [], uvs: [], colors: [], indices: [] }; }

// Push one quad (4 verts) into a buffer. uvLocal tiles 0..w / 0..h so the tile
// repeats across a greedy-merged quad (textures use RepeatWrapping).
function pushQuad(buf, q) {
  const shade = SHADE[q.faceType];
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
  const vi = buf.positions.length / 3;
  for (const [c, u, v] of verts) {
    buf.positions.push(c[0], c[1], c[2]);
    buf.normals.push(q.normal[0], q.normal[1], q.normal[2]);
    buf.uvs.push(u, v);
    buf.colors.push(shade, shade, shade);
  }
  if (q.dir > 0) buf.indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
  else buf.indices.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
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
            if (id === 0 || id === TORCH) continue; // torches drawn separately
            const nb = [cell[0], cell[1], cell[2]]; nb[axis] += dir;
            const neighbor = at(nb[0], nb[1], nb[2]);
            const block = getBlock(id);
            if (isOpaque(neighbor)) continue;
            if (block.transparent && neighbor === id) continue;
            mask[j * du + i] = id;
          }
        }

        const faceCoord = layer + (dir > 0 ? 1 : 0);
        for (let j = 0; j < dv; j++) {
          for (let i = 0; i < du; ) {
            const id = mask[j * du + i];
            if (id === 0) { i++; continue; }

            let w = 1;
            while (i + w < du && mask[j * du + i + w] === id) w++;
            let h = 1, grow = true;
            while (j + h < dv && grow) {
              for (let k = 0; k < w; k++) if (mask[(j + h) * du + i + k] !== id) { grow = false; break; }
              if (grow) h++;
            }

            const q = { axis, u, v, faceCoord, i, j, w, h, dir, normal, faceType, baseX, baseZ };
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

  return { opaque: assembleGrouped(byMat), water: assembleSingle(water) };
}
