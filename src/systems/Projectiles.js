import * as THREE from 'three';
import { isSolid } from '../blocks/BlockRegistry.js';
import { Sound } from './Sound.js';

const GRAVITY = 12;
const LIFE = 6; // seconds before despawn

// Generic flying projectiles (arrows for now; reused later for bullets/spells).
// Each has gravity, terrain collision, and target collision — 'player' arrows
// (from mobs) hit the player; 'mob' arrows (from the player) hit mobs.
export class Projectiles {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.list = [];
    this.geo = new THREE.BoxGeometry(0.07, 0.07, 0.55);
    this.mat = new THREE.MeshLambertMaterial({ color: '#5a4327', emissive: '#2a1f12', emissiveIntensity: 0.3 });
    // Special ammo gets a tinted shaft so everyone can read what's flying.
    this.mats = {
      arrow_explosive: new THREE.MeshLambertMaterial({ color: '#c84a1e', emissive: '#5a1f08', emissiveIntensity: 0.5 }),
      arrow_venom: new THREE.MeshLambertMaterial({ color: '#4ab42a', emissive: '#1f4a10', emissiveIntensity: 0.5 }),
      bullet: new THREE.MeshLambertMaterial({ color: '#c8a24a', emissive: '#7a5a18', emissiveIntensity: 0.9 }),
      ray: new THREE.MeshLambertMaterial({ color: '#5aff6a', emissive: '#2ad83a', emissiveIntensity: 1.0 }),
      acid: new THREE.MeshLambertMaterial({ color: '#8fd42a', emissive: '#3f6a10', emissiveIntensity: 0.8 }),
      rock: new THREE.MeshLambertMaterial({ color: '#7a7a72', emissive: '#2a2a26', emissiveIntensity: 0.3 }),
    };
    this.scales = { bullet: 0.5, ray: 1.5, acid: 1.4, rock: 2.0 }; // per-kind mesh size tweak
    this._fwd = new THREE.Vector3(0, 0, 1);
  }

  // dir: THREE.Vector3 (any length); target: 'player' | 'mob' | 'none'.
  // opts: { kind, owner, onHit } — kind tints the mesh; owner stamps
  // mob.lastHitBy for kill attribution; onHit(pos, mobOrNull) fires on impact
  // (terrain or mob) for special-ammo effects.
  spawn(x, y, z, dir, speed, damage, target, opts = {}) {
    const v = dir.clone().normalize();
    const mesh = new THREE.Mesh(this.geo, this.mats[opts.kind] || this.mat);
    mesh.position.set(x, y, z);
    mesh.quaternion.setFromUnitVectors(this._fwd, v);
    if (this.scales[opts.kind]) mesh.scale.setScalar(this.scales[opts.kind]);
    this.scene.add(mesh);
    this.list.push({
      pos: new THREE.Vector3(x, y, z), vel: v.multiplyScalar(speed), damage, target, life: 0, mesh,
      owner: opts.owner ?? null, onHit: opts.onHit ?? null,
    });
  }

  _remove(i) {
    this.scene.remove(this.list[i].mesh);
    this.list.splice(i, 1);
  }

  update(dt, ctx) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life += dt;
      p.vel.y -= GRAVITY * dt;
      const next = p.pos.clone().addScaledVector(p.vel, dt);
      let hit = false;

      if (isSolid(this.world.getBlock(Math.floor(next.x), Math.floor(next.y), Math.floor(next.z)))) {
        hit = true;
        Sound.arrowHit();
        if (p.onHit) p.onHit(next, null);
      }

      if (!hit && p.target === 'player' && ctx.playerPos) {
        const pp = ctx.playerPos;
        if (next.x > pp.x - 0.45 && next.x < pp.x + 0.45 &&
            next.y > pp.y && next.y < pp.y + 1.85 &&
            next.z > pp.z - 0.45 && next.z < pp.z + 0.45) {
          ctx.hitPlayer(p.damage, p.vel); // velocity -> knockback direction
          hit = true;
        }
      }

      if (!hit && p.target === 'mob' && ctx.mobs) {
        for (const m of ctx.mobs.mobs) {
          if (m.dead) continue; // corpses don't stop arrows
          const { min, max } = m.aabb();
          if (next.x > min.x && next.x < max.x && next.y > min.y && next.y < max.y && next.z > min.z && next.z < max.z) {
            if (p.owner != null) { // kill attribution + pet revenge marks
              m.lastHitBy = p.owner;
              m.lastHitAt = performance.now() / 1000;
            }
            m.takeDamage(p.damage, next);
            Sound.mobHurt();
            hit = true;
            if (p.onHit) p.onHit(next, m);
            break;
          }
        }
      }

      if (hit || p.life > LIFE || next.y < -5) { this._remove(i); continue; }
      p.pos.copy(next);
      p.mesh.position.copy(next);
    }
  }
}
