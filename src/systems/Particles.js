import * as THREE from 'three';

// Pooled block-break particles: one THREE.Points with per-particle colour.
// burst() stamps a handful of chips at a block position; update() integrates
// gravity and parks expired particles far below the world (no realloc, no GC).

const MAX = 320;
const GRAVITY = 16;

export class Particles {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -9999; // parked

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mat = new THREE.PointsMaterial({
      size: 0.16, vertexColors: true, sizeAttenuation: true,
      transparent: true, opacity: 0.95, depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false; // particles are scattered; skip culling
    scene.add(this.points);
    this.cursor = 0;
  }

  // Spray `count` chips of colour [r,g,b] (0..1) from a block centre.
  burst(x, y, z, color, count = 14, power = 2.6) {
    const [r, g, b] = color;
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      this.life[i] = 0.35 + Math.random() * 0.3;
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.7;
      this.pos[i * 3 + 1] = y + (Math.random() - 0.5) * 0.7;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.7;
      const a = Math.random() * Math.PI * 2;
      const out = power * (0.3 + Math.random() * 0.7);
      this.vel[i * 3] = Math.cos(a) * out;
      this.vel[i * 3 + 1] = 1.5 + Math.random() * power;
      this.vel[i * 3 + 2] = Math.sin(a) * out;
      // Slight per-chip shade variation so the spray reads as rubble.
      const shade = 0.7 + Math.random() * 0.5;
      this.col[i * 3] = Math.min(1, r * shade);
      this.col[i * 3 + 1] = Math.min(1, g * shade);
      this.col[i * 3 + 2] = Math.min(1, b * shade);
    }
    this.geo.attributes.color.needsUpdate = true;
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -9999; continue; }
      this.vel[i * 3 + 1] -= GRAVITY * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    if (any) this.geo.attributes.position.needsUpdate = true;
  }
}
