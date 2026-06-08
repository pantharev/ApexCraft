import * as THREE from 'three';

const DAY_SKY = new THREE.Color('#87b6e8');
const NIGHT_SKY = new THREE.Color('#0a1430');

// Advances a time-of-day value and drives the sun, ambient light, and sky/fog
// colour. t in [0,1): 0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = midnight.
const SKY_RADIUS = 400; // distance of the sun/moon discs from the camera

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

    // Sun rises in the east (+X), peaks overhead, sets in the west (-X).
    this.sun.position.set(Math.cos(angle) * 100, sunFrac * 100, 40);
    this.sun.intensity = 0.15 + day * 0.85;
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
    }

    // Sky + fog colour lerp between night and day.
    this._sky.copy(NIGHT_SKY).lerp(DAY_SKY, day);
    this.scene.background = this._sky;
    if (this.scene.fog) this.scene.fog.color.copy(this._sky);
  }
}
