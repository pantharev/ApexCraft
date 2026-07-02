import * as THREE from 'three';
import { CHUNK_SIZE } from '../config.js';

// We split the light pool into two halves so torches (warm) and glow mushrooms
// (cool/cyan) never compete for slots and the player always has reliable warm
// torch lighting supplemented by ambient cave glow.
const TORCH_POOL  = 10;  // warm orange-yellow point lights for placed torches
const GLOW_POOL   = 6;   // cool cyan point lights for glow mushrooms
// Total active lights: TORCH_POOL + GLOW_POOL = 16 (up from original 12).
const RANGE       = 48;  // scan radius: only lights within this get a slot
const LIGHT_DIST  = 22;  // Three.js point-light reach (distance falloff)
const TORCH_INT   = 3.2; // intensity for torch lights
const GLOW_INT    = 1.8; // intensity for glow mushroom lights (dimmer — ambient)

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
// a split pool of point lights:
//   • TORCH_POOL warm lights follow the nearest placed torches.
//   • GLOW_POOL cool lights follow the nearest generated glow mushrooms (read
//     from chunk.lights populated by CaveGen.placeGlowMushrooms).
// Reuses existing THREE.PointLight instances — no per-frame allocation.
export class TorchLights {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.models = new Map(); // "x,y,z" -> Group
    this._mv = -1;

    // Warm torch lights (orange).
    this.torchLights = [];
    for (let i = 0; i < TORCH_POOL; i++) {
      const light = new THREE.PointLight(0xffc070, 0, LIGHT_DIST, 1.0);
      light.visible = false;
      scene.add(light);
      this.torchLights.push(light);
    }

    // Cool glow-mushroom lights (cyan-teal).
    this.glowLights = [];
    for (let i = 0; i < GLOW_POOL; i++) {
      const light = new THREE.PointLight(0x30e8cc, 0, LIGHT_DIST, 1.0);
      light.visible = false;
      scene.add(light);
      this.glowLights.push(light);
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

  // Scan loaded chunks for glow mushroom light positions within RANGE.
  // chunk.lights is set by CaveGen.placeGlowMushrooms on generation; it
  // persists in the Chunk object (LRU-cached) so we don't rescan each frame.
  _nearGlowSources(playerPos, buf) {
    buf.length = 0;
    const rangeSq = RANGE * RANGE;
    // Chunk-level rejection: a chunk whose centre is farther than RANGE plus
    // the chunk's half-diagonal can't contain an in-range light. This runs
    // every frame over all ~200 loaded chunks, so skipping whole chunks (and
    // their per-light distance math) matters in mushroom-dense cave regions.
    const half = CHUNK_SIZE / 2;
    const pad = RANGE + half * Math.SQRT2;
    const padSq = pad * pad;
    for (const chunk of this.world.chunks.values()) {
      if (!chunk.lights || chunk.lights.length === 0) continue;
      const cdx = chunk.cx * CHUNK_SIZE + half - playerPos.x;
      const cdz = chunk.cz * CHUNK_SIZE + half - playerPos.z;
      if (cdx * cdx + cdz * cdz > padSq) continue;
      for (const [wx, wy, wz] of chunk.lights) {
        const dx = wx + 0.5 - playerPos.x;
        const dy = wy + 0.7 - playerPos.y;
        const dz = wz + 0.5 - playerPos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= rangeSq) continue;
        let ins = buf.length;
        while (ins > 0 && buf[ins - 1][0] > d2) ins--;
        if (buf.length < GLOW_POOL) buf.splice(ins, 0, [d2, wx + 0.5, wy + 0.7, wz + 0.5]);
        else if (ins < GLOW_POOL) { buf.splice(ins, 0, [d2, wx + 0.5, wy + 0.7, wz + 0.5]); buf.length = GLOW_POOL; }
      }
    }
  }

  update(playerPos) {
    this._syncModels();

    // --- Torch lights (warm) ---
    const nearTorches = [];
    for (const k of this.world.torches) {
      const [x, y, z] = k.split(',');
      const tx = +x + 0.5, ty = +y + 0.7, tz = +z + 0.5;
      const dx = tx - playerPos.x, dy = ty - playerPos.y, dz = tz - playerPos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < RANGE * RANGE) nearTorches.push([d2, tx, ty, tz]);
    }
    nearTorches.sort((a, b) => a[0] - b[0]);

    for (let i = 0; i < TORCH_POOL; i++) {
      const light = this.torchLights[i];
      if (i < nearTorches.length) {
        light.position.set(nearTorches[i][1], nearTorches[i][2], nearTorches[i][3]);
        light.intensity = TORCH_INT;
        light.visible = true;
      } else {
        light.visible = false;
        light.intensity = 0;
      }
    }

    // --- Glow mushroom lights (cool cyan) ---
    // Persistent buffer — _nearGlowSources truncates and refills it, so no
    // per-frame array allocation for the common (few lights nearby) case.
    if (!this._glowBuf) this._glowBuf = [];
    const nearGlow = this._glowBuf;
    this._nearGlowSources(playerPos, nearGlow);

    for (let i = 0; i < GLOW_POOL; i++) {
      const light = this.glowLights[i];
      if (i < nearGlow.length) {
        light.position.set(nearGlow[i][1], nearGlow[i][2], nearGlow[i][3]);
        light.intensity = GLOW_INT;
        light.visible = true;
      } else {
        light.visible = false;
        light.intensity = 0;
      }
    }
  }

  // Dispose all pooled lights and torch meshes on teardown.
  dispose() {
    for (const light of this.torchLights) { this.scene.remove(light); light.dispose(); }
    for (const light of this.glowLights)  { this.scene.remove(light); light.dispose(); }
    for (const mesh of this.models.values()) {
      this.scene.remove(mesh);
      mesh.traverse((o) => o.geometry && o.geometry.dispose());
    }
  }
}
