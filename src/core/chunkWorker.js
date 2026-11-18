// Chunk worker: terrain generation and meshing off the main thread.
//
// The page (core/ChunkPool.js) starts a few of these and sends each an `init`
// with the world's seed, generation mode, arena map and tile tables, then
// `gen` and `mesh` jobs. Both are pure functions of their inputs, so a worker
// holds no world state — the page owns every chunk and sends a snapshot of
// the voxels a mesh needs (ChunkMesher.buildVolume).
//
// Everything imported here, directly or not, must run without three.js and
// without the DOM. core/chunkTest.js runs the same modules under plain Node,
// so an import that breaks that rule fails there first.
import { reseed } from '../world/noise.js';
import { generateChunk, setGenMode } from '../world/generators/TerrainGen.js';
import { setActiveMap } from '../world/arenas/index.js';
import { Chunk } from './Chunk.js';
import { meshVolume, meshTransferables, setTileTables } from './ChunkMesher.js';

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'gen') {
    const chunk = new Chunk(m.cx, m.cz);
    generateChunk(chunk);
    // The block array is handed over, not copied.
    self.postMessage({ id: m.id, blocks: chunk.blocks, lights: chunk.lights || null }, [chunk.blocks.buffer]);
  } else if (m.type === 'mesh') {
    const mesh = meshVolume(m.vol, m.cx, m.cz);
    // The snapshot goes back with the mesh so the page can fill it again.
    self.postMessage({ id: m.id, mesh, vol: m.vol }, [...meshTransferables(mesh), m.vol.buffer]);
  } else if (m.type === 'init') {
    reseed(m.seed);
    setActiveMap(m.map);
    setGenMode(m.genMode);
    setTileTables(m.tables);
  }
};
