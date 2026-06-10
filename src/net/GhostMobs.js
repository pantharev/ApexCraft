import * as THREE from 'three';
import { MOBS } from '../entities/mobTypes.js';
import { buildMobModel } from '../entities/MobModels.js';
import { rayAABB } from '../systems/MobManager.js';

// Guest-side mirror of the host's mob simulation. The host broadcasts
// snapshots (~10 Hz); ghosts interpolate between them — no AI or physics here.
// Ghosts expose the same aabb()/takeDamage() surface the player attack and
// projectile code expect, so hitting one reports the hit back to the host.

const LERP = 10;

export class GhostMobs {
  constructor(scene, net) {
    this.scene = scene;
    this.net = net;
    this.mobs = []; // ghost objects (API-compatible with Mob where needed)
    this._byId = new Map();
  }

  apply(snap) {
    if (!Array.isArray(snap)) return;
    const seen = new Set();
    for (const s of snap) {
      seen.add(s.i);
      let g = this._byId.get(s.i);
      if (!g) {
        g = this._create(s);
        if (!g) continue;
      }
      // Red flash when the host reports a health drop.
      if (s.h < g.health) {
        g.hurtTimer = 0.25;
        this._tint(g, 0xff3030, 1);
      }
      g.health = s.h;
      g.target = { x: s.x, y: s.y, z: s.z, yaw: s.yaw };
    }
    // Remove ghosts the host no longer reports (dead/despawned).
    for (const g of this.mobs) if (!seen.has(g.id)) g.removed = true;
    if (this.mobs.some((g) => g.removed)) {
      for (const g of this.mobs) {
        if (g.removed) {
          this._byId.delete(g.id);
          this.scene.remove(g.group);
          g.group.traverse((o) => o.geometry && o.geometry.dispose());
        }
      }
      this.mobs = this.mobs.filter((g) => !g.removed);
    }
  }

  _create(s) {
    const def = MOBS[s.t];
    if (!def) return null;
    const group = buildMobModel(s.t);
    group.position.set(s.x, s.y, s.z);
    this.scene.add(group);
    const net = this.net;
    const g = {
      id: s.i,
      type: s.t,
      def,
      hw: def.hw,
      h: def.h,
      health: s.h,
      pos: new THREE.Vector3(s.x, s.y, s.z),
      yaw: s.yaw || 0,
      target: null,
      group,
      legs: group.userData.legs || [],
      parts: group.children.slice(),
      walkPhase: 0,
      hurtTimer: 0,
      removed: false,
      dead: false,
      aabb() {
        return {
          min: new THREE.Vector3(this.pos.x - this.hw, this.pos.y, this.pos.z - this.hw),
          max: new THREE.Vector3(this.pos.x + this.hw, this.pos.y + this.h, this.pos.z + this.hw),
        };
      },
      // Report the hit to the host, who owns the real simulation.
      takeDamage(dmg, fromPos) {
        net.sendMobHit({
          i: this.id, dmg,
          x: fromPos?.x ?? this.pos.x, y: fromPos?.y ?? this.pos.y, z: fromPos?.z ?? this.pos.z,
        });
      },
    };
    this.mobs.push(g);
    this._byId.set(s.i, g);
    return g;
  }

  _tint(g, hex, intensity) {
    for (const p of g.parts) {
      if (p.material && p.material.emissive) {
        p.material.emissive.setHex(hex);
        p.material.emissiveIntensity = intensity;
      }
    }
  }

  _untint(g) {
    for (const p of g.parts) {
      const m = p.material;
      if (m && m.emissive) {
        m.emissive.setHex(m.userData.baseEmissive ?? 0x000000);
        m.emissiveIntensity = 0.32;
      }
    }
  }

  update(dt) {
    const k = Math.min(1, dt * LERP);
    for (const g of this.mobs) {
      if (g.target) {
        const dx = g.target.x - g.pos.x, dz = g.target.z - g.pos.z;
        g.pos.x += dx * k;
        g.pos.y += (g.target.y - g.pos.y) * k;
        g.pos.z += dz * k;
        let dyaw = (g.target.yaw || 0) - g.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        g.yaw += dyaw * k;

        g.group.position.copy(g.pos);
        g.group.rotation.y = g.yaw;

        const speed = Math.hypot(dx, dz) / Math.max(dt, 1e-4) * k;
        if (speed > 0.4) {
          g.walkPhase += dt * 8;
          for (let i = 0; i < g.legs.length; i++) {
            g.legs[i].rotation.x = Math.sin(g.walkPhase + i * Math.PI) * 0.5;
          }
        } else {
          for (const l of g.legs) l.rotation.x *= 0.8;
        }
      }
      if (g.hurtTimer > 0) {
        g.hurtTimer -= dt;
        if (g.hurtTimer <= 0) this._untint(g);
      }
    }
  }

  // Same slab raycast the real MobManager provides, so attacks work on guests.
  raycast(origin, dir, reach) {
    let best = null;
    let bestT = reach;
    for (const g of this.mobs) {
      const { min, max } = g.aabb();
      const t = rayAABB(origin, dir, min, max);
      if (t !== null && t >= 0 && t <= bestT) { bestT = t; best = g; }
    }
    return best;
  }

  clear() {
    for (const g of this.mobs) {
      this.scene.remove(g.group);
      g.group.traverse((o) => o.geometry && o.geometry.dispose());
    }
    this.mobs = [];
    this._byId.clear();
  }
}
