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
    this._fwd = new THREE.Vector3(0, 0, 1);
  }

  // dir: THREE.Vector3 (any length); target: 'player' | 'mob'.
  spawn(x, y, z, dir, speed, damage, target) {
    const v = dir.clone().normalize();
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.position.set(x, y, z);
    mesh.quaternion.setFromUnitVectors(this._fwd, v);
    this.scene.add(mesh);
    this.list.push({ pos: new THREE.Vector3(x, y, z), vel: v.multiplyScalar(speed), damage, target, life: 0, mesh });
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
      }

      if (!hit && p.target === 'player' && ctx.playerPos) {
        const pp = ctx.playerPos;
        if (next.x > pp.x - 0.45 && next.x < pp.x + 0.45 &&
            next.y > pp.y && next.y < pp.y + 1.85 &&
            next.z > pp.z - 0.45 && next.z < pp.z + 0.45) {
          ctx.hitPlayer(p.damage);
          hit = true;
        }
      }

      if (!hit && p.target === 'mob' && ctx.mobs) {
        for (const m of ctx.mobs.mobs) {
          const { min, max } = m.aabb();
          if (next.x > min.x && next.x < max.x && next.y > min.y && next.y < max.y && next.z > min.z && next.z < max.z) {
            m.takeDamage(p.damage, next);
            Sound.mobHurt();
            hit = true;
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
