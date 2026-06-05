import * as THREE from 'three';

const POOL = 8;     // max simultaneous torch point-lights (kept low for perf)
const RANGE = 28;   // only torches within this distance are considered

// A small pool of point lights that follow the nearest placed torches, so
// torches actually illuminate their surroundings without spawning an unbounded
// number of lights. Torch positions live in World.torches.
export class TorchLights {
  constructor(scene, world) {
    this.world = world;
    this.lights = [];
    for (let i = 0; i < POOL; i++) {
      const light = new THREE.PointLight(0xffb86b, 0, 14, 1.6);
      light.visible = false;
      scene.add(light);
      this.lights.push(light);
    }
  }

  update(playerPos) {
    const near = [];
    for (const k of this.world.torches) {
      const [x, y, z] = k.split(',');
      const tx = +x + 0.5, ty = +y + 0.5, tz = +z + 0.5;
      const dx = tx - playerPos.x, dy = ty - playerPos.y, dz = tz - playerPos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < RANGE * RANGE) near.push([d2, tx, ty, tz]);
    }
    near.sort((a, b) => a[0] - b[0]);

    for (let i = 0; i < POOL; i++) {
      const light = this.lights[i];
      if (i < near.length) {
        light.position.set(near[i][1], near[i][2], near[i][3]);
        light.intensity = 2.2;
        light.visible = true;
      } else {
        light.visible = false;
        light.intensity = 0;
      }
    }
  }
}
