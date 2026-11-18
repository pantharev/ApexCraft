import * as THREE from 'three';
import { mulberry32 } from '../world/noise.js';
import { SkyDome, Clouds, SKY_RADIUS } from './Sky.js';

// Time of day and everything it lights: the directional sun/moon light, the
// hemisphere ambient, the sky dome, clouds, stars, and the fog.
// t in [0,1): 0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = midnight.

const col = (hex) => new THREE.Color(hex);

// The palette. Every value is blended by two factors derived from the sun's
// height: `dayAmt` (0 night .. 1 day) and `dusk` (peaks as the sun crosses the
// horizon, in both directions — so sunrise and sunset share it).
const PAL = {
  zenithDay: col('#3a7bd5'), zenithNight: col('#040814'), zenithDusk: col('#33457f'),
  horizonDay: col('#b6d4f0'), horizonNight: col('#121d3b'), horizonDusk: col('#f0975c'),
  sunHigh: col('#fff2dc'), sunLow: col('#ff9a55'), moon: col('#9db8ff'),
  hemiSkyDay: col('#cfe1ff'), hemiSkyNight: col('#7394ce'), hemiSkyDusk: col('#ffc7a0'),
  hemiGroundDay: col('#8a7e6a'), hemiGroundNight: col('#2c3454'),
  glowDay: col('#fff0c8'), glowDusk: col('#ff8a3c'),
  cloudDay: col('#ffffff'), cloudDusk: col('#ffbf9c'), cloudNight: col('#2b3451'),
  caveFog: col('#05070b'),
  waterDay: col('#1b5884'), waterNight: col('#06182a'),
};

// Light strengths. three's lights are physical: a Lambert surface reflects
// intensity / PI, so these read ~3x higher than "legacy" three values.
// The night values look generous on paper: the filmic tone curve crushes low
// light hard, so night has to be lit well above "realistic" to stay playable
// (Zombies is locked to night).
const SUN_INTENSITY = 2.5;
const MOON_INTENSITY = 1.2;
const HEMI_DAY = 1.5;
const HEMI_NIGHT = 1.45;

// Fog distances. `far` sits just inside the nearest unloaded terrain (the load
// disc is 8 chunks; its diagonals reach ~113 blocks) so the world's edge is
// always fully fogged instead of visibly popping in.
const FOG_NEAR = 58, FOG_FAR = 112;
const CAVE_NEAR = 10, CAVE_FAR = 64;
const WATER_NEAR = 0.5, WATER_FAR = 26;

const STAR_COUNT = 420;

const smooth01 = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

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
    map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false,
    blending: THREE.AdditiveBlending,
  }));
  sprite.scale.set(size, size, 1);
  return sprite;
}

export class DayNight {
  constructor(scene, sun, hemi, camera, {
    cycleSeconds = 360, startT = 0.2, fogNear = FOG_NEAR, fogFar = FOG_FAR,
  } = {}) {
    this.scene = scene;
    this.sun = sun;
    this.hemi = hemi;
    this.camera = camera;
    this.cycle = cycleSeconds;
    this.t = startT;
    this.frozen = false; // dev: hold time of day
    // Open-air fog distances (arena maps pass a longer range: they are small,
    // walled worlds with no terrain edge to hide).
    this.fogNear = fogNear;
    this.fogFar = fogFar;

    // Unit vector toward the light that is currently lighting the world: the
    // sun by day, the moon by night. The Game aims the shadow-casting
    // directional light along this (see Game._aimSun).
    this.lightDir = new THREE.Vector3(0, 1, 0);
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.dayAmt = 1;
    // The fog colour after cave/underwater adjustments (also the background).
    this.fogColor = new THREE.Color();
    this._water = new THREE.Color();
    // Camera surroundings, each 0..1 and already smoothed by the caller.
    this._env = { underwater: 0, cave: 0 };

    this.sky = new SkyDome();
    scene.add(this.sky.mesh);
    this.clouds = new Clouds();
    scene.add(this.clouds.mesh);

    // Visible celestial bodies (unlit + fog-disabled so they stay bright).
    this.sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(22, 16, 16),
      new THREE.MeshBasicMaterial({ color: '#fff3b0', fog: false, toneMapped: false })
    );
    this.moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(16, 16, 16),
      new THREE.MeshBasicMaterial({ color: '#dfe6f0', fog: false, toneMapped: false })
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
      transparent: true, opacity: 0, fog: false, depthWrite: false, toneMapped: false,
    });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.stars.frustumCulled = false;
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

  // `env` (optional) = { underwater, cave }, each 0..1: how submerged the
  // camera is and how deep under a rock roof. Remembered between calls, so the
  // many `update(0)` refreshes elsewhere keep the current surroundings.
  update(dt, env) {
    if (env) this._env = env;
    if (!this.frozen) this.t = (this.t + dt / this.cycle) % 1;
    const angle = this.t * Math.PI * 2;
    const sunFrac = Math.sin(angle); // -1..1, 1 at noon
    const dayAmt = this.dayAmt = smooth01((sunFrac + 0.08) / 0.4);
    // Dawn/dusk band: strongest as the sun crosses the horizon.
    const dusk = smooth01(1 - Math.abs(sunFrac) / 0.32);
    const { underwater, cave } = this._env;

    // The sun rises in the east (+X), peaks overhead (tilted a little south so
    // it never sits exactly at the zenith), and sets in the west (-X).
    this.sunDir.set(Math.cos(angle), sunFrac, 0.38).normalize();

    // One directional light plays both bodies. It fades to nothing as the sun
    // crosses the horizon, which is where it swaps sides — so the hand-over
    // (and the long, stretched shadows either side of it) is never visible.
    if (sunFrac >= 0) {
      this.lightDir.copy(this.sunDir);
      this.sun.intensity = SUN_INTENSITY * smooth01(sunFrac / 0.22);
      this.sun.color.copy(PAL.sunLow).lerp(PAL.sunHigh, smooth01(sunFrac / 0.45));
    } else {
      this.lightDir.copy(this.sunDir).negate();
      this.sun.intensity = MOON_INTENSITY * smooth01(-sunFrac / 0.22);
      this.sun.color.copy(PAL.moon);
    }

    // Ambient: cool and dim at night, sky-blue by day, warm at the horizon.
    this.hemi.intensity = mix(HEMI_NIGHT, HEMI_DAY, dayAmt);
    this.hemi.color.copy(PAL.hemiSkyNight).lerp(PAL.hemiSkyDay, dayAmt).lerp(PAL.hemiSkyDusk, dusk * 0.45);
    this.hemi.groundColor.copy(PAL.hemiGroundNight).lerp(PAL.hemiGroundDay, dayAmt);

    // Sky gradient.
    const sky = this.sky.uniforms;
    sky.uZenith.value.copy(PAL.zenithNight).lerp(PAL.zenithDay, dayAmt).lerp(PAL.zenithDusk, dusk * 0.55);
    sky.uHorizon.value.copy(PAL.horizonNight).lerp(PAL.horizonDay, dayAmt).lerp(PAL.horizonDusk, dusk * 0.7);
    if (sunFrac > -0.12) {
      sky.uGlowDir.value.copy(this.sunDir);
      sky.uGlow.value.copy(PAL.glowDay).lerp(PAL.glowDusk, dusk);
      sky.uGlowAmt.value = (0.25 + dusk * 0.75) * smooth01((sunFrac + 0.12) / 0.12);
    } else {
      sky.uGlowDir.value.copy(this.sunDir).negate();
      sky.uGlow.value.copy(PAL.moon);
      sky.uGlowAmt.value = 0.16 * smooth01((-sunFrac - 0.12) / 0.12);
    }

    // Fog: the horizon colour in the open, near-black down in the caves, and
    // dense blue-green murk under water (closest of all, so it wins).
    const fog = this.scene.fog;
    this.fogColor.copy(sky.uHorizon.value).lerp(PAL.caveFog, cave);
    let near = mix(this.fogNear, CAVE_NEAR, cave);
    let far = mix(this.fogFar, CAVE_FAR, cave);
    if (underwater > 0) {
      this.fogColor.lerp(this._water.copy(PAL.waterNight).lerp(PAL.waterDay, dayAmt), underwater);
      near = mix(near, WATER_NEAR, underwater);
      far = mix(far, WATER_FAR, underwater);
    }
    if (fog) {
      fog.color.copy(this.fogColor);
      fog.near = near;
      fog.far = far;
    }
    this.scene.background = this.fogColor;
    sky.uMurk.value.copy(this.fogColor);
    sky.uMurkAmt.value = underwater;

    // Place the visible sun/moon discs on their arc, following the camera so
    // they sit "at infinity". The moon is opposite the sun. Nothing in the sky
    // is visible from under water.
    if (this.camera) {
      const cam = this.camera.position;
      const d = this.sunDir;
      const dry = underwater < 0.5;
      this.sunMesh.position.set(cam.x + d.x * SKY_RADIUS, cam.y + d.y * SKY_RADIUS, cam.z + d.z * SKY_RADIUS);
      this.moonMesh.position.set(cam.x - d.x * SKY_RADIUS, cam.y - d.y * SKY_RADIUS, cam.z - d.z * SKY_RADIUS);
      // Hide whichever body is below the horizon.
      this.sunMesh.visible = dry && d.y > -0.15;
      this.moonMesh.visible = dry && -d.y > -0.15;

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
      this.stars.visible = dry && night > 0;

      this.sky.mesh.position.set(cam.x, cam.y, cam.z);

      this.clouds.update(dt, cam);
      this.clouds.mesh.visible = dry;
      const cu = this.clouds.uniforms;
      cu.uColor.value.copy(PAL.cloudNight).lerp(PAL.cloudDay, dayAmt).lerp(PAL.cloudDusk, dusk * 0.6);
      cu.uOpacity.value = mix(0.5, 0.92, dayAmt);
    }
  }

  dispose() {
    this.sky.dispose();
    this.clouds.dispose();
    this.sunMesh.geometry.dispose();
    this.sunMesh.material.dispose();
    this.moonMesh.geometry.dispose();
    this.moonMesh.material.dispose();
    for (const s of [this.sunGlow, this.moonGlow]) {
      s.material.map.dispose();
      s.material.dispose();
    }
    this.stars.geometry.dispose();
    this.starMat.dispose();
  }
}
