import * as THREE from 'three';
import { itemIconCanvas } from '../textures/icons.js';
import { BLOCK_MATERIALS, faceMaterialIndex } from '../textures/atlas.js';
import { getBlockId } from '../blocks/BlockRegistry.js';

// 3D models for items, generated from their own pixel art:
//   • Most items extrude their 16x16 icon into a thin voxel plate (each opaque
//     pixel becomes a tiny column with per-vertex colour) — the Minecraft
//     trick, so the held sword IS the sword icon.
//   • Block items become mini cubes textured with the real atlas materials.
// Used by the first-person held model and by dropped item entities.

const S = 16;

// Per-face brightness baked into vertex colours (front faces the viewer).
const FRONT = 1.0, BACK = 0.7, SIDE_X = 0.82, TOP = 0.95, BOTTOM = 0.55;

// Extrude an icon canvas into a plate geometry. `size` is the plate's height
// in world units (x matches; the plate is centred on the origin).
export function extrudeCanvas(canvas, size = 0.6, depth = 0.05) {
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, S, S).data;
  const solid = (x, y) => x >= 0 && x < S && y >= 0 && y < S && data[(y * S + x) * 4 + 3] >= 120;

  const positions = [], normals = [], colors = [], indices = [];
  const p = size / S;       // one pixel in world units
  const half = size / 2;
  const zf = depth / 2, zb = -depth / 2;

  // Push one quad: 4 corners (world coords), a normal, a colour.
  function quad(c0, c1, c2, c3, n, r, g, b) {
    const vi = positions.length / 3;
    for (const c of [c0, c1, c2, c3]) {
      positions.push(c[0], c[1], c[2]);
      normals.push(n[0], n[1], n[2]);
      colors.push(r, g, b);
    }
    indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
  }

  for (let py = 0; py < S; py++) {
    for (let pxl = 0; pxl < S; pxl++) {
      if (!solid(pxl, py)) continue;
      const i = (py * S + pxl) * 4;
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      // Canvas y grows downward; world y grows up.
      const x0 = pxl * p - half, x1 = x0 + p;
      const y1 = (S - py) * p - half, y0 = y1 - p;

      // Front (+z) and back (-z), CCW seen from their normal's side.
      quad([x0, y0, zf], [x1, y0, zf], [x1, y1, zf], [x0, y1, zf], [0, 0, 1], r * FRONT, g * FRONT, b * FRONT);
      quad([x1, y0, zb], [x0, y0, zb], [x0, y1, zb], [x1, y1, zb], [0, 0, -1], r * BACK, g * BACK, b * BACK);

      // Walls where the neighbouring pixel is empty.
      if (!solid(pxl - 1, py)) quad([x0, y0, zb], [x0, y0, zf], [x0, y1, zf], [x0, y1, zb], [-1, 0, 0], r * SIDE_X, g * SIDE_X, b * SIDE_X);
      if (!solid(pxl + 1, py)) quad([x1, y0, zf], [x1, y0, zb], [x1, y1, zb], [x1, y1, zf], [1, 0, 0], r * SIDE_X, g * SIDE_X, b * SIDE_X);
      if (!solid(pxl, py - 1)) quad([x0, y1, zf], [x1, y1, zf], [x1, y1, zb], [x0, y1, zb], [0, 1, 0], r * TOP, g * TOP, b * TOP);
      if (!solid(pxl, py + 1)) quad([x0, y0, zb], [x1, y0, zb], [x1, y0, zf], [x0, y0, zf], [0, -1, 0], r * BOTTOM, g * BOTTOM, b * BOTTOM);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

// Shared material for all extruded plates (colour lives in the vertices).
let plateMat = null;
export function plateMaterial() {
  if (!plateMat) plateMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  return plateMat;
}

// Mini textured cube for a block item, using the shared atlas materials so it
// matches the placed block exactly. With `shared`, geometry + material arrays
// come from caches and must never be disposed (used for dropped items, which
// spawn constantly); the default builds fresh geometry the caller may dispose.
const cubeGeoCache = new Map();  // size -> BoxGeometry (with white colours)
const cubeMatsCache = new Map(); // blockName -> material array

function cubeGeometry(size) {
  const geo = new THREE.BoxGeometry(size, size, size);
  // Atlas materials use vertexColors; a box has none, so add plain white.
  const count = geo.attributes.position.count;
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  return geo;
}

function cubeMaterials(blockName) {
  if (!cubeMatsCache.has(blockName)) {
    const id = getBlockId(blockName);
    // BoxGeometry group order: +x, -x, +y, -y, +z, -z.
    const side = BLOCK_MATERIALS[faceMaterialIndex(id, 'side')];
    cubeMatsCache.set(blockName, [
      side, side,
      BLOCK_MATERIALS[faceMaterialIndex(id, 'top')],
      BLOCK_MATERIALS[faceMaterialIndex(id, 'bottom')],
      side, side,
    ]);
  }
  return cubeMatsCache.get(blockName);
}

export function buildBlockCube(blockName, size = 0.3, shared = false) {
  let geo;
  if (shared) {
    if (!cubeGeoCache.has(size)) cubeGeoCache.set(size, cubeGeometry(size));
    geo = cubeGeoCache.get(size);
  } else {
    geo = cubeGeometry(size);
  }
  return new THREE.Mesh(geo, cubeMaterials(blockName));
}

// A real little torch: wooden stick with a glowing head (the block itself is
// rendered as a separate stick mesh in the world; this matches it in hand).
export function buildTorchModel(scale = 1) {
  const group = new THREE.Group();
  const stick = new THREE.Mesh(
    new THREE.BoxGeometry(0.07 * scale, 0.4 * scale, 0.07 * scale),
    new THREE.MeshLambertMaterial({ color: '#6b4f2a' })
  );
  group.add(stick);
  const flame = new THREE.Mesh(
    new THREE.BoxGeometry(0.11 * scale, 0.13 * scale, 0.11 * scale),
    new THREE.MeshLambertMaterial({ color: '#f0b030', emissive: '#ff9a20', emissiveIntensity: 1.0 })
  );
  flame.position.y = 0.26 * scale;
  group.add(flame);
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(0.05 * scale, 0.07 * scale, 0.05 * scale),
    new THREE.MeshBasicMaterial({ color: '#fff2a0' })
  );
  core.position.y = 0.28 * scale;
  group.add(core);
  return group;
}

// Cached extruded geometries for dropped items (shared across all drops of the
// same item — drops never dispose geometry).
const dropGeoCache = new Map();
export function dropPlateGeometry(itemName, size = 0.36) {
  const key = `${itemName}|${size}`;
  if (!dropGeoCache.has(key)) {
    dropGeoCache.set(key, extrudeCanvas(itemIconCanvas(itemName), size));
  }
  return dropGeoCache.get(key);
}
