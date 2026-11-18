import { CHUNK_SIZE, WORLD_HEIGHT } from '../config.js';

// A vertical column of blocks, CHUNK_SIZE x WORLD_HEIGHT x CHUNK_SIZE.
// Block ids stored in a flat Uint8Array, indexed (x, y, z).
export class Chunk {
  // `blocks` lets the World adopt a buffer a chunk worker generated.
  constructor(cx, cz, blocks = null) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = blocks || new Uint8Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE);
    // Meshes are built off the main thread, so "needs remeshing" is a pair of
    // revisions rather than a flag: `rev` counts changes to anything the mesh
    // depends on, `meshRev` is the revision the current mesh was built from.
    // A mesh that comes back from a worker after a later edit is then still
    // (correctly) dirty, and an older one never replaces a newer one.
    this.rev = 1;
    this.meshRev = 0;
    this.meshJob = 0; // id of the worker mesh job in flight (0 = none)
    this.mesh = null;
    this.generated = false;
  }

  // needs (re)meshing. `chunk.dirty = true` marks a change.
  get dirty() { return this.meshRev !== this.rev; }
  set dirty(v) {
    if (v) this.rev++;
    else this.meshRev = this.rev;
  }

  static index(x, y, z) {
    return (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
  }

  get(x, y, z) {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) {
      return 0;
    }
    return this.blocks[Chunk.index(x, y, z)];
  }

  set(x, y, z, id) {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) {
      return;
    }
    this.blocks[Chunk.index(x, y, z)] = id;
    this.rev++;
  }
}
