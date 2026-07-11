import * as THREE from 'three';
import { getBlockId, isSolid } from '../blocks/BlockRegistry.js';
import { buildBlockCube } from '../items/ItemModels.js';
import { Sound } from './Sound.js';

const TNT = getBlockId('tnt');
const MEGA_TNT = getBlockId('mega_tnt');
const WATER = getBlockId('water');
const BEDROCK = getBlockId('bedrock');

const TNT_RADIUS = 3.4;
// Mega TNT (a mini-nuke for carving mountains): far bigger blast + a longer
// fuse so there's time to run. ~18× the volume of a regular charge.
export const MEGA_TNT_RADIUS = 9;

// Explosions: primed TNT entities (flashing, falling, fused) and the blast
// itself — a roughened sphere of block removal, a fireball of particles, and
// distance-falloff damage with knockback for the player and mobs.
//
// Multiplayer: the client that owns the explosion applies block edits (which
// sync through the normal edit channel) and broadcasts a 'boom'; receivers
// re-run the blast with applyEdits=false for the visuals and their own damage.
export class Explosions {
  constructor(world, scene, particles) {
    this.world = world;
    this.scene = scene;
    this.particles = particles;
    this.primed = [];
  }

  // Light a TNT at block coords (the block itself is removed by the caller).
  // `radius` sets the blast size and `block` the falling visual, so the same
  // path drives both regular TNT and the much larger mega TNT.
  prime(x, y, z, fuse = 1.8, radius = TNT_RADIUS, block = 'tnt') {
    const group = new THREE.Group();
    group.add(buildBlockCube(block, 0.96));
    const flash = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 1.0, 1.0),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false })
    );
    flash.visible = false;
    group.add(flash);
    group.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.scene.add(group);
    this.primed.push({ pos: group.position, vy: 0, fuse, radius, group, flash });
    Sound.fuse();
  }

  update(dt, ctx) {
    for (let i = this.primed.length - 1; i >= 0; i--) {
      const p = this.primed[i];
      p.fuse -= dt;

      // Fall until resting on solid ground.
      p.vy -= 18 * dt;
      const ny = p.pos.y + p.vy * dt;
      if (isSolid(this.world.getBlock(Math.floor(p.pos.x), Math.floor(ny - 0.5), Math.floor(p.pos.z)))) {
        p.vy = 0;
      } else {
        p.pos.y = ny;
      }

      // White blink, quickening near zero.
      p.flash.visible = Math.floor(p.fuse * (p.fuse < 0.6 ? 14 : 7)) % 2 === 0;

      if (p.fuse <= 0) {
        this.scene.remove(p.group);
        p.group.traverse((o) => o.geometry && o.geometry.dispose());
        this.primed.splice(i, 1);
        this.boom(p.pos.x, p.pos.y, p.pos.z, p.radius, ctx, true);
        if (ctx.broadcast) ctx.broadcast(p.pos.x, p.pos.y, p.pos.z, p.radius);
      }
    }
  }

  boom(x, y, z, radius, ctx, applyEdits) {
    Sound.explode();

    if (applyEdits) {
      // Bracket the blast so the game can batch the network sync (one 'edits'
      // message instead of thousands of packets) and skip per-block break
      // particles (the fireball below is the blast's visual). try/finally so a
      // throwing setBlock can't leave the batch open.
      if (ctx.beginEdits) ctx.beginEdits();
      try {
        const r = Math.ceil(radius);
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            for (let dz = -r; dz <= r; dz++) {
              const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
              if (d > radius * (0.82 + Math.random() * 0.22)) continue; // ragged edge
              const bx = Math.floor(x + dx), by = Math.floor(y + dy), bz = Math.floor(z + dz);
              const id = this.world.getBlock(bx, by, bz);
              if (id === 0 || id === BEDROCK || id === WATER) continue;
              this.world.setBlock(bx, by, bz, 0);
              // Chain reaction: nearby TNT of either kind cooks off on a short fuse.
              if (id === TNT) this.prime(bx, by, bz, 0.3 + Math.random() * 0.4);
              else if (id === MEGA_TNT) this.prime(bx, by, bz, 0.3 + Math.random() * 0.4, MEGA_TNT_RADIUS, 'mega_tnt');
            }
          }
        }
      } finally {
        if (ctx.endEdits) ctx.endEdits();
      }
    }

    // Fireball + smoke — bigger blasts throw more fire, further.
    const blasts = Math.max(4, Math.round(radius * 1.2));
    const spread = Math.max(5, radius);
    for (let i = 0; i < blasts; i++) {
      this.particles.burst(x, y, z, [1, 0.5 + Math.random() * 0.35, 0.12], 16, spread);
      this.particles.burst(x, y, z, [0.25, 0.24, 0.22], 12, spread * 0.7);
    }

    // Damage scales with blast size; regular TNT/creepers keep their old hit.
    const power = Math.max(12, radius * 3.5);

    // Hurt the local player (each client owns its own vitals).
    const pp = ctx.playerPos;
    const pd = Math.hypot(pp.x - x, (pp.y + 0.9) - y, pp.z - z);
    if (pd < radius * 2) {
      const dmg = Math.max(1, Math.round((1 - pd / (radius * 2)) * power));
      ctx.damagePlayer(dmg, pp.x - x, pp.z - z);
    }

    // The simulation owner hurts mobs; guests' ghosts mirror via snapshots.
    // ctx.by (optional player id) credits the kills (exploding arrows).
    if (ctx.mobs) {
      for (const m of ctx.mobs.mobs) {
        if (m.dead) continue;
        const md = Math.hypot(m.pos.x - x, m.pos.y + 0.5 - y, m.pos.z - z);
        if (md < radius * 1.8) {
          if (ctx.by != null) m.lastHitBy = ctx.by;
          m.takeDamage(Math.max(1, Math.round((1 - md / (radius * 1.8)) * Math.max(14, radius * 4))), new THREE.Vector3(x, y, z));
        }
      }
    }
  }
}
