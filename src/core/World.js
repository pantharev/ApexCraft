import * as THREE from 'three';
import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL, LOAD_RADIUS, UNLOAD_RADIUS, CHUNK_CACHE_MAX } from '../config.js';
import { Chunk } from './Chunk.js';
import { generateChunk } from '../world/generators/TerrainGen.js';
import { buildChunkGeometry } from './ChunkMesher.js';

const key = (cx, cz) => `${cx},${cz}`;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.cache = new Map(); // LRU of unloaded chunks (insertion order = age)

    this.opaqueMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.transparentMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }

  getChunk(cx, cz) {
    return this.chunks.get(key(cx, cz));
  }

  ensureChunk(cx, cz) {
    const k = key(cx, cz);
    let chunk = this.chunks.get(k);
    if (!chunk) {
      // Restore from the LRU cache (keeps edits, skips regeneration) if present.
      chunk = this.cache.get(k);
      if (chunk) {
        this.cache.delete(k);
        chunk.dirty = true;
        chunk.mesh = null;
      } else {
        chunk = new Chunk(cx, cz);
      }
      this.chunks.set(k, chunk);
    }
    if (!chunk.generated) generateChunk(chunk);
    return chunk;
  }

  // Global voxel lookup across chunk boundaries.
  getBlock(wx, wy, wz) {
    if (wy < 0 || wy >= WORLD_HEIGHT) return 0;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cz);
    if (!chunk || !chunk.generated) return 0;
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    return chunk.get(lx, wy, lz);
  }

  setBlock(wx, wy, wz, id) {
    if (wy < 0 || wy >= WORLD_HEIGHT) return;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.ensureChunk(cx, cz);
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    chunk.set(lx, wy, lz, id);
    chunk.dirty = true;
    // Neighbouring chunk may need remesh if we touched a boundary block.
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
  }

  markDirty(cx, cz) {
    const c = this.getChunk(cx, cz);
    if (c) c.dirty = true;
  }

  buildMesh(chunk) {
    const get = (wx, wy, wz) => this.getBlock(wx, wy, wz);
    const { opaque, transparent } = buildChunkGeometry(chunk, get);

    if (chunk.mesh) {
      this.scene.remove(chunk.mesh);
      chunk.mesh.traverse((o) => o.geometry && o.geometry.dispose());
    }

    const group = new THREE.Group();
    if (opaque) {
      const m = new THREE.Mesh(opaque, this.opaqueMaterial);
      m.frustumCulled = true;
      group.add(m);
    }
    if (transparent) {
      const m = new THREE.Mesh(transparent, this.transparentMaterial);
      m.frustumCulled = true;
      group.add(m);
    }
    chunk.mesh = group;
    chunk.dirty = false;
    this.scene.add(group);
  }

  // Generate + mesh chunks within LOAD_RADIUS, unload beyond UNLOAD_RADIUS.
  // Called each frame with the player's world position. Generates a limited
  // number of chunks per call to avoid frame hitches.
  update(playerX, playerZ, budget = 2) {
    const pcx = Math.floor(playerX / CHUNK_SIZE);
    const pcz = Math.floor(playerZ / CHUNK_SIZE);
    let work = 0;

    // Load/generate nearest-first.
    const toVisit = [];
    for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
      for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
        const dist = dx * dx + dz * dz;
        if (dist > LOAD_RADIUS * LOAD_RADIUS) continue;
        toVisit.push([dist, pcx + dx, pcz + dz]);
      }
    }
    toVisit.sort((a, b) => a[0] - b[0]);

    for (const [, cx, cz] of toVisit) {
      const chunk = this.getChunk(cx, cz);
      if (!chunk || !chunk.generated || chunk.dirty) {
        this.ensureChunk(cx, cz);
        // Ensure neighbours exist (so boundary culling is correct) then mesh.
        this.ensureChunk(cx + 1, cz);
        this.ensureChunk(cx - 1, cz);
        this.ensureChunk(cx, cz + 1);
        this.ensureChunk(cx, cz - 1);
        this.buildMesh(this.getChunk(cx, cz));
        if (++work >= budget) break;
      }
    }

    // Unload far chunks: drop their meshes (free GPU memory) and move the block
    // data into the LRU cache so a revisit skips regeneration and keeps edits.
    for (const [k, chunk] of this.chunks) {
      const dx = chunk.cx - pcx;
      const dz = chunk.cz - pcz;
      if (dx * dx + dz * dz > UNLOAD_RADIUS * UNLOAD_RADIUS) {
        if (chunk.mesh) {
          this.scene.remove(chunk.mesh);
          chunk.mesh.traverse((o) => o.geometry && o.geometry.dispose());
          chunk.mesh = null;
        }
        this.chunks.delete(k);
        this.cache.delete(k); // refresh recency
        this.cache.set(k, chunk);
      }
    }

    // Evict oldest cached chunks past the budget.
    while (this.cache.size > CHUNK_CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
  }

  // Height of the highest solid block at a column (for spawn placement).
  surfaceHeight(wx, wz) {
    this.ensureChunk(Math.floor(wx / CHUNK_SIZE), Math.floor(wz / CHUNK_SIZE));
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      const id = this.getBlock(wx, y, wz);
      if (id !== 0 && id !== 6 /* water */) return y;
    }
    return 64;
  }

  // Find a dry land column (surface above sea level) near the origin so the
  // player doesn't spawn underwater. Spirals outward until one is found.
  findSpawn() {
    for (let r = 0; r <= 96; r += 3) {
      for (let dx = -r; dx <= r; dx += 3) {
        for (let dz = -r; dz <= r; dz += 3) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // ring only
          if (this.surfaceHeight(dx, dz) >= SEA_LEVEL + 1) return { x: dx, z: dz };
        }
      }
    }
    return { x: 0, z: 0 };
  }
}
