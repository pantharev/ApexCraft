import { getBlock, getBlockId, liquidKind } from '../blocks/BlockRegistry.js';

// Tick-based liquid flow. Water and lava sources stay where they are placed,
// but pour into neighbouring cells as "flow" blocks that get one level weaker
// (and render one step shorter — see FLOW in ChunkMesher) per block travelled.
// Falling beats spreading, so a stream drops down cliffs and cave shafts before
// it fans out. Removing a source drains its stream one level per tick.
//
// The sim is edge-triggered: nothing ticks until a block edit (any source —
// player, mob, explosion, or a remote peer) touches a liquid or one of its
// neighbours, so still oceans and gen-time cave pools cost nothing.
//
// Every state change goes through World.setBlock, which means flow blocks ride
// the existing edits map (saves), net sync, and remesh paths for free. In
// multiplayer only the authority (host / single-player) simulates; guests just
// apply the resulting edits — same split as mobs.

const CHAINS = {
  water: ['water', 'water_flow_7', 'water_flow_6', 'water_flow_5', 'water_flow_4',
    'water_flow_3', 'water_flow_2', 'water_flow_1'].map(getBlockId),
  lava: ['lava', 'lava_flow_3', 'lava_flow_2', 'lava_flow_1'].map(getBlockId),
};
const TICK = { water: 0.25, lava: 0.75 }; // seconds per flow step (lava is sluggish)
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const STONE = getBlockId('stone');

// Liquid block id -> { kind, idx } (idx 0 = source; higher = weaker flow).
const INFO = new Map();
for (const [kind, chain] of Object.entries(CHAINS)) {
  chain.forEach((id, idx) => INFO.set(id, { kind, idx }));
}

const key = (x, y, z) => `${x},${y},${z}`;

export class Liquids {
  constructor(world) {
    this.world = world;
    this.enabled = true; // authority flag — guests receive edits instead of simulating
    this.queue = new Map(); // "x,y,z" -> sim time the cell is due
    this.now = 0;
  }

  // Called on every block edit: wake any liquid in or next to the changed cell.
  touch(x, y, z) {
    this._schedule(x, y, z);
    this._schedule(x + 1, y, z);
    this._schedule(x - 1, y, z);
    this._schedule(x, y + 1, z);
    this._schedule(x, y - 1, z);
    this._schedule(x, y, z + 1);
    this._schedule(x, y, z - 1);
  }

  _schedule(x, y, z) {
    const info = INFO.get(this.world.getBlock(x, y, z));
    if (!info) return;
    const k = key(x, y, z);
    if (!this.queue.has(k)) this.queue.set(k, this.now + TICK[info.kind]);
  }

  // Budgeted so a large flood spreads over several frames instead of hitching
  // one. Cells not yet due stay queued.
  update(dt, budget = 96) {
    if (!this.enabled) {
      if (this.queue.size) this.queue.clear();
      return;
    }
    this.now += dt;
    if (this.queue.size === 0) return;
    let work = 0;
    for (const [k, due] of this.queue) {
      if (work >= budget) break;
      if (due > this.now) continue;
      this.queue.delete(k);
      work++;
      const [x, y, z] = k.split(',').map(Number);
      this._step(x, y, z);
    }
  }

  _step(x, y, z) {
    const world = this.world;
    const id = world.getBlock(x, y, z);
    const info = INFO.get(id);
    if (!info) return;
    const { kind, idx } = info;
    const chain = CHAINS[kind];

    // A flow cell with no feeder decays one level per tick, draining the
    // stream from the point of the break outward.
    if (idx > 0 && !this._fed(x, y, z, kind, idx)) {
      world.setBlock(x, y, z, idx + 1 < chain.length ? chain[idx + 1] : 0);
      return;
    }

    // Falling beats spreading. A same-kind flow below means the column is
    // already established — keep it at full strength and stop there.
    const below = world.getBlock(x, y - 1, z);
    const belowInfo = INFO.get(below);
    if (belowInfo && belowInfo.kind === kind && belowInfo.idx > 0) {
      if (belowInfo.idx > 1) world.setBlock(x, y - 1, z, chain[1]);
      return;
    }
    if (this._pour(x, y - 1, z, kind, 1, below)) return;

    // Blocked below (or resting on a source pool): fan out one level weaker.
    if (idx + 1 >= chain.length) return; // thinnest trickle — stops here
    for (const [dx, dz] of SIDES) {
      const tx = x + dx, tz = z + dz;
      this._pour(tx, y, tz, kind, idx + 1, world.getBlock(tx, y, tz));
    }
  }

  // A flow cell stays alive while something feeds it: same liquid directly
  // above, or a horizontally-adjacent cell strictly closer to a source.
  _fed(x, y, z, kind, idx) {
    if (liquidKind(this.world.getBlock(x, y + 1, z)) === kind) return true;
    for (const [dx, dz] of SIDES) {
      const info = INFO.get(this.world.getBlock(x + dx, y, z + dz));
      if (info && info.kind === kind && info.idx < idx) return true;
    }
    return false;
  }

  // Try to put chain[level] into a cell. Returns true if the cell accepted the
  // liquid (also when the target was opposing liquid and quenched to stone).
  _pour(x, y, z, kind, level, targetId) {
    if (y < 0) return false;
    const tKind = liquidKind(targetId);
    if (tKind && tKind !== kind) {
      // Water and lava quench to stone on contact.
      this.world.setBlock(x, y, z, STONE);
      return true;
    }
    const tInfo = INFO.get(targetId);
    const newId = CHAINS[kind][level];
    if (tInfo) {
      // Same liquid: only ever strengthen (lower idx = stronger), never weaken.
      if (tInfo.idx > level) { this.world.setBlock(x, y, z, newId); return true; }
      return false;
    }
    // Air and plants give way to liquid; anything else blocks it.
    if (targetId === 0 || getBlock(targetId).plant) {
      this.world.setBlock(x, y, z, newId);
      return true;
    }
    return false;
  }
}
