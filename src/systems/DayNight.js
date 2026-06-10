import * as THREE from 'three';
import { mulberry32 } from '../world/noise.js';

const DAY_SKY = new THREE.Color('#87b6e8');
const NIGHT_SKY = new THREE.Color('#0a1430');
const DUSK_SKY = new THREE.Color('#e08a52');
const SUN_WARM = new THREE.Color('#ffb070');
const SUN_WHITE = new THREE.Color('#ffffff');

// Advances a time-of-day value and drives the sun, ambient light, and sky/fog
// colour. t in [0,1): 0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = midnight.
const SKY_RADIUS = 400; // distance of the sun/moon discs from the camera
const STAR_COUNT = 420;

const smooth01 = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

// Soft radial-gradient sprite used as a glow halo behind the sun and moon.
function glowSprite(inner, outer, size) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d').createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  const ctx = c.getContext('2d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending,
  }));
  sprite.scale.set(size, size, 1);
  return sprite;
}

export class DayNight {
  constructor(scene, sun, hemi, camera, { cycleSeconds = 360, startT = 0.2 } = {}) {
    this.scene = scene;
    this.sun = sun;
    this.hemi = hemi;
    this.camera = camera;
    this.cycle = cycleSeconds;
    this.t = startT;
    this.frozen = false; // dev: hold time of day
    this._sky = new THREE.Color();

    // Visible celestial bodies (unlit + fog-disabled so they stay bright).
    this.sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(22, 16, 16),
      new THREE.MeshBasicMaterial({ color: '#fff3b0', fog: false })
    );
    this.moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(16, 16, 16),
      new THREE.MeshBasicMaterial({ color: '#dfe6f0', fog: false })
    );
    scene.add(this.sunMesh);
    scene.add(this.moonMesh);

    // Atmospheric glow halos around the discs.
    this.sunGlow = glowSprite('rgba(255,225,150,0.85)', 'rgba(255,160,60,0)', 150);
    this.moonGlow = glowSprite('rgba(190,210,255,0.4)', 'rgba(120,150,220,0)', 70);
    scene.add(this.sunGlow);
    scene.add(this.moonGlow);

    // Star dome: fixed points on the upper sky sphere that wheel slowly with
    // the night and fade in/out around dusk/dawn. Follows the camera.
    const rng = mulberry32(0x57a25);
    const pos = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      // Sample the full sphere; the dome rotates so stars rise and set.
      const a = rng() * Math.PI * 2;
      const y = rng() * 2 - 1;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * r * SKY_RADIUS * 0.96;
      pos[i * 3 + 1] = y * SKY_RADIUS * 0.96;
      pos[i * 3 + 2] = Math.sin(a) * r * SKY_RADIUS * 0.96;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({
      color: '#dce8ff', size: 1.6, sizeAttenuation: false,
      transparent: true, opacity: 0, fog: false, depthWrite: false,
    });
    this.stars = new THREE.Points(starGeo, this.starMat);
    scene.add(this.stars);

    this.update(0);
  }

  get isNight() {
    // Night while the sun is below the horizon.
    return Math.sin(this.t * Math.PI * 2) < -0.05;
  }

  // 24h clock string for the HUD.
  clock() {
    const hours = (this.t * 24 + 6) % 24; // t=0 -> 06:00
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  update(dt) {
    if (!this.frozen) this.t = (this.t + dt / this.cycle) % 1;
    const angle = this.t * Math.PI * 2;
    const sunFrac = Math.sin(angle); // -1..1, 1 at noon
    const day = Math.max(0, sunFrac); // 0 at/below horizon, 1 at noon
    // Dawn/dusk band: strongest as the sun crosses the horizon.
    const dusk = smooth01(1 - Math.abs(sunFrac) / 0.3);

    // Sun rises in the east (+X), peaks overhead, sets in the west (-X).
    this.sun.position.set(Math.cos(angle) * 100, sunFrac * 100, 40);
    this.sun.intensity = 0.15 + day * 0.85;
    this.sun.color.copy(SUN_WHITE).lerp(SUN_WARM, dusk); // warm light at the horizon
    this.hemi.intensity = 0.25 + day * 0.6;

    // Place the visible sun/moon discs on their arc, following the camera so
    // they sit "at infinity". The moon is opposite the sun.
    if (this.camera) {
      const cam = this.camera.position;
      const sx = Math.cos(angle), sy = Math.sin(angle), sz = 0.35;
      const sl = Math.hypot(sx, sy, sz);
      this.sunMesh.position.set(cam.x + (sx / sl) * SKY_RADIUS, cam.y + (sy / sl) * SKY_RADIUS, cam.z + (sz / sl) * SKY_RADIUS);
      this.moonMesh.position.set(cam.x - (sx / sl) * SKY_RADIUS, cam.y - (sy / sl) * SKY_RADIUS, cam.z - (sz / sl) * SKY_RADIUS);
      // Hide whichever body is below the horizon.
      this.sunMesh.visible = sy > -0.15;
      this.moonMesh.visible = -sy > -0.15;

      this.sunGlow.position.copy(this.sunMesh.position);
      this.sunGlow.visible = this.sunMesh.visible;
      this.sunGlow.material.opacity = 0.35 + dusk * 0.45; // glow swells at the horizon
      this.moonGlow.position.copy(this.moonMesh.position);
      this.moonGlow.visible = this.moonMesh.visible;

      // Star dome follows the camera and wheels with the time of day.
      this.stars.position.set(cam.x, cam.y, cam.z);
      this.stars.rotation.z = -angle * 0.5;
      const night = smooth01((-sunFrac - 0.02) / 0.35);
      this.starMat.opacity = night * 0.95;
    }

    // Sky + fog colour: night <-> day, washed with orange at dawn/dusk.
    this._sky.copy(NIGHT_SKY).lerp(DAY_SKY, day);
    this._sky.lerp(DUSK_SKY, dusk * 0.45);
    this.scene.background = this._sky;
    if (this.scene.fog) this.scene.fog.color.copy(this._sky);
  }
}
