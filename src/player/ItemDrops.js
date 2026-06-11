import * as THREE from 'three';
import { isSolid, getBlock, getBlockId } from '../blocks/BlockRegistry.js';
import { getItem } from '../items/ItemRegistry.js';
import { Sound } from '../systems/Sound.js';
import { dropPlateGeometry, plateMaterial, buildBlockCube, buildTorchModel } from '../items/ItemModels.js';

const SIZE = 0.28;
const COLLECT_RANGE = 1.5;
const COLLECT_RANGE_SQ = COLLECT_RANGE * COLLECT_RANGE;
const GRAVITY = 18;
const MAX_AGE = 300; // seconds before a drop despawns

// Manages free-floating item entities that fall to the ground, bob + spin, and
// auto-collect when the player gets close. Drops use real item models: block
// items are mini textured cubes, everything else is its icon extruded into a
// spinning plate (geometry/materials are shared caches — never disposed here).
export class ItemDrops {
  constructor(world, scene) {
    this.world = world;
    this.scene = scene;
    this.drops = [];
    this.onCollect = null;
  }

  _model(item) {
    if (item.placeBlock === 'torch') return buildTorchModel(0.7);
    const blockDef = item.placeBlock ? getBlock(getBlockId(item.placeBlock)) : null;
    if (blockDef && !blockDef.plant && !blockDef.door && !blockDef.stair && !blockDef.bed) {
      return buildBlockCube(item.placeBlock, 0.26, true); // shared geo
    }
    return new THREE.Mesh(dropPlateGeometry(item.name, 0.4), plateMaterial());
  }

  // Spawn a drop at a block-center world position.
  spawn(itemName, count, x, y, z) {
    const item = getItem(itemName);
    if (!item) return;
    const mesh = this._model(item);
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
