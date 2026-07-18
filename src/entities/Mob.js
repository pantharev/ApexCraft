import * as THREE from 'three';
import { isSolid } from '../blocks/BlockRegistry.js';
import { WORLD_HEIGHT } from '../config.js';
import { MOBS } from './mobTypes.js';
import { buildMobModel } from './MobModels.js';
import { Sound } from '../systems/Sound.js';
import { nameTag } from '../net/RemotePlayers.js';

const GRAVITY = 26;
const JUMP = 7;
const TURN_SPEED = 9;     // body yaw easing (rad-ish/s factor)
const HEAD_SPEED = 7;     // head look easing
const DEATH_TIME = 0.6;   // tip-over + fade duration

// Tamed-pet tuning (wolves/cats — see mobTypes `tamable`).
const FOLLOW_START = 4;    // start walking toward the owner beyond this
const FOLLOW_STOP = 2.5;   // stop this close (hysteresis band avoids jitter)
const FOLLOW_RUN = 10;     // beyond this, sprint
const TELEPORT_DIST = 20;  // beyond this (or falling into the void), pop to the owner

let nextId = 1;

const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

// A single mob: blocky model + simple physics (gravity, per-axis AABB
// collision, auto-hop over 1-block steps) and lightweight AI. Passive mobs
// wander/graze and flee when hurt; hostile mobs hunt the player. Bodies turn
// smoothly, heads track their target, and death plays a short tip-over.
export class Mob {
  constructor(type, x, y, z) {
    this.id = nextId++;
    this.type = type;
    this.def = MOBS[type];
    this.health = this.def.health;
    this.hw = this.def.hw;
    this.h = this.def.h;

    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.targetYaw = 0;   // body eases toward this
    this.onGround = false;

    this.heading = null; // {x,z} unit, or null = idle
    this.wanderTimer = 0;
    this.fleeTimer = 0;
    this.attackCooldown = 0;
    this.burnTimer = 0;
    this.walkPhase = 0;
    this.dead = false;
    this.deathT = 0;        // death animation clock
    this.deathHandled = false; // MobManager: loot + sound fired
    this.removed = false;
    this.hurtTimer = 0;     // red flash when damaged
    this.attackTimer = 0;   // lunge when attacking
    this._lungeDir = null;
    this._deathSpin = Math.random() < 0.5 ? 1 : -1;

    this.grazeTimer = 0;    // passive: head-down grazing
    this.lookAt = null;     // world point the head tracks (or null)
    this.anchor = null;     // {x, z} home point (villagers leash to their village)
    this.home = null;       // {x, z} house to run to at night (villagers)

    this.owner = null;      // pet owner pid: 'self' (host/SP) or guest socket id; null = wild
    this.ownerName = null;  // owner display name; kept through disconnects for rebinding
    this.sitting = false;   // sit/stay toggle (pets)
    this.tag = null;        // floating owner-tag sprite (pets)
    this._following = false; // follow hysteresis state

    this.group = buildMobModel(type);
    this.legs = this.group.userData.legs || [];
    this.head = this.group.userData.head || null;
    // Collect every mesh (including head sub-parts) for tint/fade effects.
    this.parts = [];
    this.group.traverse((o) => { if (o.isMesh) this.parts.push(o); });
    this.group.position.copy(this.pos);
  }

  // Floating owner tag over a tamed pet ("♥ Wolf" / "♥ Nico").
  setTag(text) {
    this.clearTag();
    this.tag = nameTag(text, { y: this.h + 0.45, scale: 0.7 });
    this.group.add(this.tag);
  }

  clearTag() {
    if (!this.tag) return;
    this.group.remove(this.tag);
    this.tag.material.map.dispose();
    this.tag.material.dispose();
    this.tag = null;
  }

  _flashRed() {
    for (const p of this.parts) {
      if (p.material && p.material.emissive) {
        p.material.emissive.setHex(0xff3030);
        p.material.emissiveIntensity = 1;
      }
    }
  }

  _clearFlash() {
    for (const p of this.parts) {
      const m = p.material;
      if (m && m.emissive) {
        m.emissive.setHex(m.userData.baseEmissive ?? 0x000000);
        m.emissiveIntensity = 0.32;
      }
    }
  }

  _collides(p) {
    const minX = Math.floor(p.x - this.hw), maxX = Math.floor(p.x + this.hw);
    const minY = Math.floor(p.y), maxY = Math.floor(p.y + this.h);
    const minZ = Math.floor(p.z - this.hw), maxZ = Math.floor(p.z + this.hw);
    for (let x = minX; x <= maxX; x++)
      for (let y = minY; y <= maxY; y++)
        for (let z = minZ; z <= maxZ; z++)
          if (isSolid(this.world.getBlock(x, y, z))) return true;
    return false;
  }

  _moveAxis(axis, amount) {
    const next = this.pos.clone();
    next[axis] += amount;
    if (!this._collides(next)) { this.pos[axis] = next[axis]; return false; }
    return true;
  }

  takeDamage(n, fromPos) {
    if (this.dead) return;
    this.health -= n;
    this.hurtTimer = 0.25;
    this._flashRed();
    if (fromPos) {
      // Knockback away from the attacker.
      const dx = this.pos.x - fromPos.x, dz = this.pos.z - fromPos.z;
      const len = Math.hypot(dx, dz) || 1;
      this.vel.x += (dx / len) * 5;
      this.vel.z += (dz / len) * 5;
      this.vel.y = 5;
      if (this.def.category !== 'hostile' && !this.owner) {
        // Tamed pets never flee — least of all from their owner's misclick.
        this.fleeTimer = 5;
        this.heading = { x: dx / len, z: dz / len };
      }
    }
    if (this.health <= 0) this.dead = true;
  }

  _pickWander() {
    this.wanderTimer = 2 + Math.random() * 4;
    if (Math.random() < 0.35) {
      this.heading = null; // idle
      // Idle passive mobs often dip their head to graze.
      if (this.def.category === 'passive' && Math.random() < 0.55) {
        this.grazeTimer = 1.2 + Math.random() * 1.6;
      }
    } else {
      const a = Math.random() * Math.PI * 2;
      this.heading = { x: Math.sin(a), z: Math.cos(a) };
    }
  }

  // Tamed-pet AI: sit, fight the victim the manager picked (wolves), or
  // follow the owner. Returns the movement speed to use.
  _petAI(dt, ctx, speed) {
    const owner = ctx.ownerPos; // null = owner offline: wait in place
    if (this.sitting) {
      this.heading = null;
      if (owner) {
        const dx = owner.x - this.pos.x, dz = owner.z - this.pos.z;
        if (dx * dx + dz * dz < 64) this.lookAt = owner;
      }
      return speed;
    }
    if (ctx.hasTarget) {
      // Combat assist: ctx.playerPos is the mob the manager chose to avenge
      // the owner against. Same shape as the hostile melee branch.
      const v = ctx.playerPos;
      const dx = v.x - this.pos.x, dy = v.y - this.pos.y, dz = v.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      this.lookAt = v;
      this.heading = { x: dx / d, z: dz / d };
      if (d < this.hw + 1.0 && Math.abs(dy) < 1.6) {
        this.heading = null;
        if (this.attackCooldown === 0 && ctx.attackPlayer) {
          ctx.attackPlayer(this.def.attack || 2, this.pos);
          this.attackCooldown = 1;
          this.attackTimer = 0.25;
          this._lungeDir = { x: dx / d, z: dz / d };
          this.targetYaw = Math.atan2(dx, dz);
        }
      }
      return speed * 1.4;
    }
    if (!owner) { this.heading = null; return speed; }
    const dx = owner.x - this.pos.x, dz = owner.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > TELEPORT_DIST || this.pos.y < -10) {
      this._teleportTo(owner);
      return speed;
    }
    // Hysteresis: start following past FOLLOW_START, keep going until
    // FOLLOW_STOP, so the pet doesn't stutter at the boundary.
    if (this._following ? d > FOLLOW_STOP : d > FOLLOW_START) {
      this._following = true;
      this.heading = { x: dx / d, z: dz / d };
      return speed * (d > FOLLOW_RUN ? 1.6 : 1.25);
    }
    this._following = false;
    this.heading = null;
    this.lookAt = owner;
    return speed;
  }

  // Pop to the owner's side: a nearby cell with a solid floor and two air
  // blocks of headroom, else the owner's exact position.
  _teleportTo(owner) {
    const ox = Math.floor(owner.x), oy = Math.floor(owner.y), oz = Math.floor(owner.z);
    for (let r = 1; r <= 2; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // ring cells only
          for (let dy = 1; dy >= -1; dy--) {
            const y = oy + dy;
            if (!isSolid(this.world.getBlock(ox + dx, y - 1, oz + dz))) continue;
            if (isSolid(this.world.getBlock(ox + dx, y, oz + dz))) continue;
            if (isSolid(this.world.getBlock(ox + dx, y + 1, oz + dz))) continue;
            this.pos.set(ox + dx + 0.5, y, oz + dz + 0.5);
            this.vel.set(0, 0, 0);
            return;
          }
        }
      }
    }
    this.pos.set(owner.x, owner.y, owner.z);
    this.vel.set(0, 0, 0);
  }

  // Death: slump sideways, sink a little, fade out. Physics/AI stop.
  _updateDeath(dt) {
    this.deathT += dt;
    const k = Math.min(1, this.deathT / DEATH_TIME);
    const ease = k * k * (3 - 2 * k);
    this.group.rotation.z = this._deathSpin * ease * (Math.PI / 2);
    this.group.position.set(this.pos.x, this.pos.y + 0.15 - ease * 0.3, this.pos.z);
    for (const p of this.parts) {
      if (p.material) {
        p.material.transparent = true;
        p.material.opacity = 1 - ease;
        p.material.depthWrite = false;
      }
    }
    if (this.deathT >= DEATH_TIME) this.removed = true;
  }

  update(dt, ctx) {
    this.world = ctx.world;
    if (this.dead) { this._updateDeath(dt); return; }

    const player = ctx.playerPos;
    const def = this.def;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    let speed = def.speed;
    const dx = player.x - this.pos.x;
    const dy = player.y - this.pos.y; // vertical gap (feet to feet)
    const dz = player.z - this.pos.z;
    const distSq = dx * dx + dz * dz;

    this.lookAt = null;

    if (this.fleeTimer > 0) {
      this.fleeTimer -= dt;
      speed *= 1.6;
    } else if (this.owner) {
      // Tamed pets: sit / avenge the owner / follow — never wander off.
      speed = this._petAI(dt, ctx, speed);
    } else if (
      (def.category === 'hostile' || (def.category === 'golem' && ctx.hasTarget)) &&
      distSq < def.detect * def.detect
    ) {
      const d = Math.sqrt(distSq) || 1;
      this.lookAt = player; // hunters keep eye contact

      if (def.exploder) {
        // Creeper: close in, then stand still, hiss, swell... and detonate.
        if (d < 2.8) {
          this.heading = null;
          this.targetYaw = Math.atan2(dx, dz);
          if (this._fuse == null) { this._fuse = 1.3; Sound.fuse(); }
        } else if (this._fuse != null && d > 5) {
          this._fuse = null; // target escaped — stand down
          this.group.scale.setScalar(1);
        } else {
          this.heading = { x: dx / d, z: dz / d };
        }
        if (this._fuse != null) {
          this._fuse -= dt;
          this.group.scale.setScalar(1 + Math.max(0, 1.3 - this._fuse) * 0.22);
          if (this._fuse <= 0 && ctx.explode) {
            ctx.explode(this);
            this.dead = true;
            this.deathHandled = true; // no loot from self-detonation
            this.removed = true;
            return;
          }
        }
      } else if (def.ranged) {
        // Archer: keep mid-range and fire arrows.
        if (d < 5) this.heading = { x: -dx / d, z: -dz / d };       // too close, back off
        else if (d > 11) this.heading = { x: dx / d, z: dz / d };   // far, close in
        else this.heading = null;                                  // good range, hold
        this.targetYaw = Math.atan2(dx, dz);
        if (this.attackCooldown === 0 && ctx.shoot) {
          const sx = this.pos.x, sy = this.pos.y + 1.4, sz = this.pos.z;
          let ax = player.x - sx, ay = (player.y + 1.0) - sy, az = player.z - sz;
          const al = Math.hypot(ax, ay, az) || 1;
          ctx.shoot(sx, sy, sz, ax / al, ay / al, az / al, def.attack);
          this.attackCooldown = 2;
        }
      } else {
        // Melee: chase, attack when within reach (and vertically close so a mob
        // on the ground can't hit a player perched on a pillar above).
        this.heading = { x: dx / d, z: dz / d };
        if (d < this.hw + 1.0 && Math.abs(dy) < 1.6) {
          this.heading = null;
          if (this.attackCooldown === 0 && ctx.attackPlayer) {
            ctx.attackPlayer(def.attack, this.pos); // pos -> knockback direction
            this.attackCooldown = 1;
            this.attackTimer = 0.25;          // visible lunge
            this._lungeDir = { x: dx / d, z: dz / d };
            this.targetYaw = Math.atan2(dx, dz); // face the player
          }
        }
      }
    } else {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) this._pickWander();
      // Out of range: a wound-up creeper stands down.
      if (this._fuse != null) {
        this._fuse = null;
        this.group.scale.setScalar(1);
      }
      // A villager who sees a monster runs for it (overrides everything).
      if (def.category === 'villager' && ctx.threat) {
        const tx = this.pos.x - ctx.threat.x, tz = this.pos.z - ctx.threat.z;
        const td = Math.hypot(tx, tz) || 1;
        this.heading = { x: tx / td, z: tz / td };
        speed *= 1.7;
        this.wanderTimer = 0.5;
        this.grazeTimer = 0;
      }
      // Leashed mobs (villagers) head home when they stray too far.
      if (this.anchor) {
        const ax = this.anchor.x - this.pos.x, az = this.anchor.z - this.pos.z;
        const ad = Math.hypot(ax, az);
        if (ad > 20) {
          this.heading = { x: ax / ad, z: az / ad };
          this.wanderTimer = 2;
        }
      }
      // Night: villagers hurry to their house and wait out the dark inside
      // (unless actively fleeing a monster — survival first).
      if (def.category === 'villager' && this.home && ctx.isNight && !ctx.threat) {
        const hx = this.home.x - this.pos.x, hz = this.home.z - this.pos.z;
        const hd = Math.hypot(hx, hz);
        if (hd > 1.4) {
          this.heading = { x: hx / hd, z: hz / hd };
          speed *= 1.5; // run!
          this.wanderTimer = 1;
        } else {
          this.heading = null;
          this.wanderTimer = 1.5;
        }
      }
      // Non-hostile mobs glance at a nearby player out of curiosity.
      if (def.category !== 'hostile' && distSq < 25 && this.grazeTimer <= 0) {
        this.lookAt = player;
      }
    }

    // Daylight burning for undead — but only under open sky. Cave-spawned
    // zombies/skeletons live under a rock roof and must not cook off
    // underground in the middle of the day (half the cave pool would die in
    // ~20 s and churn the spawn cap).
    if (def.burns && !ctx.isNight) {
      this.burnTimer += dt;
      if (this.burnTimer >= 1) {
        this.burnTimer = 0;
        if (this._skyExposed()) this.takeDamage(1);
      }
    }

    // Horizontal velocity from heading.
    if (this.heading) {
      this.vel.x = this.heading.x * speed;
      this.vel.z = this.heading.z * speed;
      this.targetYaw = Math.atan2(this.heading.x, this.heading.z);
      this.grazeTimer = 0; // moving cancels grazing
    } else {
      this.vel.x *= 0.6;
      this.vel.z *= 0.6;
    }

    // Body turns smoothly toward where it wants to face.
    this.yaw += wrapAngle(this.targetYaw - this.yaw) * Math.min(1, dt * TURN_SPEED);

    if (def.flies) {
      // Flying mobs (bats): no gravity. A sinusoidal flap bobs them through
      // the air — climbing gently while moving, sinking slowly when idle so
      // they drift down toward a roost instead of pinning to the ceiling.
      this._flapT = (this._flapT || 0) + dt;
      const targetVy = Math.sin(this._flapT * 3.2) * 1.4 + (this.heading ? 0.5 : -0.8);
      this.vel.y += (targetVy - this.vel.y) * Math.min(1, dt * 6);
    } else {
      this.vel.y -= GRAVITY * dt;
    }

    const blockedX = this._moveAxis('x', this.vel.x * dt);
    const blockedZ = this._moveAxis('z', this.vel.z * dt);
    const blockedY = this._moveAxis('y', this.vel.y * dt);
    if (blockedY) {
      if (this.vel.y < 0) this.onGround = true;
      this.vel.y = 0;
    } else {
      this.onGround = false;
    }
    // Wall handling while moving: spiders climb, everyone else auto-hops a step.
    if ((blockedX || blockedZ) && this.heading) {
      if (def.climbs) {
        this.vel.y = 4; // scale the wall
        this.onGround = false;
      } else if (this.onGround) {
        this.vel.y = JUMP;
        this.onGround = false;
      }
    }

    // Hurt flash: clear the red tint when it expires.
    if (this.hurtTimer > 0) {
      this.hurtTimer -= dt;
      if (this.hurtTimer <= 0) this._clearFlash();
    }

    // Sync model + walk animation.
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;

    // Head look: track the target, graze, or settle back to neutral.
    if (this.head) {
      let hy = 0, hp = 0;
      if (this.lookAt) {
        const ldx = this.lookAt.x - this.pos.x, ldz = this.lookAt.z - this.pos.z;
        hy = wrapAngle(Math.atan2(ldx, ldz) - this.yaw);
        hy = Math.max(-1.0, Math.min(1.0, hy));
        const eyeY = this.pos.y + this.head.position.y;
        const ldy = (this.lookAt.y + 1.5) - eyeY;
        hp = -Math.max(-0.5, Math.min(0.5, Math.atan2(ldy, Math.hypot(ldx, ldz) || 1)));
      } else if (this.grazeTimer > 0) {
        this.grazeTimer -= dt;
        hp = 0.65; // muzzle to the grass
      }
      const k = Math.min(1, dt * HEAD_SPEED);
      this.head.rotation.y += (hy - this.head.rotation.y) * k;
      this.head.rotation.x += (hp - this.head.rotation.x) * k;
    }

    // Attack lunge: nudge the model toward the player and back.
    if (this.attackTimer > 0 && this._lungeDir) {
      this.attackTimer -= dt;
      const t = Math.sin(Math.max(0, this.attackTimer) / 0.25 * Math.PI) * 0.35;
      this.group.position.x += this._lungeDir.x * t;
      this.group.position.z += this._lungeDir.z * t;
    }

    const moving = Math.abs(this.vel.x) + Math.abs(this.vel.z) > 0.5;
    if (this.sitting && this.owner && !moving) {
      // Sitting pose: legs folded under the body, haunches dropped.
      for (let i = 0; i < this.legs.length; i++) {
        const target = i < 2 ? 1.3 : -1.3;
        this.legs[i].rotation.x += (target - this.legs[i].rotation.x) * Math.min(1, dt * 8);
      }
      this.group.position.y -= 0.12;
    } else if (moving) {
      this.walkPhase += dt * 8;
      for (let i = 0; i < this.legs.length; i++) {
        this.legs[i].rotation.x = Math.sin(this.walkPhase + i * Math.PI) * 0.5;
      }
    } else {
      for (const l of this.legs) l.rotation.x *= 0.8;
    }
  }

  // True when no solid block roofs this mob's column — the same top-down
  // notion the skylight mesher uses for daylight. Runs at most once per
  // second per burning mob, so the column scan is cheap.
  _skyExposed() {
    if (!this.world) return true;
    const x = Math.floor(this.pos.x), z = Math.floor(this.pos.z);
    for (let y = Math.ceil(this.pos.y + this.h); y < WORLD_HEIGHT; y++) {
      if (isSolid(this.world.getBlock(x, y, z))) return false;
    }
    return true;
  }

  // AABB for ray/attack tests.
  aabb() {
    return {
      min: new THREE.Vector3(this.pos.x - this.hw, this.pos.y, this.pos.z - this.hw),
      max: new THREE.Vector3(this.pos.x + this.hw, this.pos.y + this.h, this.pos.z + this.hw),
    };
  }
}
