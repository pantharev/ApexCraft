import { CHUNK_SIZE, WORLD_HEIGHT } from '../config.js';

// A vertical column of blocks, CHUNK_SIZE x WORLD_HEIGHT x CHUNK_SIZE.
// Block ids stored in a flat Uint8Array, indexed (x, y, z).
export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE);
    this.dirty = true; // needs (re)meshing
    this.mesh = null;
    this.generated = false;
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
    this.dirty = true;
  }
}
