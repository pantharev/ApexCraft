import * as THREE from 'three';
import { isSolid } from '../blocks/BlockRegistry.js';
import { getItem } from '../items/ItemRegistry.js';
import { Sound } from '../systems/Sound.js';

const SIZE = 0.28;
const COLLECT_RANGE = 1.5;
const COLLECT_RANGE_SQ = COLLECT_RANGE * COLLECT_RANGE;
const GRAVITY = 18;
const MAX_AGE = 300; // seconds before a drop despawns

// Manages free-floating item entities: small cubes that fall to the ground,
// bob + spin, and auto-collect when the player gets close. Collected items are
// reported via onCollect(itemName, count) — currently a simple counter store,
// later the real inventory (Phase 3).
export class ItemDrops {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.drops = [];
    this.geometry = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
    this.materials = new Map(); // item color -> material
    this.onCollect = null;
  }

  _material(item) {
    const color = (item && item.color) || '#ffffff';
    if (!this.materials.has(color)) {
      this.materials.set(color, new THREE.MeshLambertMaterial({ color }));
    }
    return this.materials.get(color);
  }

  // Spawn a drop at a block-center world position.
  spawn(itemName, count, x, y, z) {
    const item = getItem(itemName);
    if (!item) return;
    const mesh = new THREE.Mesh(this.geometry, this._material(item));
    mesh.position.set(x + 0.5, y + 0.4, z + 0.5);
    this.scene.add(mesh);
    this.drops.push({
      item: itemName,
      count,
      mesh,
      vel: new THREE.Vector3((Math.random() - 0.5) * 1.5, 2, (Math.random() - 0.5) * 1.5),
      age: 0,
      bob: Math.random() * Math.PI * 2,
    });
  }

  _remove(i) {
    this.scene.remove(this.drops[i].mesh);
    this.drops.splice(i, 1);
  }

  update(dt, playerPos) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      if (d.age > MAX_AGE) {
        this._remove(i);
        continue;
      }

      // Physics: fall until resting on a solid block.
      d.vel.y -= GRAVITY * dt;
      const next = d.mesh.position.clone().addScaledVector(d.vel, dt);
      const belowSolid = isSolid(
        this.world.getBlock(Math.floor(next.x), Math.floor(next.y - SIZE / 2), Math.floor(next.z))
      );
      if (belowSolid && d.vel.y < 0) {
        d.vel.set(0, 0, 0);
        next.y = Math.floor(next.y) + SIZE / 2 + 0.05;
      }
      d.mesh.position.copy(next);

      // Cosmetic bob + spin once settled.
      d.bob += dt * 2;
      d.mesh.rotation.y += dt * 1.5;
      d.mesh.position.y += Math.sin(d.bob) * 0.0015;

      // Auto-collect.
      const dx = d.mesh.position.x - playerPos.x;
      const dy = d.mesh.position.y - (playerPos.y + 0.9);
      const dz = d.mesh.position.z - playerPos.z;
      if (dx * dx + dy * dy + dz * dz < COLLECT_RANGE_SQ) {
        if (this.onCollect) {
          const leftover = this.onCollect(d.item, d.count);
          if (leftover > 0) d.count = leftover; // inventory full: keep in world
          else { Sound.pickup(); this._remove(i); }
        } else {
          this._remove(i);
        }
      }
    }
  }
}
