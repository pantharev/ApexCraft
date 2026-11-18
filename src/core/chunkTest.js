// Headless test of the chunk pipeline — the code the chunk workers run
// (terrain generation, the snapshot, the mesher). Plain Node can't import the
// JSON modules the registries use, so bundle first, then run:
//
//   npx esbuild src/core/chunkTest.js --bundle --format=esm --outfile=.chunk-test.mjs
//   node .chunk-test.mjs
//
// It doubles as the guard on the workers' one rule: everything they import
// must run with no DOM and no three.js. Break that and this fails to load.
// Prints `ok -` / `FAIL -` lines like the other test scripts.

import { CHUNK_SIZE, WORLD_HEIGHT, WATER_DROP } from '../config.js';
import { Chunk } from './Chunk.js';
import { reseed, genOf, newSeed, getGen, GEN_LATEST } from '../world/noise.js';
import { generateChunk, setGenMode } from '../world/generators/TerrainGen.js';
import { setActiveMap } from '../world/arenas/index.js';
import { getBlockId, isOpaque } from '../blocks/BlockRegistry.js';
import { buildVolume, meshVolume, meshTransferables, setTileTables, volIndex, VOL_SIZE } from './ChunkMesher.js';

let fails = 0;
function ok(cond, msg) {
  console.log(`${cond ? 'ok' : 'FAIL'} - ${msg}`);
  if (!cond) fails++;
}

const S = CHUNK_SIZE, H = WORLD_HEIGHT;
const LEAVES = getBlockId('oak_leaves');
const GLASS = getBlockId('glass');
const WATER = getBlockId('water');

// Stand-in tile tables (the real ones come from the texture atlas, which needs
// a canvas): one tile per block id, leaves and glass in the cut-out buffers.
const ids = new Uint16Array(256).map((_, i) => i);
const kind = new Array(256).fill(0);
kind[LEAVES] = 1;
kind[GLASS] = 2;
setTileTables({ top: ids, side: ids, bottom: ids, kind, variation: new Array(256).fill(0), glow: new Array(256).fill(0) });

const gen = (cx, cz) => { const c = new Chunk(cx, cz); generateChunk(c); return c; };
const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// A 3x3 block of chunks around (cx, cz), and the snapshot / mesh of its centre.
function region(cx, cz) {
  const chunks = new Map();
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) chunks.set(`${dx},${dz}`, gen(cx + dx, cz + dz));
  return chunks;
}
const blocksAt = (chunks) => (dx, dz) => chunks.get(`${dx},${dz}`).blocks;
const alone = (chunks) => (dx, dz) => (dx === 0 && dz === 0 ? chunks.get('0,0').blocks : null);

function checkGeometry(g, cx, cz, label) {
  const verts = g.position.length / 3;
  let good = verts > 0 && verts % 4 === 0
    && g.normal.length === verts * 3 && g.uv.length === verts * 2 && g.color.length === verts * 3
    && (!g.tile || g.tile.length === verts * 3)
    && g.index.length === (verts / 4) * 6;
  ok(good, `${label}: ${verts} vertices in whole quads, every attribute the same length`);
  let inRange = true;
  for (let i = 0; i < g.index.length; i++) if (g.index[i] >= verts) { inRange = false; break; }
  ok(inRange, `${label}: every index points at a vertex`);
  const x0 = cx * S, z0 = cz * S;
  const [sx, sy, sz, r] = g.sphere;
  let inside = true, inSphere = true;
  for (let p = 0; p < g.position.length; p += 3) {
    const x = g.position[p], y = g.position[p + 1], z = g.position[p + 2];
    if (x < x0 || x > x0 + S || z < z0 || z > z0 + S || y < 0 || y > H) inside = false;
    if (Math.hypot(x - sx, y - sy, z - sz) > r + 1e-3) inSphere = false;
  }
  ok(inside, `${label}: every vertex is inside the chunk's box`);
  ok(inSphere, `${label}: the bounding sphere holds every vertex`);
  return verts;
}

// One world of each generator version (see noise.js): the first two seeds
// predate versions and are version 1, the third is version 2.
for (const seed of [1337, 987654321, 1289044641]) {
  reseed(seed);
  setGenMode(null);
  const tag = `seed ${seed}`;

  // --- generation ---
  const a = gen(3, -2), b = gen(3, -2);
  ok(sameBytes(a.blocks, b.blocks), `${tag}: generating a chunk twice gives the same blocks`);
  ok(a.generated && a.dirty, `${tag}: a generated chunk is marked generated and dirty`);
  ok(JSON.stringify(a.lights || []) === JSON.stringify(b.lights || []), `${tag}: ...and the same glow-light list`);
  let bedrock = true;
  for (let x = 0; x < S; x++) for (let z = 0; z < S; z++) if (a.get(x, 0, z) !== getBlockId('bedrock')) bedrock = false;
  ok(bedrock, `${tag}: bedrock floor at y = 0`);

  // --- the dirty/revision bookkeeping the worker round-trip relies on ---
  const rev = a.rev;
  a.dirty = false;
  ok(!a.dirty && a.meshRev === rev, `${tag}: clearing dirty records the meshed revision`);
  a.set(1, 70, 1, getBlockId('stone'));
  ok(a.dirty && a.rev === rev + 1, `${tag}: a block write makes the chunk dirty again`);
  a.meshRev = rev; // a mesh of the older data comes back from a worker...
  ok(a.dirty, `${tag}: ...and the chunk is still dirty`);

  // --- the snapshot ---
  const chunks = region(3, -2);
  const vol = buildVolume(blocksAt(chunks));
  ok(vol.length === VOL_SIZE, `${tag}: snapshot has the padded size`);
  let centre = true, ring = true, pad = true;
  const world = (lx, y, lz) => {
    const dx = lx < 0 ? -1 : lx >= S ? 1 : 0, dz = lz < 0 ? -1 : lz >= S ? 1 : 0;
    return chunks.get(`${dx},${dz}`).get(lx - dx * S, y, lz - dz * S);
  };
  for (let y = 0; y < H; y++) {
    for (let lz = -1; lz <= S; lz++) {
      for (let lx = -1; lx <= S; lx++) {
        const same = vol[volIndex(lx, y, lz)] === world(lx, y, lz);
        if (same) continue;
        if (lx >= 0 && lx < S && lz >= 0 && lz < S) centre = false; else ring = false;
      }
    }
  }
  for (let lz = -1; lz <= S; lz++) for (let lx = -1; lx <= S; lx++) if (vol[volIndex(lx, -1, lz)] || vol[volIndex(lx, H, lz)]) pad = false;
  ok(centre, `${tag}: snapshot centre equals the chunk`);
  ok(ring, `${tag}: snapshot ring equals the eight neighbours' edges`);
  ok(pad, `${tag}: the layers below and above the world are air`);
  const reused = buildVolume(blocksAt(chunks), new Uint8Array(VOL_SIZE).fill(7).fill(0, 0, volIndex(-1, 0, -1)).fill(0, volIndex(-1, H, -1)));
  ok(sameBytes(reused, vol), `${tag}: refilling a used snapshot buffer gives the same snapshot`);
  const lonely = buildVolume(alone(chunks), reused);
  let cleared = true;
  for (let y = 0; y < H; y++) for (let i = -1; i <= S; i++) {
    if (lonely[volIndex(-1, y, i)] || lonely[volIndex(S, y, i)] || lonely[volIndex(i, y, -1)] || lonely[volIndex(i, y, S)]) cleared = false;
  }
  ok(cleared, `${tag}: a missing neighbour reads as air even in a reused buffer`);

  // --- the mesh ---
  const mesh = meshVolume(vol, 3, -2);
  ok(!!mesh.solid, `${tag}: terrain chunk has solid geometry`);
  const verts = checkGeometry(mesh.solid, 3, -2, `${tag} solid`);
  if (mesh.cutout) {
    checkGeometry(mesh.cutout, 3, -2, `${tag} cut-out`);
    ok(mesh.cutout.leafCount % 6 === 0 && mesh.cutout.leafCount <= mesh.cutout.index.length, `${tag}: leaves are a whole number of quads at the front of the cut-out geometry`);
  }
  if (mesh.water) {
    checkGeometry(mesh.water, 3, -2, `${tag} water`);
    ok(mesh.water.tile === null, `${tag}: the water sheet carries no tile attribute`);
    ok(mesh.water.depth && mesh.water.depth.length === mesh.water.position.length / 3
      && mesh.water.depth.every((d) => d >= 0 && d <= 1), `${tag}: every water vertex has a depth between 0 and 1`);
  }
  const again = meshVolume(buildVolume(blocksAt(chunks)), 3, -2);
  ok(sameBytes(again.solid.position, mesh.solid.position) && sameBytes(again.solid.color, mesh.solid.color) && sameBytes(again.solid.index, mesh.solid.index),
    `${tag}: meshing the same snapshot twice gives the same geometry`);
  const bare = meshVolume(buildVolume(alone(chunks)), 3, -2);
  ok(bare.solid.position.length / 3 > verts, `${tag}: with its neighbours present the chunk hides its border faces (${verts} vs ${bare.solid.position.length / 3} vertices)`);
  const buffers = meshTransferables(mesh);
  ok(buffers.length >= 5 && buffers.every((x) => x instanceof ArrayBuffer) && new Set(buffers).size === buffers.length, `${tag}: a mesh result lists each of its buffers once for transfer`);

  // An edit shows up in the next mesh: knock out the top opaque block of a column.
  const c = chunks.get('0,0');
  let ty = H - 1;
  while (ty > 0 && !isOpaque(c.get(8, ty, 8))) ty--;
  c.set(8, ty, 8, 0);
  const edited = meshVolume(buildVolume(blocksAt(chunks)), 3, -2);
  ok(!sameBytes(edited.solid.position, mesh.solid.position), `${tag}: removing a block changes the mesh`);

  // Empty space above the world's terrain costs nothing and draws nothing.
  const sky = meshVolume(new Uint8Array(VOL_SIZE), 0, 0);
  ok(sky.solid === null && sky.cutout === null && sky.water === null, `${tag}: an empty snapshot has no geometry`);
}

// A lone water block: its faces go to the water geometry, not the terrain.
{
  const vol = new Uint8Array(VOL_SIZE);
  vol[volIndex(4, 10, 4)] = WATER;
  const m = meshVolume(vol, 0, 0);
  ok(m.water && m.water.position.length / 3 === 24 && !m.solid, 'a lone water block is six water quads and no terrain');
  let top = -Infinity, bottom = Infinity;
  for (let p = 1; p < m.water.position.length; p += 3) { top = Math.max(top, m.water.position[p]); bottom = Math.min(bottom, m.water.position[p]); }
  ok(Math.abs(top - (11 - WATER_DROP)) < 1e-6 && bottom === 10, 'its surface sits WATER_DROP below the top of the block; its base does not move');
}

// A pool: a 6x6 basin of stone, three blocks of water deep.
{
  const STONE = getBlockId('stone');
  const vol = new Uint8Array(VOL_SIZE);
  for (let x = 2; x <= 9; x++) for (let z = 2; z <= 9; z++) for (let y = 5; y <= 9; y++) {
    const inside = x >= 3 && x <= 8 && z >= 3 && z <= 8 && y >= 7;
    vol[volIndex(x, y, z)] = inside ? WATER : STONE;
  }
  const m = meshVolume(vol, 0, 0);
  const w = m.water, g = m.solid;
  // The surface: rim vertices are shore, the middle is deep.
  let rimOk = true, midOk = true, surface = 0;
  for (let v = 0; v < w.position.length / 3; v++) {
    if (w.normal[v * 3 + 1] !== 1) continue;
    surface++;
    const x = w.position[v * 3], y = w.position[v * 3 + 1], z = w.position[v * 3 + 2];
    if (Math.abs(y - (10 - WATER_DROP)) > 1e-6) rimOk = false;
    const onRim = x === 3 || x === 9 || z === 3 || z === 9;
    if (onRim && w.depth[v] !== 0) rimOk = false;
    if (x >= 5 && x <= 7 && z >= 5 && z <= 7 && w.depth[v] !== 1) midOk = false;
  }
  ok(surface > 0 && rimOk, 'pool: the surface is lowered and its depth is 0 all along the shore');
  ok(midOk, 'pool: the depth is 1 in the middle, three blocks down');
  // The ground: faces that look into the water are marked wet (variation + 4), the rest are not.
  let floorWet = true, rimDry = true, floor = 0, rim = 0;
  for (let v = 0; v < g.position.length / 3; v++) {
    if (g.normal[v * 3 + 1] !== 1) continue;
    const y = g.position[v * 3 + 1], variation = g.tile[v * 3 + 1];
    if (y === 7) { floor++; if (variation !== 4) floorWet = false; }
    if (y === 10) { rim++; if (variation !== 0) rimDry = false; }
  }
  ok(floor > 0 && floorWet, 'pool: the floor under the water is marked wet');
  ok(rim > 0 && rimDry, 'pool: the dry rim is not');
}

// --- Generator versions ---
// A world is its seed plus the player's edits, so what a seed generates must
// never change once worlds exist. The version rides in the seed...
ok(genOf(1337) === 1 && genOf(999999999) === 1 && genOf(0) === 1, 'seeds from before versions existed are generator version 1');
ok(genOf(newSeed()) === GEN_LATEST && genOf(newSeed(2)) === 2 && genOf(newSeed(7)) === 7, 'a new seed carries the version it was made for');
reseed(1289044641);
ok(getGen() === 2, 'reseeding sets the generator version from the seed');
// ...and these fingerprints hold every version to its word. They cover the
// whole pipeline (terrain, caves, ores, villages, trees, plants) for a spread
// of chunks. If one changes, generation changed for existing worlds: put the
// change behind a new version instead (noise.js explains how), and leave
// these alone. Only add a line here, when a version is added.
{
  const fingerprint = (seed) => {
    reseed(seed);
    let h = 0x811c9dc5;
    const mix = (bytes) => { for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); } };
    for (const [cx, cz] of [[0, 0], [1, 0], [0, 1], [-3, 7], [40, -25], [-120, -64], [300, 300], [9, 9]]) {
      const c = gen(cx, cz);
      mix(c.blocks);
      mix(new TextEncoder().encode(JSON.stringify(c.lights || [])));
    }
    return h >>> 0;
  };
  const FROZEN = [
    [1, 1337, 332789],
    [1, 987654321, 2458805752],
    [1, 583847868, 1589761591],
    [2, 1289044641, 3787435600],
    [2, 1100000007, 3542795061],
  ];
  for (const [version, seed, want] of FROZEN) {
    const got = fingerprint(seed);
    ok(got === want, `generator version ${version} still makes the same world for seed ${seed}${got === want ? '' : ` (fingerprint ${got}, expected ${want})`}`);
  }
}

// Version 2 terrain across a wide area: sound from bedrock to sky.
{
  reseed(1100000007);
  let sound = true, tallest = 0, wet = 0;
  const BEDROCK = getBlockId('bedrock');
  for (let i = 0; i < 48; i++) {
    const c = gen(i * 37 - 800, (i * 53) % 400 - 200);
    for (let x = 0; x < S; x++) for (let z = 0; z < S; z++) {
      if (c.get(x, 0, z) !== BEDROCK) sound = false;
      for (let y = H - 1; y > 0; y--) {
        const id = c.get(x, y, z);
        if (id === 0) continue;
        if (y > tallest) tallest = y;
        if (id === WATER && y > 62) wet++; // only a village well may hold water above sea level
        break;
      }
    }
  }
  ok(sound, 'version 2: bedrock under every column');
  ok(tallest > 62 && tallest <= H - 3, `version 2: land rises above the sea and stays under the ceiling (highest block ${tallest})`);
  ok(wet < 40, 'version 2: no water standing above sea level');
}

// --- arena mode (Prop Hunt / Zombies maps) ---
reseed(424242);
setActiveMap('bastion');
setGenMode('arena');
{
  const a = gen(0, 0), b = gen(0, 0);
  ok(sameBytes(a.blocks, b.blocks), 'arena: generating a chunk twice gives the same blocks');
  const chunks = region(0, 0);
  const mesh = meshVolume(buildVolume(blocksAt(chunks)), 0, 0);
  ok(!!mesh.solid, 'arena: the centre chunk has solid geometry');
  checkGeometry(mesh.solid, 0, 0, 'arena solid');
}
setGenMode(null);

console.log(fails === 0 ? '\nCHUNK TESTS PASSED' : `\n${fails} CHUNK TEST(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
