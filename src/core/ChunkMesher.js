import * as THREE from 'three';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../config.js';
import { getBlock, isOpaque } from '../blocks/BlockRegistry.js';

// Six face definitions: normal direction + the 4 corner offsets (CCW) + which
// block color to use (top/side/bottom).
const FACES = [
  { dir: [0, 1, 0],  face: 'top',    corners: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]] },
  { dir: [0, -1, 0], face: 'bottom', corners: [[0,0,1],[0,0,0],[1,0,0],[1,0,1]] },
  { dir: [1, 0, 0],  face: 'side',   corners: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]] },
  { dir: [-1, 0, 0], face: 'side',   corners: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]] },
  { dir: [0, 0, 1],  face: 'side',   corners: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]] },
  { dir: [0, 0, -1], face: 'side',   corners: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]] },
];

// Slight per-face shading so cubes read as 3D without textures.
const SHADE = { top: 1.0, bottom: 0.5, side: 0.8 };

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
  geometry.computeBoundingSphere();
  return geometry;
}

// Builds opaque + transparent geometry for one chunk. `worldGet(wx,wy,wz)`
// returns the block id at a global voxel position so cross-chunk faces cull.
export function buildChunkGeometry(chunk, worldGet) {
  const opaque = emptyBuffers();
  const transparent = emptyBuffers();

  const baseX = chunk.cx * CHUNK_SIZE;
  const baseZ = chunk.cz * CHUNK_SIZE;

  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        const id = chunk.get(x, y, z);
        if (id === 0) continue;
        const block = getBlock(id);
        const buf = block.transparent ? transparent : opaque;
        const wx = baseX + x;
        const wz = baseZ + z;

        for (const f of FACES) {
          const neighbor = worldGet(wx + f.dir[0], y + f.dir[1], wz + f.dir[2]);

          // Cull face if neighbour is opaque. For transparent blocks (water,
          // leaves), also cull against the same block type to avoid overdraw.
          if (isOpaque(neighbor)) continue;
          if (block.transparent && neighbor === id) continue;

          const shade = SHADE[f.face];
          const col = block.colors[f.face];
          const r = col[0] * shade;
          const g = col[1] * shade;
          const b = col[2] * shade;

          const vi = buf.positions.length / 3;
          for (const c of f.corners) {
            buf.positions.push(wx + c[0], y + c[1], wz + c[2]);
            buf.normals.push(f.dir[0], f.dir[1], f.dir[2]);
            buf.colors.push(r, g, b);
          }
          buf.indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
        }
      }
    }
  }

  return { opaque: toGeometry(opaque), transparent: toGeometry(transparent) };
}
