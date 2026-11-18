import * as THREE from 'three';
import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL, LOAD_RADIUS, UNLOAD_RADIUS, CHUNK_CACHE_MAX } from '../config.js';
import { Chunk } from './Chunk.js';
import { ChunkPool } from './ChunkPool.js';
import { generateChunk, getGenMode } from '../world/generators/TerrainGen.js';
import { activeMap } from '../world/arenas/index.js';
import { getSeed, getGen } from '../world/noise.js';
import { columnHeight } from '../world/generators/Height.js';
import { buildVolume, meshVolume, setTileTables } from './ChunkMesher.js';
import {
  BLOCK_MATERIALS, TERRAIN_SOLID, TERRAIN_CUTOUT, LEAVES_MATERIAL_INDEX,
  faceMaterialIndex, TILE_KIND, TILE_VARIATION, TILE_GLOW,
} from '../textures/atlas.js';
import { WATER_SURFACE } from '../textures/water.js';
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
// A chunk's mesh reads one block into all eight chunks around it: the four
// beside it decide which border faces are hidden, and the diagonal ones are
// seen by the ambient occlusion of its corner columns. All eight have to be
// generated before it is meshed — then a mesh depends only on the world, never
// on the order chunks happened to arrive in.
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// --- How chunks get built ------------------------------------------------------
// Generating a chunk and meshing it are the two heavy jobs in the engine, and
// both normally run in a pool of workers (ChunkPool.js): update() walks the
// load disc nearest-first and hands out jobs while the pool has room, and the
// results are drawn as they come back. The main thread only does the work
// itself when it cannot wait:
//   • the chunks under and around the player must exist before physics runs,
//     so a missing one there (a teleport, a spawn) is generated on the spot;
//   • an edit next to the player is remeshed in the same frame — a block has
//     to vanish the instant it breaks, and when an edit touches a chunk
//     border both chunks must change together or a hole flashes between them.
// Edits further away go through the workers like everything else.
const URGENT_RADIUS = 2;    // chunks (Chebyshev) around the player whose edits remesh here
const URGENT_PER_FRAME = 4; // ...at most this many a frame; the rest wait a frame
const MESHES_PER_FRAME = 8; // worker meshes drawn per frame (each is a GPU upload)
const SYNC_BUDGET = 3;      // chunks built per frame with no workers at all
const PRELOAD_NEAR = 25;    // chunks preload() builds itself when workers will do the rest (a 2.8-chunk disc)
const PRELOAD_ALONE = 80;   // ...and when there are none (a 5-chunk disc)
const SPARE_VOLUMES = 16;   // snapshot buffers kept for reuse (about 42 KB each)

// Per-block tile lookups for the mesher (see ChunkMesher.setTileTables). Built
// here because the atlas needs a canvas; each worker gets a copy.
const TILE_TABLES = (() => {
  const top = new Uint16Array(256), side = new Uint16Array(256), bottom = new Uint16Array(256);
  for (let id = 0; id < 256; id++) {
    top[id] = faceMaterialIndex(id, 'top');
    side[id] = faceMaterialIndex(id, 'side');
    bottom[id] = faceMaterialIndex(id, 'bottom');
  }
  return { top, side, bottom, kind: TILE_KIND, variation: TILE_VARIATION, glow: TILE_GLOW };
})();
setTileTables(TILE_TABLES);

// Wrap one geometry's typed arrays (from meshVolume) for three.js.
function toGeometry(d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(d.color, 3));
  if (d.tile) g.setAttribute('tile', new THREE.BufferAttribute(d.tile, 3));
  if (d.depth) g.setAttribute('depth', new THREE.BufferAttribute(d.depth, 1));
  g.setIndex(new THREE.BufferAttribute(d.index, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(d.sphere[0], d.sphere[1], d.sphere[2]), d.sphere[3]);
  return g;
}

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
  // The seed (noise.reseed), generation mode (setGenMode) and arena map
  // (setActiveMap) must be set before this is constructed: the chunk workers
  // are told them once, here. `workers: false` builds everything on the main
  // thread (also what happens by itself if workers cannot start).
  // `scenery: true` is for a world that is only looked at (the menu flyover):
  // nothing stands on it, so update() never stops to build chunks itself.
  constructor(scene, { workers = true, scenery = false } = {}) {
    this.scene = scene;
    this.scenery = scenery;
    this.chunks = new Map();
    this.cache = new Map(); // LRU of unloaded chunks (insertion order = age)
    this.edits = new Map(); // chunkKey -> Map(localIndex -> blockId): player changes
    this.torches = new Set(); // "x,y,z" of placed torches (for dynamic lights)
    this.torchVersion = 0;    // bumped when the torch set changes
    this.onEdit = null;       // (wx, wy, wz, id, prevId) — fired on every setBlock (sync + particles)
    this.castShadows = false; // terrain casts shadows (setCastShadows)
    this._last = null;        // the chunk the previous lookup hit (see getChunk)

    // Terrain draws with the two array-texture materials (atlas.js); water
    // has its own animated surface (textures/water.js).
    this.waterMaterial = WATER_SURFACE;

    this.pool = null;
    this._jobs = new Map();    // worker job id -> { kind: 'gen', cx, cz, k } | { kind: 'mesh', chunk, rev }
    this._genJobs = new Map(); // chunk key -> id of its generation job in flight
    this._urgent = new Set();  // edited chunks to consider for a same-frame remesh
    this._vols = [];           // spare snapshot buffers (see _snapshot)
    if (workers && typeof Worker !== 'undefined') {
      try {
        this.pool = new ChunkPool({
          seed: getSeed(), genMode: getGenMode(), map: activeMap().id, tables: TILE_TABLES,
        });
      } catch (err) {
        console.warn('[chunks] no workers, building on the main thread:', err);
      }
    }
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

  // Bring a chunk back from the LRU cache (keeps its blocks and edits, skips
  // regeneration). Returns it, or undefined if it is not cached.
  _restore(k) {
    const chunk = this.cache.get(k);
    if (!chunk) return undefined;
    this.cache.delete(k);
    chunk.dirty = true;
    chunk.mesh = null;
    this.chunks.set(k, chunk);
    return chunk;
  }

  // Make sure a chunk's blocks exist, generating them on this thread, now.
  // For callers that need the answer in the same call (setBlock,
  // surfaceHeight, the ground under the player); streaming goes through
  // update() and the workers instead.
  ensureChunk(cx, cz) {
    const k = key(cx, cz);
    let chunk = this.chunks.get(k) || this._restore(k);
    if (!chunk) {
      chunk = new Chunk(cx, cz);
      this.chunks.set(k, chunk);
    }
    if (!chunk.generated) {
      // A worker may be generating this very chunk; its result is now unwanted.
      const job = this._genJobs.get(k);
      if (job !== undefined) { this._genJobs.delete(k); this._jobs.delete(job); }
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
    this._urgent.add(chunk);

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

    // Neighbouring chunks need a remesh if we touched a boundary block — and
    // a corner block is also seen by the chunk diagonally across (the ambient
    // occlusion of its corner column).
    const bx = lx === 0 ? -1 : lx === CHUNK_SIZE - 1 ? 1 : 0;
    const bz = lz === 0 ? -1 : lz === CHUNK_SIZE - 1 ? 1 : 0;
    if (bx) this.markDirty(cx + bx, cz);
    if (bz) this.markDirty(cx, cz + bz);
    if (bx && bz) this.markDirty(cx + bx, cz + bz);

    if (this.onEdit) this.onEdit(wx, wy, wz, id, prevId);
  }

  // An edit changed what this chunk's mesh should look like.
  markDirty(cx, cz) {
    const c = this.getChunk(cx, cz);
    if (c) { c.dirty = true; this._urgent.add(c); }
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

  // --- Meshes ------------------------------------------------------------------

  // A copy of the chunk's voxels plus the one-block ring around it — all a
  // mesh needs, and safe to hand to a worker. The buffers are recycled
  // (_recycle): a mesh job's snapshot comes back with its result, so steady
  // streaming allocates none.
  _snapshot(chunk) {
    const { cx, cz } = chunk;
    return buildVolume((dx, dz) => {
      if (dx === 0 && dz === 0) return chunk.blocks;
      const c = this.chunks.get(key(cx + dx, cz + dz));
      return c && c.generated ? c.blocks : null;
    }, this._vols.pop());
  }

  _recycle(vol) {
    if (vol && this._vols.length < SPARE_VOLUMES) this._vols.push(vol);
  }

  _dropMesh(chunk) {
    if (!chunk.mesh) return;
    this.scene.remove(chunk.mesh);
    chunk.mesh.traverse((o) => o.geometry && o.geometry.dispose());
    chunk.mesh = null;
  }

  // Show a mesh built from the chunk at revision `rev` (see Chunk.rev).
  _setMesh(chunk, data, rev) {
    this._dropMesh(chunk);
    const group = new THREE.Group();
    const parts = group.userData; // what setCastShadows needs to find again
    if (data.solid) {
      const m = new THREE.Mesh(toGeometry(data.solid), TERRAIN_SOLID);
      m.receiveShadow = true;
      m.castShadow = this.castShadows;
      group.add(m);
      parts.solid = m;
    }
    if (data.cutout) {
      const m = new THREE.Mesh(toGeometry(data.cutout), TERRAIN_CUTOUT);
      m.receiveShadow = true;
      group.add(m);
      parts.cutout = m;
      parts.leafCount = data.cutout.leafCount;
      if (this.castShadows) this._addLeafCaster(group);
    }
    if (data.water) {
      const m = new THREE.Mesh(toGeometry(data.water), this.waterMaterial);
      m.frustumCulled = true;
      m.renderOrder = 1;
      m.receiveShadow = true;
      group.add(m);
    }
    chunk.mesh = group;
    chunk.meshRev = rev;
    this.scene.add(group);
  }

  _addLeafCaster(group) {
    const parts = group.userData;
    if (parts.caster || !parts.cutout || !(parts.leafCount > 0)) return;
    parts.caster = casterMesh(parts.cutout.geometry, 0, parts.leafCount, LEAF_CASTER);
    group.add(parts.caster);
  }

  // Mesh a chunk on this thread, now.
  buildMesh(chunk) {
    const rev = chunk.rev;
    const vol = this._snapshot(chunk);
    const data = meshVolume(vol, chunk.cx, chunk.cz);
    this._recycle(vol);
    chunk.meshJob = 0; // a worker mesh still in flight for it is now out of date
    this._setMesh(chunk, data, rev);
  }

  // Terrain shadows on or off (Game.setGraphics). The meshes are updated in
  // place — nothing is remeshed.
  setCastShadows(on) {
    this.castShadows = on;
    for (const chunk of this.chunks.values()) {
      if (!chunk.mesh) continue;
      const parts = chunk.mesh.userData;
      if (parts.solid) parts.solid.castShadow = on;
      if (on) this._addLeafCaster(chunk.mesh);
      if (parts.caster) parts.caster.visible = on;
    }
  }

  // --- Streaming ---------------------------------------------------------------

  // Start generating a chunk that is not loaded. Returns the chunk if it could
  // be had at once (it was in the LRU cache); otherwise a worker is asked, if
  // one is free, and the chunk appears in a later update.
  _requestGen(cx, cz) {
    const k = key(cx, cz);
    const cached = this._restore(k);
    if (cached) return cached;
    if (!this._genJobs.has(k) && this.pool.free > 0) {
      const id = this.pool.gen(cx, cz);
      this._genJobs.set(k, id);
      this._jobs.set(id, { kind: 'gen', cx, cz, k });
    }
    return undefined;
  }

  _requestMesh(chunk) {
    const id = this.pool.mesh(chunk.cx, chunk.cz, this._snapshot(chunk));
    chunk.meshJob = id;
    this._jobs.set(id, { kind: 'mesh', chunk, rev: chunk.rev });
  }

  // Take in what the workers finished since the last frame.
  _drain() {
    const { gens, meshes } = this.pool;
    for (let i = 0; i < gens.length; i++) {
      const msg = gens[i];
      const job = this._jobs.get(msg.id);
      if (!job) continue; // generated on the main thread in the meantime
      this._jobs.delete(msg.id);
      this._genJobs.delete(job.k);
      if (this.chunks.has(job.k)) continue;
      const chunk = new Chunk(job.cx, job.cz, msg.blocks);
      if (msg.lights) chunk.lights = msg.lights;
      chunk.generated = true;
      this._applyEdits(editKey(job.cx, job.cz), chunk); // replay saved player edits onto fresh terrain
      this.chunks.set(job.k, chunk);
    }
    gens.length = 0;

    let n = 0, drawn = 0;
    for (; n < meshes.length && drawn < MESHES_PER_FRAME; n++) {
      const msg = meshes[n];
      this._recycle(msg.vol);
      const job = this._jobs.get(msg.id);
      if (!job) continue;
      this._jobs.delete(msg.id);
      const chunk = job.chunk;
      if (chunk.meshJob !== msg.id) continue; // unloaded, or remeshed on the main thread
      chunk.meshJob = 0;
      if (job.rev <= chunk.meshRev) continue;
      // If the chunk changed while the worker had it, this mesh is already a
      // little old: draw it anyway (it is newer than what is showing) and the
      // chunk stays dirty, so the next pass sends it round again.
      this._setMesh(chunk, msg.mesh, job.rev);
      drawn++;
    }
    meshes.splice(0, n);
  }

  // The workers are gone: forget everything that was in flight. Chunks they
  // owed a mesh are still dirty, so the main-thread path picks them up.
  _abandonPool() {
    this.pool.dispose();
    this.pool = null;
    this._jobs.clear();
    this._genJobs.clear();
    for (const chunk of this.chunks.values()) chunk.meshJob = 0;
  }

  // Generate + mesh the chunks nearest (x, z) on this thread, before
  // returning. For spawning and teleporting, where there has to be ground to
  // stand on and something to look at on the very next frame. This is the one
  // place the page still stalls on terrain, so with workers it builds only
  // the immediate surroundings and lets update() stream in the rest.
  preload(x, z) {
    const count = this.pool ? PRELOAD_NEAR : PRELOAD_ALONE;
    this._buildNearest(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE), count);
  }

  _buildNearest(pcx, pcz, budget) {
    let work = 0;
    for (let i = 0; i < VISIT.length; i++) {
      const cx = pcx + VISIT[i][1], cz = pcz + VISIT[i][2];
      const chunk = this.getChunk(cx, cz);
      if (!chunk || !chunk.generated || chunk.dirty) {
        // Ensure its neighbours exist (see NEIGHBOURS), then mesh.
        const c = this.ensureChunk(cx, cz);
        for (let n = 0; n < NEIGHBOURS.length; n++) this.ensureChunk(cx + NEIGHBOURS[n][0], cz + NEIGHBOURS[n][1]);
        this.buildMesh(c);
        if (++work >= budget) break;
      }
    }
  }

  // Edits beside the player: remesh on this thread, this frame.
  _remeshEdits(pcx, pcz) {
    let built = 0;
    for (const chunk of this._urgent) {
      const near = Math.max(Math.abs(chunk.cx - pcx), Math.abs(chunk.cz - pcz)) <= URGENT_RADIUS;
      // Not showing a mesh, far away or unloaded: ordinary streaming (or
      // nothing at all) deals with it.
      if (!chunk.dirty || !chunk.mesh || !near || this.chunks.get(key(chunk.cx, chunk.cz)) !== chunk) {
        this._urgent.delete(chunk);
        continue;
      }
      if (built >= URGENT_PER_FRAME) break; // the rest keep their place for next frame
      this.buildMesh(chunk);
      this._urgent.delete(chunk);
      built++;
    }
  }

  // Hand the workers what the load disc still needs, nearest-first.
  _stream(pcx, pcz) {
    for (let i = 0; i < VISIT.length && this.pool.free > 0; i++) {
      const cx = pcx + VISIT[i][1], cz = pcz + VISIT[i][2];
      const chunk = this.getChunk(cx, cz) || this._requestGen(cx, cz);
      if (!chunk || !chunk.dirty || chunk.meshJob || this._urgent.has(chunk)) continue;
      // A mesh needs its neighbours' edge blocks (see NEIGHBOURS): get all
      // of those generating first.
      let ready = true;
      for (let n = 0; n < NEIGHBOURS.length; n++) {
        const nx = cx + NEIGHBOURS[n][0], nz = cz + NEIGHBOURS[n][1];
        if (!this.getChunk(nx, nz) && !this._requestGen(nx, nz)) ready = false;
      }
      if (ready && this.pool.free > 0) this._requestMesh(chunk);
    }
  }

  // Keep the chunks within LOAD_RADIUS of the player generated and meshed, and
  // unload those beyond UNLOAD_RADIUS. Called each frame with the player's
  // world position.
  update(playerX, playerZ) {
    const pcx = Math.floor(playerX / CHUNK_SIZE);
    const pcz = Math.floor(playerZ / CHUNK_SIZE);
    if (this.pool && this.pool.failed) this._abandonPool();

    if (this.pool) {
      this._drain();
      // The ground under and around the player has to exist before physics
      // runs. Normally the workers got there long ago and this does nothing.
      // (Scenery has no player to drop through it, so it just waits.)
      for (let dx = -1; dx <= 1 && !this.scenery; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (!this.getChunk(pcx + dx, pcz + dz)) this.ensureChunk(pcx + dx, pcz + dz);
        }
      }
    }
    this._remeshEdits(pcx, pcz);
    if (this.pool) this._stream(pcx, pcz);
    else this._buildNearest(pcx, pcz, this.scenery ? 1 : SYNC_BUDGET);

    // Unload far chunks: drop their meshes (free GPU memory) and move the block
    // data into the LRU cache so a revisit skips regeneration and keeps edits.
    for (const [k, chunk] of this.chunks) {
      const dx = chunk.cx - pcx;
      const dz = chunk.cz - pcz;
      if (dx * dx + dz * dz > UNLOAD_RADIUS * UNLOAD_RADIUS) {
        this._dropMesh(chunk);
        chunk.meshJob = 0; // a mesh still on its way back is no longer wanted
        this._urgent.delete(chunk);
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

  // Stop the workers and free the chunk meshes (Game.dispose).
  dispose() {
    if (this.pool) this.pool.dispose();
    this.pool = null;
    this._jobs.clear();
    this._genJobs.clear();
    this._urgent.clear();
    for (const chunk of this.chunks.values()) this._dropMesh(chunk);
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
    if (getGen() >= 2) return this._findSpawn2();
    // Generator version 1: unchanged, so a version-1 world's spawn (where
    // you come back to after dying) stays where it always was.
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

  // Generator version 2. Continents are bigger, so the origin can be far out
  // at sea — but the heightfield is cheap to ask (no chunks are generated), so
  // the search goes out two kilometres, and is choosier: low, gentle ground,
  // not a beach and not a ledge.
  _findSpawn2() {
    const gentle = (x, z) => {
      const h = columnHeight(x, z);
      if (h < SEA_LEVEL + 3 || h > SEA_LEVEL + 26) return false;
      return Math.abs(columnHeight(x + 5, z) - h) <= 2 && Math.abs(columnHeight(x - 5, z) - h) <= 2
        && Math.abs(columnHeight(x, z + 5) - h) <= 2 && Math.abs(columnHeight(x, z - 5) - h) <= 2;
    };
    let dry = null; // first land of any kind, in case nothing gentle turns up
    for (let r = 0; r <= 2048; r += 12) {
      const n = Math.max(1, Math.round((Math.PI * 2 * r) / 12));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
        if (gentle(x, z)) return { x, z };
        if (!dry && columnHeight(x, z) >= SEA_LEVEL + 1) dry = { x, z };
      }
    }
    return dry || { x: 0, z: 0 };
  }
}
