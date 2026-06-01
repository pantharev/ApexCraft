import * as THREE from 'three';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../config.js';
import { getBlock, isOpaque } from '../blocks/BlockRegistry.js';

// Per-face shading so cubes read as 3D without textures.
const SHADE = { top: 1.0, bottom: 0.5, side: 0.8 };
const DIMS = [CHUNK_SIZE, WORLD_HEIGHT, CHUNK_SIZE];

function emptyBuffers() {
  return { positions: [], normals: [], colors: [], indices: [] };
}

function toGeometry(buf) {
  if (buf.positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buf.normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(buf.colors, 3));
  geometry.setIndex(buf.indices);
  geometry.computeBoundingSphere(); // used by Three.js frustum culling
  return geometry;
}

// Greedy mesher: for each of the 6 face directions, build a per-layer mask of
// visible faces (keyed by block id) and merge identical neighbouring cells into
// the largest possible rectangles, emitting one quad per rectangle. This
// collapses big flat areas (ground, water, walls) from thousands of quads into
// a handful. Returns { opaque, transparent } geometries.
export function buildChunkGeometry(chunk, worldGet) {
  const opaque = emptyBuffers();
  const transparent = emptyBuffers();
  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;

  // Block id at local coords, reaching into neighbour chunks when out of range.
  const at = (lx, ly, lz) => {
    if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE && ly >= 0 && ly < WORLD_HEIGHT) {
      return chunk.get(lx, ly, lz);
    }
    return worldGet(baseX + lx, ly, baseZ + lz);
  };

  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const du = DIMS[u];
    const dv = DIMS[v];

    for (let dir = -1; dir <= 1; dir += 2) {
      const faceType = axis === 1 ? (dir > 0 ? 'top' : 'bottom') : 'side';
      const normal = [0, 0, 0];
      normal[axis] = dir;

      for (let layer = 0; layer < DIMS[axis]; layer++) {
        // Build the visibility mask for this slice.
        const mask = new Array(du * dv).fill(0);
        const cell = [0, 0, 0];
        for (let j = 0; j < dv; j++) {
          for (let i = 0; i < du; i++) {
            cell[axis] = layer; cell[u] = i; cell[v] = j;
            const id = at(cell[0], cell[1], cell[2]);
            if (id === 0) continue;
            const nb = [cell[0], cell[1], cell[2]];
            nb[axis] += dir;
            const neighbor = at(nb[0], nb[1], nb[2]);
            const block = getBlock(id);
            // Face shows unless the neighbour is opaque, or this is a
            // transparent block facing the same kind (water/leaves/glass).
            if (isOpaque(neighbor)) continue;
            if (block.transparent && neighbor === id) continue;
            mask[j * du + i] = id;
          }
        }

        // Greedily merge the mask into rectangles.
        const faceCoord = layer + (dir > 0 ? 1 : 0);
        for (let j = 0; j < dv; j++) {
          for (let i = 0; i < du; ) {
            const id = mask[j * du + i];
            if (id === 0) { i++; continue; }

            let w = 1;
            while (i + w < du && mask[j * du + i + w] === id) w++;

            let h = 1;
            let grow = true;
            while (j + h < dv && grow) {
              for (let k = 0; k < w; k++) {
                if (mask[(j + h) * du + i + k] !== id) { grow = false; break; }
              }
              if (grow) h++;
            }

            emitQuad(
              id === 0 ? opaque : (getBlock(id).transparent ? transparent : opaque),
              { axis, u, v, faceCoord, i, j, w, h, dir, normal, faceType, id, baseX, baseZ }
            );

            for (let l = 0; l < h; l++) {
              for (let k = 0; k < w; k++) mask[(j + l) * du + i + k] = 0;
            }
            i += w;
          }
        }
      }
    }
  }

  return { opaque: toGeometry(opaque), transparent: toGeometry(transparent) };
}

function emitQuad(buf, q) {
  const block = getBlock(q.id);
  const shade = SHADE[q.faceType];
  const col = block.colors[q.faceType];
  const r = col[0] * shade, g = col[1] * shade, b = col[2] * shade;

  // Build the 4 corners in (axis,u,v) space then convert to world xyz.
  const corner = (uu, vv) => {
    const a = [0, 0, 0];
    a[q.axis] = q.faceCoord; a[q.u] = uu; a[q.v] = vv;
    return [q.baseX + a[0], a[1], q.baseZ + a[2]];
  };
  const c0 = corner(q.i, q.j);
  const c1 = corner(q.i + q.w, q.j);
  const c2 = corner(q.i + q.w, q.j + q.h);
  const c3 = corner(q.i, q.j + q.h);

  const vi = buf.positions.length / 3;
  for (const c of [c0, c1, c2, c3]) {
    buf.positions.push(c[0], c[1], c[2]);
    buf.normals.push(q.normal[0], q.normal[1], q.normal[2]);
    buf.colors.push(r, g, b);
  }
  // Winding: u×v points along +axis, so CCW order works for dir>0; reverse it
  // for dir<0 so the front face points outward.
  if (q.dir > 0) buf.indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
  else buf.indices.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
}
