import * as THREE from 'three';
import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL, LOAD_RADIUS, UNLOAD_RADIUS, CHUNK_CACHE_MAX } from '../config.js';
import { Chunk } from './Chunk.js';
import { generateChunk } from '../world/generators/TerrainGen.js';
import { buildChunkGeometry } from './ChunkMesher.js';
import { BLOCK_MATERIALS, TERRAIN_MATERIALS, WATER_MATERIAL_INDEX, LEAVES_MATERIAL_INDEX } from '../textures/atlas.js';
import { getBlockId, isSolid } from '../blocks/BlockRegistry.js';

const key = (cx, cz) => `${cx},${cz}`;

export const SHADOW_CASTER_LAYER = 1;

// Shadow-caster materials. A chunk's terrain mesh has one draw group per tile,
// and three's shadow pass would redraw every group — a dozen-plus calls per
// chunk. Instead the terrain mesh only *receives* shadows, and each chunk gets
// up to two caster meshes that reuse its vertex/index buffers through a draw
// range: everything solid in one call, the leaves in another (alpha-tested, so
// canopies throw dappled shade). The casters sit on their own layer, which the
// Game shows to the camera only while the shadow map is being drawn — so the
// normal pass never touches them (drawing them there as no-ops cost ~25% of
// the frame). The colour/depth-write flags are a belt-and-braces fallback.
// Both stay front-sided, which makes three render their *back* faces into the
// shadow map: a canopy is shaded by its far side, so its sunlit faces never
// shadow themselves (double-sided leaves did, and went near-black).
const SOLID_CASTER = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const LEAF_CASTER = new THREE.MeshBasicMaterial({
  map: BLOCK_MATERIALS[LEAVES_MATERIAL_INDEX].map, alphaTest: 0.5,
  colorWrite: false, depthWrite: false,
});

function casterMesh(src, start, count, material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.getAttribute('position'));
  if (material.map) g.setAttribute('uv', src.getAttribute('uv'));
  g.setIndex(src.index);
  g.setDrawRange(start, count);
  g.boundingSphere = src.boundingSphere;
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.layers.set(SHADOW_CASTER_LAYER);
  return m;
}
const TORCH = getBlockId('torch');
const GLOW = getBlockId('glow_mushroom');

export class World {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.cache = new Map(); // LRU of unloaded chunks (insertion order = age)
    this.edits = new Map(); // chunkKey -> Map(localIndex -> blockId): player changes
    this.torches = new Set(); // "x,y,z" of placed torches (for dynamic lights)
    this.torchVersion = 0;    // bumped when the torch set changes
    this.onEdit = null;       // (wx, wy, wz, id, prevId) — fired on every setBlock (sync + particles)
    this.castShadows = false; // build shadow-caster meshes per chunk (Game.setGraphics)

    // Opaque chunk meshes use the shared per-tile material array (geometry
    // groups index into it); water uses its own transparent material.
    this.materials = TERRAIN_MATERIALS;
    this.waterMaterial = BLOCK_MATERIALS[WATER_MATERIAL_INDEX];
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
    if (!chunk.generated) {
      generateChunk(chunk);
      this._applyEdits(k, chunk); // replay saved player edits onto fresh terrain
    }
    return chunk;
  }

  _applyEdits(k, chunk) {
    const e = this.edits.get(k);
    if (!e) return;
    for (const [index, id] of e) {
      // Keep chunk.lights (glow-source list for the dynamic light pool) in sync,
      // same as the live setBlock path: a broken generated mushroom must not
      // leave a phantom light behind, and a player-placed one must glow again
      // after a reload / LRU regen / late join.
      const prev = chunk.blocks[index];
      if (id === GLOW || prev === GLOW) {
        const lx = index % CHUNK_SIZE;
        const lz = Math.floor(index / CHUNK_SIZE) % CHUNK_SIZE;
        const wy = Math.floor(index / (CHUNK_SIZE * CHUNK_SIZE));
        const wx = chunk.cx * CHUNK_SIZE + lx;
        const wz = chunk.cz * CHUNK_SIZE + lz;
        if (!chunk.lights) chunk.lights = [];
        const li = chunk.lights.findIndex((p) => p[0] === wx && p[1] === wy && p[2] === wz);
        if (id === GLOW && li < 0) chunk.lights.push([wx, wy, wz]);
        else if (id !== GLOW && li >= 0) chunk.lights.splice(li, 1);
      }
      chunk.blocks[index] = id;
    }
    chunk.dirty = true;
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
    const prevId = chunk.get(lx, wy, lz);
    chunk.set(lx, wy, lz, id);
    chunk.dirty = true;

    // Record the edit so it survives chunk unload/regeneration and can be saved.
    const k = key(cx, cz);
    let e = this.edits.get(k);
    if (!e) { e = new Map(); this.edits.set(k, e); }
    e.set(Chunk.index(lx, wy, lz), id);

    // Track torches for the dynamic light pool + stick meshes.
    const tkey = `${wx},${wy},${wz}`;
    const had = this.torches.has(tkey);
    if (id === TORCH) this.torches.add(tkey);
    else this.torches.delete(tkey);
    if (this.torches.has(tkey) !== had) this.torchVersion++;

    // Keep the chunk's glow-source list (used by the dynamic light pool) in sync
    // when a glow block is placed or broken. Generated glow mushrooms are added
    // to chunk.lights at gen time; this handles player edits so placing one lights
    // the area and breaking one doesn't leave a phantom light behind.
    if (id === GLOW || prevId === GLOW) {
      if (!chunk.lights) chunk.lights = [];
      const li = chunk.lights.findIndex((p) => p[0] === wx && p[1] === wy && p[2] === wz);
      if (id === GLOW && li < 0) chunk.lights.push([wx, wy, wz]);
      else if (id !== GLOW && li >= 0) chunk.lights.splice(li, 1);
    }

    // Neighbouring chunk may need remesh if we touched a boundary block.
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);

    if (this.onEdit) this.onEdit(wx, wy, wz, id, prevId);
  }

  markDirty(cx, cz) {
    const c = this.getChunk(cx, cz);
    if (c) c.dirty = true;
  }

  // Edits as a plain object for saving: { "cx,cz": { index: blockId } }.
  serializeEdits() {
    const out = {};
    for (const [k, e] of this.edits) {
      const o = {};
      for (const [index, id] of e) o[index] = id;
      out[k] = o;
    }
    return out;
  }

  // Load saved edits before any chunk is generated so they replay on gen.
  loadEdits(obj) {
    this.edits.clear();
    this.torches.clear();
    if (!obj) return;
    for (const k of Object.keys(obj)) {
      const [cx, cz] = k.split(',').map(Number);
      const e = new Map();
      for (const index of Object.keys(obj[k])) {
        const idx = Number(index);
        const id = obj[k][index];
        e.set(idx, id);
        if (id === TORCH) {
          const lx = idx % CHUNK_SIZE;
          const lz = Math.floor(idx / CHUNK_SIZE) % CHUNK_SIZE;
          const wy = Math.floor(idx / (CHUNK_SIZE * CHUNK_SIZE));
          this.torches.add(`${cx * CHUNK_SIZE + lx},${wy},${cz * CHUNK_SIZE + lz}`);
        }
      }
      this.edits.set(k, e);
    }
    this.torchVersion++;
  }

  buildMesh(chunk) {
    const get = (wx, wy, wz) => this.getBlock(wx, wy, wz);
    const { opaque, water } = buildChunkGeometry(chunk, get);

    if (chunk.mesh) {
      this.scene.remove(chunk.mesh);
      chunk.mesh.traverse((o) => o.geometry && o.geometry.dispose());
    }

    const group = new THREE.Group();
    if (opaque) {
      // Material array; geometry groups select the per-tile material.
      const m = new THREE.Mesh(opaque, this.materials);
      m.frustumCulled = true;
      m.receiveShadow = true;
      group.add(m);
      if (this.castShadows) {
        const { solidCount, leafStart, leafCount } = opaque.userData.shadow;
        if (solidCount > 0) group.add(casterMesh(opaque, 0, solidCount, SOLID_CASTER));
        if (leafCount > 0) group.add(casterMesh(opaque, leafStart, leafCount, LEAF_CASTER));
      }
    }
    if (water) {
      const m = new THREE.Mesh(water, this.waterMaterial);
      m.frustumCulled = true;
      m.renderOrder = 1;
      m.receiveShadow = true;
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
  // Skips water and plants so entities stand on real ground.
  surfaceHeight(wx, wz) {
    this.ensureChunk(Math.floor(wx / CHUNK_SIZE), Math.floor(wz / CHUNK_SIZE));
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      if (isSolid(this.getBlock(wx, y, wz))) return y;
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
