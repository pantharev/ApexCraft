import * as THREE from 'three';

const POOL = 12;     // max simultaneous torch point-lights
const RANGE = 48;    // only torches within this distance get a light
const LIGHT_DIST = 24;
const LIGHT_INTENSITY = 3.2;

// Shared geometry/materials for the thin torch stick + flame.
const stickGeo = new THREE.BoxGeometry(0.12, 0.55, 0.12);
const flameGeo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
const stickMat = new THREE.MeshLambertMaterial({ color: '#6b4f2a' });
const flameMat = new THREE.MeshBasicMaterial({ color: '#ffcf66' }); // glows regardless of light

function buildTorchMesh() {
  const g = new THREE.Group();
  const stick = new THREE.Mesh(stickGeo, stickMat);
  stick.position.y = 0.275;
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.y = 0.6;
  g.add(stick, flame);
  return g;
}

// Renders placed torches as thin stick meshes and lights their surroundings with
// a pool of bright point lights that follow the nearest torches.
export class TorchLights {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.models = new Map(); // "x,y,z" -> Group
    this._mv = -1;

    this.lights = [];
    for (let i = 0; i < POOL; i++) {
      const light = new THREE.PointLight(0xffc070, 0, LIGHT_DIST, 1.0);
      light.visible = false;
      scene.add(light);
      this.lights.push(light);
    }
  }

  // Sync the visible torch meshes with World.torches when it changes.
  _syncModels() {
    if (this.world.torchVersion === this._mv) return;
    this._mv = this.world.torchVersion;

    // Remove meshes whose torch is gone.
    for (const [k, mesh] of this.models) {
      if (!this.world.torches.has(k)) {
        this.scene.remove(mesh);
        this.models.delete(k);
      }
    }
    // Add meshes for new torches.
    for (const k of this.world.torches) {
      if (!this.models.has(k)) {
        const [x, y, z] = k.split(',');
        const mesh = buildTorchMesh();
        mesh.position.set(+x + 0.5, +y, +z + 0.5);
        this.scene.add(mesh);
        this.models.set(k, mesh);
      }
    }
  }

  update(playerPos) {
    this._syncModels();

    const near = [];
    for (const k of this.world.torches) {
      const [x, y, z] = k.split(',');
      const tx = +x + 0.5, ty = +y + 0.7, tz = +z + 0.5;
      const dx = tx - playerPos.x, dy = ty - playerPos.y, dz = tz - playerPos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < RANGE * RANGE) near.push([d2, tx, ty, tz]);
    }
    near.sort((a, b) => a[0] - b[0]);

    for (let i = 0; i < POOL; i++) {
      const light = this.lights[i];
      if (i < near.length) {
        light.position.set(near[i][1], near[i][2], near[i][3]);
        light.intensity = LIGHT_INTENSITY;
        light.visible = true;
      } else {
        light.visible = false;
        light.intensity = 0;
      }
    }
  }
}
