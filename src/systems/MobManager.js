import * as THREE from 'three';
import { Mob } from '../entities/Mob.js';
import { MOBS, PASSIVE, HOSTILE, CAVE_HOSTILE } from '../entities/mobTypes.js';
import { getBlockId, isSolid } from '../blocks/BlockRegistry.js';
import { villagesNear, villageLayout } from '../world/structures/VillagePlan.js';
import { Sound } from './Sound.js';

const GRASS = getBlockId('grass');
const PASSIVE_CAP = 10;
const HOSTILE_CAP = 14;
const VILLAGER_CAP = 4; // per village
// Cave hostiles have their own cap so they don't starve the surface hostile
// budget and vice-versa.  8 means a player caving in a moderate area will feel
// threatened but not overwhelmed.
const CAVE_HOSTILE_CAP = 8;
// Ambient cave bats: a small separate cap so they never eat the hostile budget.
const BAT_CAP = 4;
const DESPAWN = 70;
const SPAWN_MIN = 16;
const SPAWN_MAX = 34;

// Tamed-wolf combat assist: a wolf picks targets within ASSIST_RANGE of
// itself that recently (REVENGE_WINDOW seconds) hurt its owner or were hit by
// them, and drops the chase beyond ASSIST_LEASH from the owner.
const ASSIST_RANGE = 12;
const ASSIST_LEASH = 20;
const REVENGE_WINDOW = 8;

// Y below which we treat a position as "underground" for cave spawning.
// SEA_LEVEL (62) minus a few blocks so overhangs / shallow caves don't count.
const CAVE_MAX_Y = 58;

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
    this.caveSpawnTimer = 3; // offset from surface timer to avoid same-frame bursts
    this.villagerTimer = 3;
    // Ambient spawning + far-despawn. Zombies mode turns this off: its wave
    // director is the only spawner, and gate mobs must survive being far from
    // a team huddled at the opposite wall.
    this.autoSpawn = true;
  }

  count(category) {
    let n = 0;
    // Tamed pets never count against the wild spawn budget.
    for (const m of this.mobs) if (m.def.category === category && !m.owner) n++;
    return n;
  }

  // Cave hostiles are tagged on spawn so they're capped separately from the
  // surface night pool (neither starves the other).
  countCaveHostile() {
    let n = 0;
    for (const m of this.mobs) {
      if (m.def.category === 'hostile' && m._caveSpawned) n++;
    }
    return n;
  }

  _spawn(type, x, y, z) {
    const mob = new Mob(type, x, y, z);
    mob.world = this.world;
    this.scene.add(mob.group);
    this.mobs.push(mob);
    return mob;
  }

  // Recreate a saved tamed pet (world load): spawn it and restore tame state.
  // rec: { t, x, y, z, hp, owner, name, sitting }.
  spawnPet(rec) {
    if (!MOBS[rec.t] || !MOBS[rec.t].tamable) return null; // stale/corrupt save
    const mob = this._spawn(rec.t, rec.x, rec.y, rec.z);
    mob.health = rec.hp ?? mob.def.health;
    mob.owner = rec.owner ?? null;
    mob.ownerName = rec.name ?? null;
    mob.sitting = !!rec.sitting;
    mob.setTag(mob.ownerName ? `♥ ${mob.ownerName}` : '♥');
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

  // Cave-specific hostile spawning: picks cells underground near the player
  // that are dark (below CAVE_MAX_Y, below the surface height), have a solid
  // floor, and 2+ blocks of air headroom. Triggers regardless of time of day
  // so caving is always dangerous. Uses its own cap so cave mobs don't
  // suppress surface mobs and vice-versa.
  //
  // Sky-exposure check: we use world.surfaceHeight to know the solid-ground
  // height at a column. If the spawn candidate Y is below surfaceHeight - 4
  // (well below the first solid roof) we consider it sufficiently underground.
  // This matches the intuition used in the skylight mesher: sky-exposed = above
  // the first opaque roof.
  _trySpawnCave(playerPos) {
    const hostilesFull = this.countCaveHostile() >= CAVE_HOSTILE_CAP;
    const batsFull = this.count('ambient') >= BAT_CAP;
    if (hostilesFull && batsFull) return;

    // Pick a random horizontal position in a ring around the player, same
    // distance range as surface spawning so the player can't out-run them.
    const angle = Math.random() * Math.PI * 2;
    const dist  = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    const wx = Math.floor(playerPos.x + Math.cos(angle) * dist);
    const wz = Math.floor(playerPos.z + Math.sin(angle) * dist);

    // We scan downward from CAVE_MAX_Y looking for a valid floor (solid block
    // with 2 air blocks above it).  Stop at y=3 to stay off bedrock.
    const scanTop = Math.min(CAVE_MAX_Y, this.world.surfaceHeight(wx, wz) - 4);
    if (scanTop < 6) return; // column has no underground space

    // Randomise starting y within the underground band to spread spawns.
    const startY = 3 + Math.floor(Math.random() * Math.max(1, scanTop - 3));

    for (let y = startY; y >= 3; y--) {
      const floor  = this.world.getBlock(wx, y,     wz);
      const head1  = this.world.getBlock(wx, y + 1, wz);
      const head2  = this.world.getBlock(wx, y + 2, wz);
      if (!isSolid(floor))   continue; // need solid floor
      // Headroom must be genuinely empty — water/lava aren't solid, so a pool
      // floor would otherwise pass and spawn mobs submerged in cave lakes.
      if (head1 !== 0 || head2 !== 0) continue;

      // Mostly hostiles, the occasional bat for ambience (each capped
      // independently, so one pool being full routes spawns to the other).
      const wantBat = !batsFull && (hostilesFull || Math.random() < 0.2);
      const type = wantBat ? 'bat' : CAVE_HOSTILE[Math.floor(Math.random() * CAVE_HOSTILE.length)];
      const mob = this._spawn(type, wx + 0.5, y + 1, wz + 0.5);
      mob._caveSpawned = true; // tag so countCaveHostile() tracks them separately
      return; // one mob per call
    }
  }

  update(dt, ctx) {
    // Multiplayer host: target/spawn around every player in the room, not just
    // the local one. ctx.players is [{ id, pos }]; absent = single-player.
    const players = ctx.players && ctx.players.length
      ? ctx.players
      : [{ id: 'self', pos: ctx.playerPos }];

    if (this.autoSpawn) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 2;
        const anchor = players[Math.floor(Math.random() * players.length)];
        this._trySpawn({ ...ctx, playerPos: anchor.pos });
      }

      // Cave hostile spawning: runs on its own timer and cap, independent of the
      // surface hostile pool so daytime caving is always dangerous.
      this.caveSpawnTimer -= dt;
      if (this.caveSpawnTimer <= 0) {
        this.caveSpawnTimer = 3.5;
        const anchor = players[Math.floor(Math.random() * players.length)];
        this._trySpawnCave(anchor.pos);
      }

      this.villagerTimer -= dt;
      if (this.villagerTimer <= 0) {
        this.villagerTimer = 4;
        this._trySpawnVillagers(players);
      }
    }

    // Census for cross-mob behaviour: zombies hunt villagers, golems hunt
    // hostiles, villagers panic near monsters.
    const villagers = [];
    const hostiles = [];
    const cats = []; // creepers keep their distance from cats
    for (const m of this.mobs) {
      if (m.dead) continue;
      if (m.type === 'villager') villagers.push(m);
      else if (m.type === 'cat') cats.push(m);
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

      // Pets: resolve the owner's live position (null while they're offline).
      let ownerPos = null;
      if (mob.owner) {
        for (const pl of players) if (pl.id === mob.owner) { ownerPos = pl.pos; break; }
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
      } else if (mob.type === 'wolf' && mob.owner && !mob.sitting && ownerPos) {
        // Wolf assist: avenge the owner. Candidates are mobs only (never
        // players) and never anyone's pet. Attribution stamps use _selfPid()
        // (socket id online) while the host's pets are owned by 'self' —
        // canon() folds the two into one identity.
        const canon = (pid) => (pid === ctx.selfPid ? 'self' : pid);
        const owner = canon(mob.owner);
        const now = performance.now() / 1000;
        let bestSq = ASSIST_RANGE * ASSIST_RANGE;
        for (const c of this.mobs) {
          if (c === mob || c.dead || c.owner) continue;
          const hitByOwner = canon(c.lastHitBy) === owner && now - (c.lastHitAt ?? -Infinity) < REVENGE_WINDOW;
          const hurtOwner = canon(c._hurtPid) === owner && now - (c._hurtT ?? -Infinity) < REVENGE_WINDOW;
          if (!hitByOwner && !hurtOwner) continue;
          if (distSq(c, ownerPos) > ASSIST_LEASH * ASSIST_LEASH) continue;
          const d2 = distSq(mob, c.pos);
          if (d2 < bestSq) { bestSq = d2; victim = c; }
        }
        if (victim) targetPos = victim.pos;
      }

      // Cats spook creepers: one within 8 blocks defuses and routs it. The
      // short fleeTimer refreshes every tick while the cat stays close.
      if (mob.type === 'creeper') {
        for (const c of cats) {
          const d2 = distSq(mob, c.pos);
          if (d2 >= 64) continue;
          const d = Math.sqrt(d2) || 1;
          mob.fleeTimer = 0.3;
          mob.heading = { x: (mob.pos.x - c.pos.x) / d, z: (mob.pos.z - c.pos.z) / d };
          if (mob._fuse != null) {
            mob._fuse = null;
            mob.group.scale.setScalar(1);
          }
          break;
        }
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
        ownerPos,
        threat,
        isNight: ctx.isNight,
        // fromPos (the mob) -> knockback direction for whoever got hit.
        // power (optional) overrides the default shove strength (charger slam).
        attackPlayer: (dmg, fromPos, power = 0) => {
          if (victim) { victim.takeDamage(dmg, fromPos || mob.pos); return; }
          if (mob.owner) return; // pets never hit players
          if (mob.def.category === 'golem') return; // golems never hit players
          // Revenge mark: this mob hurt a player — their wolves come for it.
          mob._hurtPid = near.id;
          mob._hurtT = performance.now() / 1000;
          ctx.attackPlayer(
            dmg, near.id,
            fromPos ? { x: near.pos.x - fromPos.x, z: near.pos.z - fromPos.z } : null,
            power
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
      } else if (!mob.dead && (mob.owner
        ? mob.pos.y < -30 // pets never distance-despawn; only a void fall with the owner offline ends them
        : ((this.autoSpawn && nearSq > DESPAWN * DESPAWN) || mob.pos.y < -10))) {
        // Despawn only when far from *every* player (never in wave mode —
        // a gate mob across the arena is still part of the wave).
        mob.removed = true;
      }
    }

    // Remove dead/despawned mobs from the scene.
    if (this.mobs.some((m) => m.removed)) {
      for (const m of this.mobs) {
        if (m.removed) {
          m.clearTag(); // pet tag sprite holds a canvas texture
          this.scene.remove(m.group);
          m.group.traverse((o) => o.geometry && o.geometry.dispose());
        }
      }
      this.mobs = this.mobs.filter((m) => !m.removed);
    }
  }

  // Compact state for multiplayer broadcast (host -> guests, ~10 Hz).
  // Pet fields (owner/sitting/name) ride along only for tamed or orphaned
  // pets so wild-mob entries stay small.
  snapshot() {
    return this.mobs.map((m) => ({
      i: m.id, t: m.type,
      x: +m.pos.x.toFixed(2), y: +m.pos.y.toFixed(2), z: +m.pos.z.toFixed(2),
      yaw: +m.yaw.toFixed(2), h: m.health,
      ...(m.owner || m.ownerName ? { o: m.owner, s: m.sitting ? 1 : 0, n: m.ownerName || '' } : {}),
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
