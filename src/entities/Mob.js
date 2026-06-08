import * as THREE from 'three';
import { isSolid } from '../blocks/BlockRegistry.js';
import { MOBS } from './mobTypes.js';
import { buildMobModel } from './MobModels.js';

const GRAVITY = 26;
const JUMP = 7;

let nextId = 1;

// A single mob: blocky model + simple physics (gravity, per-axis AABB
// collision, auto-hop over 1-block steps) and lightweight AI. Passive mobs
// wander and flee when hurt; hostile mobs chase and melee the player at night.
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
    this.onGround = false;

    this.heading = null; // {x,z} unit, or null = idle
    this.wanderTimer = 0;
    this.fleeTimer = 0;
    this.attackCooldown = 0;
    this.burnTimer = 0;
    this.walkPhase = 0;
    this.dead = false;
    this.removed = false;
    this.hurtTimer = 0;     // red flash when damaged
    this.attackTimer = 0;   // lunge when attacking
    this._lungeDir = null;

    this.group = buildMobModel(type);
    this.legs = this.group.userData.legs || [];
    this.parts = this.group.children.slice(); // part meshes (for hurt tint)
    this.group.position.copy(this.pos);
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
      if (this.def.category === 'passive') {
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
    } else {
      const a = Math.random() * Math.PI * 2;
      this.heading = { x: Math.sin(a), z: Math.cos(a) };
    }
  }

  update(dt, ctx) {
    this.world = ctx.world;
    const player = ctx.playerPos;
    const def = this.def;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);

    let speed = def.speed;
    const dx = player.x - this.pos.x;
    const dy = player.y - this.pos.y; // vertical gap (feet to feet)
    const dz = player.z - this.pos.z;
    const distSq = dx * dx + dz * dz;

    if (this.fleeTimer > 0) {
      this.fleeTimer -= dt;
      speed *= 1.6;
    } else if (def.category === 'hostile' && distSq < def.detect * def.detect) {
      const d = Math.sqrt(distSq) || 1;

      if (def.ranged) {
        // Archer: keep mid-range and fire arrows.
        if (d < 5) this.heading = { x: -dx / d, z: -dz / d };       // too close, back off
        else if (d > 11) this.heading = { x: dx / d, z: dz / d };   // far, close in
        else this.heading = null;                                  // good range, hold
        this.yaw = Math.atan2(dx, dz);
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
            ctx.attackPlayer(def.attack);
            this.attackCooldown = 1;
            this.attackTimer = 0.25;          // visible lunge
            this._lungeDir = { x: dx / d, z: dz / d };
            this.yaw = Math.atan2(dx, dz);    // face the player
          }
        }
      }
    } else {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) this._pickWander();
    }

    // Daylight burning for undead.
    if (def.burns && !ctx.isNight) {
      this.burnTimer += dt;
      if (this.burnTimer >= 1) { this.takeDamage(1); this.burnTimer = 0; }
    }

    // Horizontal velocity from heading.
    if (this.heading) {
      this.vel.x = this.heading.x * speed;
      this.vel.z = this.heading.z * speed;
      this.yaw = Math.atan2(this.heading.x, this.heading.z);
    } else {
      this.vel.x *= 0.6;
      this.vel.z *= 0.6;
    }

    this.vel.y -= GRAVITY * dt;

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

    // Attack lunge: nudge the model toward the player and back.
    if (this.attackTimer > 0 && this._lungeDir) {
      this.attackTimer -= dt;
      const t = Math.sin(Math.max(0, this.attackTimer) / 0.25 * Math.PI) * 0.35;
      this.group.position.x += this._lungeDir.x * t;
      this.group.position.z += this._lungeDir.z * t;
    }

    const moving = Math.abs(this.vel.x) + Math.abs(this.vel.z) > 0.5;
    if (moving) {
      this.walkPhase += dt * 8;
      for (let i = 0; i < this.legs.length; i++) {
        this.legs[i].rotation.x = Math.sin(this.walkPhase + i * Math.PI) * 0.5;
      }
    } else {
      for (const l of this.legs) l.rotation.x *= 0.8;
    }
  }

  // AABB for ray/attack tests.
  aabb() {
    return {
      min: new THREE.Vector3(this.pos.x - this.hw, this.pos.y, this.pos.z - this.hw),
      max: new THREE.Vector3(this.pos.x + this.hw, this.pos.y + this.h, this.pos.z + this.hw),
    };
  }
}
