import * as THREE from 'three';
import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL, LOAD_RADIUS, UNLOAD_RADIUS, CHUNK_CACHE_MAX } from '../config.js';
import { Chunk } from './Chunk.js';
import { generateChunk } from '../world/generators/TerrainGen.js';
import { buildChunkGeometry } from './ChunkMesher.js';
import { BLOCK_MATERIALS, TERRAIN_SOLID, TERRAIN_CUTOUT, WATER_MATERIAL_INDEX, LEAVES_MATERIAL_INDEX } from '../textures/atlas.js';
import { getBlockId, isSolid } from '../blocks/BlockRegistry.js';

// Chunk-map key. A number, not a string: getBlock runs for every voxel the
// physics and the mesher look at, and building a "cx,cz" string each time
// was a steady stream of garbage. Exact for |cx|,|cz| < 32768 chunks.
const key = (cx, cz) => (cx + 0x8000) * 0x10000 + (cz + 0x8000);
// The edits map keeps the "cx,cz" string form: it is the save and network
// format (serializeEdits / Net.encodeEdit).
const editKey = (cx, cz) => `${cx},${cz}`;

// Nearest-first chunk offsets inside the load disc, computed once.
const VISIT = [];
for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
  for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
    const d = dx * dx + dz * dz;
    if (d <= LOAD_RADIUS * LOAD_RADIUS) VISIT.push([d, dx, dz]);
  }
}
VISIT.sort((a, b) => a[0] - b[0]);

export const SHADOW_CASTER_LAYER = 1;

// A chunk's solid terrain is one mesh with one material, so it casts its own
// shadow in a single draw. Leaves are different: they share the cut-out mesh
// with glass and plants (which must NOT cast — skylights have to let the sun
// in), and their shadow needs the leaf texture's holes. So each chunk with
// foliage gets a caster mesh that reuses the cut-out geometry's buffers
// through a draw range covering just the leaves (the mesher puts them
// first), alpha-tested so canopies throw dappled shade. It sits on its own
// layer, which the Game shows to the camera only while the shadow map is
// being drawn — the normal pass never touches it. The colour/depth-write
// flags are a belt-and-braces fallback. It stays front-sided, which makes
// three render its *back* faces into the shadow map: a canopy is shaded by
// its far side, so its sunlit faces never shadow themselves (double-sided
// leaves did, and went near-black).
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
    this.castShadows = false; // terrain casts shadows (Game.setGraphics)
    this._last = null;        // the chunk the previous lookup hit (see getChunk)

    // Terrain draws with the two array-texture materials (atlas.js); water
    // keeps its own translucent one.
    this.waterMaterial = BLOCK_MATERIALS[WATER_MATERIAL_INDEX];
  }

  // Lookups come in runs inside one chunk (a collision box, a mesher row), so
  // the last hit is remembered and most calls skip the map entirely.
  getChunk(cx, cz) {
    const last = this._last;
    if (last !== null && last.cx === cx && last.cz === cz) return last;
    const chunk = this.chunks.get(key(cx, cz));
    if (chunk !== undefined) this._last = chunk;
    return chunk;
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
      this._applyEdits(editKey(cx, cz), chunk); // replay saved player edits onto fresh terrain
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
    const k = editKey(cx, cz);
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
    const { solid, cutout, water } = buildChunkGeometry(chunk, get);

    if (chunk.mesh) {
      this.scene.remove(chunk.mesh);
      chunk.mesh.traverse((o) => o.geometry && o.geometry.dispose());
    }

    const group = new THREE.Group();
    if (solid) {
      const m = new THREE.Mesh(solid, TERRAIN_SOLID);
      m.receiveShadow = true;
      m.castShadow = this.castShadows;
      group.add(m);
    }
    if (cutout) {
      const m = new THREE.Mesh(cutout, TERRAIN_CUTOUT);
      m.receiveShadow = true;
      group.add(m);
      const leaves = cutout.userData.leafCount;
      if (this.castShadows && leaves > 0) group.add(casterMesh(cutout, 0, leaves, LEAF_CASTER));
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
    for (let i = 0; i < VISIT.length; i++) {
      const cx = pcx + VISIT[i][1], cz = pcz + VISIT[i][2];
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
        if (this._last === chunk) this._last = null;
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
