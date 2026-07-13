import * as THREE from 'three';

// Lingering damage pools (venom arrows, spitter acid): a translucent disc
// that ticks damage on mobs standing inside it. Every client renders the
// visuals; only the mob simulation owner (host / single-player) applies mob
// damage — pass mobs=null on guests. Player-arrow pools never hurt players
// (no friendly fire); `hurtPlayer` pools (spitter acid) also tick the LOCAL
// player on every client — each client damages itself, the same trust model
// as guest-simulated mob arrows.
//
// Sync model matches projectiles: a one-shot 'zone' net event spawns the pool
// on every client, then each client runs its own copy locally.

const TICK = 0.5;    // damage cadence, like lava in Vitals
const FADE = 1.2;    // seconds of fade-out before expiry
const REACH_Y = 2;   // vertical slab the pool affects

export class DamageZones {
  constructor(scene, particles) {
    this.scene = scene;
    this.particles = particles;
    this.list = [];
    this.geo = new THREE.CylinderGeometry(1, 1, 0.1, 20);
  }

  spawn(x, y, z, r, dps, ttl, owner = null, hurtPlayer = false) {
    const mat = new THREE.MeshBasicMaterial({
      // Acid pools read hotter than venom so players know to move.
      color: hurtPlayer ? '#a8c832' : '#46c832', transparent: true, opacity: 0.35, depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.scale.set(r, 1, r);
    mesh.position.set(x, y + 0.08, z);
    this.scene.add(mesh);
    this.list.push({ x, y, z, r, dps, ttl, life: ttl, owner, hurtPlayer, tick: 0, drip: 0, mesh, mat });
  }

  // mobs: the MobManager (authority) or null (guests — visuals only).
  // playerCtx: { pos, dead, damage(n) } for the local player (acid pools).
  update(dt, mobs, playerCtx = null) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const zn = this.list[i];
      zn.life -= dt;
      if (zn.life <= 0) { this._remove(i); continue; }
      zn.mat.opacity = 0.35 * Math.min(1, zn.life / FADE);

      // A lazy bubble of venom particles so the pool reads at a glance.
      zn.drip -= dt;
      if (zn.drip <= 0) {
        zn.drip = 0.6;
        const a = Math.random() * Math.PI * 2, rr = Math.random() * zn.r * 0.8;
        this.particles.burst(zn.x + Math.cos(a) * rr, zn.y + 0.3, zn.z + Math.sin(a) * rr, [0.3, 0.8, 0.2], 4, 1.1);
      }

      zn.tick += dt;
      if (zn.tick >= TICK) {
        zn.tick -= TICK;
        if (mobs) {
          for (const m of mobs.mobs) {
            if (m.dead) continue;
            const dx = m.pos.x - zn.x, dz = m.pos.z - zn.z;
            if (dx * dx + dz * dz > zn.r * zn.r) continue;
            if (m.pos.y < zn.y - 1 || m.pos.y > zn.y + REACH_Y) continue;
            if (zn.owner != null) m.lastHitBy = zn.owner; // kill attribution
            m.takeDamage(zn.dps * TICK, null); // no knockback: pools hold, arrows shove
          }
        }
        if (zn.hurtPlayer && playerCtx && !playerCtx.dead) {
          const px = playerCtx.pos.x - zn.x, pz = playerCtx.pos.z - zn.z;
          if (px * px + pz * pz <= zn.r * zn.r &&
              playerCtx.pos.y >= zn.y - 1 && playerCtx.pos.y <= zn.y + REACH_Y) {
            playerCtx.damage(zn.dps * TICK);
          }
        }
      }
    }
  }

  _remove(i) {
    const zn = this.list[i];
    this.scene.remove(zn.mesh);
    zn.mat.dispose();
    this.list.splice(i, 1);
  }

  dispose() {
    while (this.list.length) this._remove(this.list.length - 1);
    this.geo.dispose();
  }
}
