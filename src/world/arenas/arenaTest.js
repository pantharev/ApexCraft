// Headless arena-map test (see changelog #42/#44). Plain Node can't import
// the JSON modules the registries use, so bundle first, then run:
//
//   npx esbuild src/world/arenas/arenaTest.js --bundle --format=esm --outfile=.arena-test.mjs
//   node .arena-test.mjs
//
// Generates every chunk of an arena map onto the flat arena base (mirroring
// TerrainGen.generateArenaChunk) and asserts its load-bearing structure across
// two seeds. Prints `ok -` / `FAIL -` lines like the other test scripts.

import { CHUNK_SIZE } from '../../config.js';
import { Chunk } from '../../core/Chunk.js';
import { reseed } from '../noise.js';
import { getBlockId, isSolid } from '../../blocks/BlockRegistry.js';
import { FLOOR_Y } from './lib.js';
import * as bastion from './maps/bastion.js';

const BEDROCK = getBlockId('bedrock');
const STONE = getBlockId('stone');
const GRAVEL = getBlockId('gravel');
const LADDER = getBlockId('ladder');
const GRASS = getBlockId('grass');
const FY = FLOOR_Y;

let fails = 0;
function ok(cond, msg) {
  console.log(`${cond ? 'ok' : 'FAIL'} - ${msg}`);
  if (!cond) fails++;
}

// Generate the whole map into a chunk grid and return a world-coordinate getter.
function buildWorld(map) {
  const chunks = new Map();
  const R = Math.ceil((map.half + 8) / CHUNK_SIZE) + 1;
  const surface = getBlockId(map.baseSurface) || GRASS;
  for (let cx = -R; cx <= R; cx++) {
    for (let cz = -R; cz <= R; cz++) {
      const c = new Chunk(cx, cz);
      for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          for (let y = 0; y <= FY; y++) c.set(x, y, z, y === 0 ? BEDROCK : y === FY ? surface : STONE);
        }
      }
      map.generate(c);
      chunks.set(`${cx},${cz}`, c);
    }
  }
  return (x, y, z) => {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const c = chunks.get(`${cx},${cz}`);
    return c ? c.get(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE) : 0;
  };
}

// A spawn point is standable when it has solid ground and a non-solid body
// (flora like glow mushrooms is fine to stand in).
function standable(get, s) {
  const x = Math.floor(s.x), z = Math.floor(s.z), y = Math.floor(s.y);
  return isSolid(get(x, y - 1, z)) && !isSolid(get(x, y, z)) && !isSolid(get(x, y + 1, z));
}

for (const seed of [12345, 987654321]) {
  reseed(seed);
  const get = buildWorld(bastion);
  const tag = `bastion seed ${seed}`;

  // The bedrock shell: solid on all four sides and over the full height, open
  // above the parapet.
  for (const [x, z, side] of [[20, 46, 'S'], [20, -46, 'N'], [46, 20, 'E'], [-46, 20, 'W'], [47, 47, 'corner']]) {
    ok(get(x, FY + 2, z) === BEDROCK, `${tag}: ${side} wall bedrock at (${x},${z})`);
  }
  ok(get(20, FY + 7, 46) === BEDROCK, `${tag}: wall reaches full height`);
  ok(get(20, FY + 8, 46) === 0, `${tag}: open sky above the wall`);

  // Gates: a 3-wide, 3-high bore through the ring at each midpoint, lintel
  // closed above, roofed tunnel outside with a gravel bed.
  for (const [dx, dz, side] of [[0, 1, 'S'], [0, -1, 'N'], [1, 0, 'E'], [-1, 0, 'W']]) {
    let open = true;
    for (let d = 46; d <= 48; d++) {
      for (let s = -1; s <= 1; s++) {
        for (let y = FY + 1; y <= FY + 3; y++) {
          const x = dx === 0 ? s : dx * d, z = dz === 0 ? s : dz * d;
          if (get(x, y, z) !== 0) open = false;
        }
      }
    }
    ok(open, `${tag}: ${side} gate bore is open`);
    ok(get(dx * 47, FY + 4, dz * 47) === BEDROCK, `${tag}: ${side} gate lintel closed`);
    ok(get(dx * 51, FY + 4, dz * 51) === BEDROCK, `${tag}: ${side} tunnel roofed`);
    ok(get(dx * 51, FY + 2, dz * 51) === 0, `${tag}: ${side} tunnel bore open`);
    ok(get(dx * 51, FY, dz * 51) === GRAVEL, `${tag}: ${side} tunnel gravel bed`);
  }

  // Spawns: all gate pads, four player spawns, and the lobby are standable.
  for (const [i, g] of bastion.zombieGates().entries()) {
    ok(standable(get, g), `${tag}: zombie gate pad ${i} standable`);
  }
  for (const [i, s] of bastion.playerSpawns(4).entries()) {
    ok(standable(get, s), `${tag}: player spawn ${i} standable`);
  }
  ok(standable(get, bastion.lobbySpawn()), `${tag}: lobby spawn standable`);

  // The keep: masonry ring with open east/west entries, breakable (not bedrock).
  const keepWall = get(12, FY + 1, 5);
  ok(isSolid(keepWall) && keepWall !== BEDROCK, `${tag}: keep wall solid and breakable`);
  ok(get(12, FY + 1, 0) === 0 && get(12, FY + 2, 0) === 0, `${tag}: keep east entry open`);
  ok(get(-12, FY + 1, 0) === 0 && get(-12, FY + 2, 0) === 0, `${tag}: keep west entry open`);

  // The Mystery Box sits in the supply corner (gun spins between waves).
  ok(get(4, FY + 1, -10) === getBlockId('mystery_box'), `${tag}: mystery box in the supply corner`);

  // Archer platforms: deck present, ladder continuous and level with the deck.
  ok(get(9, FY + 4, 9) === STONE, `${tag}: archer platform deck`);
  let ladderOk = true;
  for (let y = FY + 1; y <= FY + 4; y++) if (get(8, y, 9) !== LADDER) ladderOk = false;
  ok(ladderOk, `${tag}: platform ladder continuous and deck-level`);
}

console.log(fails === 0 ? 'ARENA TESTS PASSED' : `ARENA TESTS FAILED (${fails})`);
process.exit(fails === 0 ? 0 : 1);
