import * as THREE from 'three';
import { Mob } from '../entities/Mob.js';
import { MOBS, PASSIVE, HOSTILE } from '../entities/mobTypes.js';
import { getBlockId, isSolid } from '../blocks/BlockRegistry.js';
import { villagesNear, villageLayout } from '../world/structures/VillagePlan.js';
import { Sound } from './Sound.js';

const GRASS = getBlockId('grass');
const PASSIVE_CAP = 10;
const HOSTILE_CAP = 14;
const VILLAGER_CAP = 4; // per village
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
    this.villagerTimer = 3;
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
    return mob;
  }

  // Villages repopulate while a player is nearby: a few villagers around the
  // well (leashed to it) up to a small cap, plus one iron golem on patrol.
  _trySpawnVillagers(players) {
    for (const pl of players) {
      for (const v of villagesNear(pl.pos.x, pl.pos.z, 80)) {
        let n = 0, golems = 0;
        for (const m of this.mobs) {
          if (m.dead) continue;
          if (Math.hypot(m.pos.x - v.x, m.pos.z - v.z) >= 50) continue;
          if (m.type === 'villager') n++;
          else if (m.type === 'iron_golem') golems++;
        }
        if (n < VILLAGER_CAP) this._spawnAtVillage(v, 'villager');
        if (golems < 1) this._spawnAtVillage(v, 'iron_golem');
      }
    }
  }

  _spawnAtVillage(v, type) {
    const a = Math.random() * Math.PI * 2;
    const r = 4 + Math.random() * 7; // off the well pad, inside the house ring
    const wx = Math.floor(v.x + Math.cos(a) * r);
    const wz = Math.floor(v.z + Math.sin(a) * r);
    const surf = this.world.surfaceHeight(wx, wz);
    if (!isSolid(this.world.getBlock(wx, surf, wz))) return;
    if (isSolid(this.world.getBlock(wx, surf + 1, wz)) ||
        isSolid(this.world.getBlock(wx, surf + 2, wz))) return;
    const mob = this._spawn(type, wx + 0.5, surf + 1, wz + 0.5);
    mob.anchor = { x: v.x, z: v.z };
    if (type === 'villager') {
      // Each villager claims a house to run to at night.
      const houses = villageLayout(v).houses;
      mob.home = houses.length
        ? (() => { const h = houses[Math.floor(Math.random() * houses.length)]; return { x: h.x, z: h.z }; })()
        : { x: v.x, z: v.z };
    }
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

    this.villagerTimer -= dt;
    if (this.villagerTimer <= 0) {
      this.villagerTimer = 4;
      this._trySpawnVillagers(players);
    }

    // Census for cross-mob behaviour: zombies hunt villagers, golems hunt
    // hostiles, villagers panic near monsters.
    const villagers = [];
    const hostiles = [];
    for (const m of this.mobs) {
      if (m.dead) continue;
      if (m.type === 'villager') villagers.push(m);
      else if (m.def.category === 'hostile') hostiles.push(m);
    }
    const distSq = (a, b) => {
      const ddx = a.pos.x - b.x, ddz = a.pos.z - b.z;
      return ddx * ddx + ddz * ddz;
    };

    const p = ctx.playerPos;
    for (const mob of this.mobs) {
      // Nearest player: despawn anchor and the default aggro target.
      let near = players[0];
      let nearSq = Infinity;
      for (const pl of players) {
        const d2 = distSq(mob, pl.pos);
        if (d2 < nearSq) { nearSq = d2; near = pl; }
      }

      // Aggro target: zombies take a villager if one is closer than every
      // player; golems only ever hunt hostiles.
      let victim = null; // a Mob, when the target isn't a player
      let targetPos = near.pos;
      if (mob.def.huntsVillagers && villagers.length) {
        let bestSq = nearSq;
        for (const v of villagers) {
          const d2 = distSq(mob, v.pos);
          if (d2 < bestSq) { bestSq = d2; victim = v; }
        }
        if (victim) targetPos = victim.pos;
      } else if (mob.def.category === 'golem') {
        let bestSq = mob.def.detect * mob.def.detect;
        for (const h of hostiles) {
          const d2 = distSq(mob, h.pos);
          if (d2 < bestSq) { bestSq = d2; victim = h; }
        }
        targetPos = victim ? victim.pos : mob.pos; // no prey -> just wander
      }

      // Villagers panic when a monster gets close.
      let threat = null;
      if (mob.type === 'villager') {
        let bestSq = 81; // 9 blocks
        for (const h of hostiles) {
          const d2 = distSq(mob, h.pos);
          if (d2 < bestSq) { bestSq = d2; threat = h.pos; }
        }
      }

      mob.update(dt, {
        world: this.world,
        playerPos: targetPos,
        hasTarget: !!victim,
        threat,
        isNight: ctx.isNight,
        // fromPos (the mob) -> knockback direction for whoever got hit.
        attackPlayer: (dmg, fromPos) => {
          if (victim) { victim.takeDamage(dmg, fromPos || mob.pos); return; }
          if (mob.def.category === 'golem') return; // golems never hit players
          ctx.attackPlayer(
            dmg, near.id,
            fromPos ? { x: near.pos.x - fromPos.x, z: near.pos.z - fromPos.z } : null
          );
        },
        shoot: ctx.shoot,
        explode: ctx.explode,
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
