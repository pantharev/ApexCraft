import * as THREE from 'three';
import { Mob } from '../entities/Mob.js';
import { MOBS, PASSIVE, HOSTILE } from '../entities/mobTypes.js';
import { getBlockId, isSolid } from '../blocks/BlockRegistry.js';
import { Sound } from './Sound.js';

const GRASS = getBlockId('grass');
const PASSIVE_CAP = 10;
const HOSTILE_CAP = 14;
const DESPAWN = 70;
const SPAWN_MIN = 16;
const SPAWN_MAX = 34;

// Spawns, updates, and despawns mobs around the player. Passive mobs spawn on
// grass in daylight; hostile mobs spawn at night. Also resolves player melee
// attacks against mob AABBs.
export class MobManager {
  constructor(world, scene, itemDrops) {
    this.world = world;
    this.scene = scene;
    this.itemDrops = itemDrops;
    this.mobs = [];
    this.spawnTimer = 2;
  }

  count(category) {
    let n = 0;
    for (const m of this.mobs) if (m.def.category === category) n++;
    return n;
  }

  _spawn(type, x, y, z) {
    const mob = new Mob(type, x, y, z);
    mob.world = this.world;
    this.scene.add(mob.group);
    this.mobs.push(mob);
  }

  _trySpawn(ctx) {
    const hostile = ctx.isNight;
    const list = hostile ? HOSTILE : PASSIVE;
    const cap = hostile ? HOSTILE_CAP : PASSIVE_CAP;
    if (this.count(hostile ? 'hostile' : 'passive') >= cap) return;

    const p = ctx.playerPos;
    const angle = Math.random() * Math.PI * 2;
    const dist = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    const wx = Math.floor(p.x + Math.cos(angle) * dist);
    const wz = Math.floor(p.z + Math.sin(angle) * dist);

    const surf = this.world.surfaceHeight(wx, wz);
    const ground = this.world.getBlock(wx, surf, wz);
    if (!isSolid(ground)) return;
    if (!hostile && ground !== GRASS) return; // passive only on grass
    // Need headroom above the ground block.
    if (isSolid(this.world.getBlock(wx, surf + 1, wz)) || isSolid(this.world.getBlock(wx, surf + 2, wz))) return;

    this._spawn(list[Math.floor(Math.random() * list.length)], wx + 0.5, surf + 1, wz + 0.5);
  }

  update(dt, ctx) {
    // Multiplayer host: target/spawn around every player in the room, not just
    // the local one. ctx.players is [{ id, pos }]; absent = single-player.
    const players = ctx.players && ctx.players.length
      ? ctx.players
      : [{ id: 'self', pos: ctx.playerPos }];

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 2;
      const anchor = players[Math.floor(Math.random() * players.length)];
      this._trySpawn({ ...ctx, playerPos: anchor.pos });
    }

    const p = ctx.playerPos;
    for (const mob of this.mobs) {
      // Each mob hunts its nearest player; attacks route to that player's id.
      let near = players[0];
      let nearSq = Infinity;
      for (const pl of players) {
        const ddx = mob.pos.x - pl.pos.x, ddz = mob.pos.z - pl.pos.z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 < nearSq) { nearSq = d2; near = pl; }
      }
      mob.update(dt, {
        world: this.world,
        playerPos: near.pos,
        isNight: ctx.isNight,
        // fromPos (the mob) -> knockback direction for whoever got hit.
        attackPlayer: (dmg, fromPos) => ctx.attackPlayer(
          dmg, near.id,
          fromPos ? { x: near.pos.x - fromPos.x, z: near.pos.z - fromPos.z } : null
        ),
        shoot: ctx.shoot,
      });

      const dx = mob.pos.x - p.x, dz = mob.pos.z - p.z;
      if (mob.dead && !mob.deathHandled) {
        // Loot + sound fire once; the corpse animates its tip-over and then
        // flags itself `removed` (see Mob._updateDeath).
        mob.deathHandled = true;
        const dist = Math.sqrt(dx * dx + dz * dz);
        Sound.mobDeath(Math.max(0.1, 1 - dist / 30));
        for (const d of mob.def.drops) {
          const [lo, hi] = d.count;
          const c = lo + Math.floor(Math.random() * (hi - lo + 1));
          if (c > 0) this.itemDrops.spawn(d.item, c, Math.floor(mob.pos.x), Math.floor(mob.pos.y), Math.floor(mob.pos.z));
        }
      } else if (!mob.dead && (nearSq > DESPAWN * DESPAWN || mob.pos.y < -10)) {
        // Despawn only when far from *every* player.
        mob.removed = true;
      }
    }

    // Remove dead/despawned mobs from the scene.
    if (this.mobs.some((m) => m.removed)) {
      for (const m of this.mobs) {
        if (m.removed) {
          this.scene.remove(m.group);
          m.group.traverse((o) => o.geometry && o.geometry.dispose());
        }
      }
      this.mobs = this.mobs.filter((m) => !m.removed);
    }
  }

  // Compact state for multiplayer broadcast (host -> guests, ~10 Hz).
  snapshot() {
    return this.mobs.map((m) => ({
      i: m.id, t: m.type,
      x: +m.pos.x.toFixed(2), y: +m.pos.y.toFixed(2), z: +m.pos.z.toFixed(2),
      yaw: +m.yaw.toFixed(2), h: m.health,
    }));
  }

  // Find a live mob by id (host applies guests' reported hits).
  byId(id) {
    for (const m of this.mobs) if (m.id === id && !m.dead) return m;
    return null;
  }

  // Nearest mob hit by the ray within `reach`, or null. Slab AABB test.
  raycast(origin, dir, reach) {
    let best = null;
    let bestT = reach;
    for (const mob of this.mobs) {
      if (mob.dead) continue; // corpses don't soak hits
      const { min, max } = mob.aabb();
      const t = rayAABB(origin, dir, min, max);
      if (t !== null && t >= 0 && t <= bestT) { bestT = t; best = mob; }
    }
    return best;
  }
}

export function rayAABB(o, d, min, max) {
  let tmin = -Infinity, tmax = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    if (Math.abs(d[axis]) < 1e-8) {
      if (o[axis] < min[axis] || o[axis] > max[axis]) return null;
    } else {
      let t1 = (min[axis] - o[axis]) / d[axis];
      let t2 = (max[axis] - o[axis]) / d[axis];
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin >= 0 ? tmin : (tmax >= 0 ? 0 : null);
}
