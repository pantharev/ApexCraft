import * as THREE from 'three';
import { SEA_LEVEL, WORLD_HEIGHT } from '../config.js';
import { World } from './World.js';
import { loadGraphics } from './Game.js';
import { SunRig } from '../systems/SunRig.js';
import { tickWater } from '../textures/water.js';
import { DayNight } from '../systems/DayNight.js';
import { reseed, Noise } from '../world/noise.js';
import { setGenMode } from '../world/generators/TerrainGen.js';
import { columnHeight } from '../world/generators/Height.js';
import { getBiome, BiomeParams } from '../world/biomes/BiomeMap.js';

// The menu backdrop: a slow flight over real, freshly generated terrain, drawn
// behind the title screen and the world list (ui/MenuBackdrop.jsx). It is the
// game's own world, sky, light and shadows with nothing else — no player, no
// mobs, no input, no saving — so what a new player sees before they press
// Play is what they are about to walk into.
//
// It shares module state with the game (the noise seed, the generation mode),
// so it must be disposed before a Game is constructed and only created after
// the Game is gone. Being a child of the menu screens gives it exactly that
// lifetime.

const SPEED = 4.5;         // flight speed, blocks per second
const CLEARANCE = 20;      // height kept above the highest ground just ahead
const LOOK_DOWN = 0.2;     // how far below the horizon the camera looks (rise over run)
const SWAY = 0.2;          // the view swings this far (radians) either side of the heading
const LOOKAHEAD = 78;      // blocks of ground ahead the altitude is planned over (about 17 s of flight)
const MAX_CLIMB = 5;       // fastest the camera rises or sinks, blocks per second
const LEAN = 0.06;         // turn rate (radians per second) toward the side with more land
const START_CLOCK = 0.06;  // time of day the flight starts at: early morning, long shadows
const DAY_SECONDS = 150;   // sunrise to sunset
const NIGHT_SECONDS = 30;  // ...and a short night, so the stars are a moment, not the show
const READY_CHUNKS = 90;   // chunks meshed before the backdrop is shown (a 5-chunk disc)
const READY_SECONDS = 4;   // ...or this long, whichever comes first
const MAX_PIXEL_RATIO = 1.5;
const MAX_STEP = 0.05;     // longest step, seconds (a stalled tab must not teleport the camera)

const isLand = (x, z) => columnHeight(Math.round(x), Math.round(z)) > SEA_LEVEL + 1;

// How good a stretch of country looks from the air: mostly land with some
// water in it, green rather than bare sand or snow, some relief, some woods.
// Sampled along the heading.
function scenery(x, z, heading) {
  const dx = Math.cos(heading), dz = Math.sin(heading);
  let land = 0, green = 0, lo = Infinity, hi = -Infinity, woods = 0, n = 0;
  for (let d = 0; d <= 360; d += 24, n++) {
    const px = Math.round(x + dx * d), pz = Math.round(z + dz * d);
    const h = columnHeight(px, pz);
    if (h > SEA_LEVEL + 1) {
      land++;
      if (BiomeParams[getBiome(px, pz)].surface === 'grass') green++;
    }
    if (h < lo) lo = h;
    if (h > hi) hi = h;
    woods += Math.max(0, Noise.forest(px, pz));
  }
  return -Math.abs(land / n - 0.7) * 6 + (green / n) * 3 + Math.min(1, (hi - lo) / 30) * 2 + (woods / n) * 1.5;
}

// The share of land in a direction, a few seconds' flight out.
function landAhead(x, z, heading) {
  const dx = Math.cos(heading), dz = Math.sin(heading);
  let land = 0;
  for (let d = 60; d <= 240; d += 60) if (isLand(x + dx * d, z + dz * d)) land++;
  return land / 4;
}

// The flight. There is one per page load: the title screen and the world list
// share it, and coming back from a game picks it up where it left off.
let tour = null;

// A new world and the best-looking of a few dozen random places in it to
// start from (a random spot is too often open sea).
function newTour() {
  const seed = Math.floor(Math.random() * 1e9);
  reseed(seed);
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < 48; i++) {
    const x = (Math.random() * 2 - 1) * 4000, z = (Math.random() * 2 - 1) * 4000;
    const heading = Math.random() * Math.PI * 2;
    const score = scenery(x, z, heading);
    if (score > bestScore) { bestScore = score; best = { x, z, heading }; }
  }
  return { seed, x: best.x, z: best.z, y: 0, heading: best.heading, time: 0, clock: START_CLOCK };
}

// The renderer. Also one per page load, kept between menu visits: releasing a
// WebGL context stalls the page for tens of milliseconds — exactly when the
// player has just clicked Play on a world — and a fresh one would recompile
// every shader each time they come back. While a game runs it sits idle,
// holding nothing but its programs and the block textures.
let shared = null;
function sharedRenderer() {
  if (shared) return shared;
  // Same settings as the Game, so the picture matches it.
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  // If the browser takes the context away (a GPU reset, or too many contexts
  // on the page), start over with a new renderer on the next menu visit.
  renderer.domElement.addEventListener('webglcontextlost', () => {
    if (shared === renderer) shared = null;
  });
  shared = renderer;
  return renderer;
}

export class Backdrop {
  // Throws if WebGL is unavailable; the menus then keep their plain background.
  constructor(container) {
    this.container = container;
    this.onReady = null; // () => void, once there is enough world to show
    this.onLost = null;  // () => void, if the picture is gone for good (WebGL context lost)
    this.ready = false;
    this._stopped = false;  // no longer drawing (disposed, or the WebGL context is gone)
    this._released = false; // dispose() has run
    this._raf = 0;
    this._age = 0;
    this._steerT = 0;
    this._turn = 0;
    this._meshed = -1;    // still mode: chunks meshed last frame...
    this._settledAt = 0;  // ...and when that last changed
    // Honour "reduce motion": hold one still view instead of flying.
    this.still = typeof window !== 'undefined' && !!window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!tour) tour = newTour();
    else reseed(tour.seed);
    setGenMode(null); // procedural terrain, whatever mode the last world was in

    this.renderer = sharedRenderer();
    this._lost = () => {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
      this._stopped = true; // nothing left to draw with; dispose() still cleans up
      if (this.onLost) this.onLost();
    };
    this.renderer.domElement.addEventListener('webglcontextlost', this._lost);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x87b6e8, 58, 112); // DayNight owns colour and range
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);

    const shadows = loadGraphics() === 'high';
    this.sunRig = new SunRig(this.scene, this.camera);
    this.sunRig.sun.castShadow = shadows;
    this.world = new World(this.scene, { scenery: true });
    this.world.setCastShadows(shadows);

    if (!tour.y) tour.y = this._groundAhead() + CLEARANCE;
    this._placeCamera();
    this.dayNight = new DayNight(this.scene, this.sunRig.sun, this.sunRig.hemi, this.camera, { startT: tour.clock });
    this.dayNight.frozen = true; // the flight keeps its own clock (see _fly)

    this.clock = new THREE.Clock();
    this._resize = this._resize.bind(this);
    this._observer = new ResizeObserver(this._resize);
    this._observer.observe(container);
    this._resize();
  }

  start() {
    this.clock.start();
    this._raf = requestAnimationFrame(this._frame);
  }

  // The highest ground between here and LOOKAHEAD blocks along the heading.
  _groundAhead() {
    const dx = Math.cos(tour.heading), dz = Math.sin(tour.heading);
    let ground = SEA_LEVEL;
    for (let d = 0; d <= LOOKAHEAD; d += 13) {
      const h = columnHeight(Math.round(tour.x + dx * d), Math.round(tour.z + dz * d));
      if (h > ground) ground = h;
    }
    return ground;
  }

  _placeCamera() {
    const look = tour.heading + Math.sin(tour.time * 0.11) * SWAY;
    this.camera.position.set(tour.x, tour.y, tour.z);
    this.camera.lookAt(tour.x + Math.cos(look) * 10, tour.y - 10 * LOOK_DOWN, tour.z + Math.sin(look) * 10);
  }

  _fly(dt) {
    tour.time += dt;
    // Wander in long lazy curves, leaning toward whichever side has more land
    // so the flight follows coasts instead of heading out to sea.
    this._steerT -= dt;
    if (this._steerT <= 0) {
      this._steerT = 0.5;
      const lean = landAhead(tour.x, tour.z, tour.heading + 0.6) - landAhead(tour.x, tour.z, tour.heading - 0.6);
      this._turn += (lean * LEAN - this._turn) * 0.5;
    }
    tour.heading += (Math.sin(tour.time * 0.07) * 0.05 + this._turn) * dt;
    tour.x += Math.cos(tour.heading) * SPEED * dt;
    tour.z += Math.sin(tour.heading) * SPEED * dt;
    // Glide over the terrain: start climbing well before a hill arrives, sink
    // slowly after it, never lurch, and stay under the cloud layer.
    const target = Math.min(WORLD_HEIGHT + 24, this._groundAhead() + CLEARANCE);
    const ease = (target - tour.y) * (1 - Math.exp(-dt * (target > tour.y ? 0.7 : 0.3)));
    tour.y += Math.max(-MAX_CLIMB * dt, Math.min(MAX_CLIMB * dt, ease));
    // A long day and a short night.
    tour.clock = (tour.clock + dt * 0.5 / (tour.clock < 0.5 ? DAY_SECONDS : NIGHT_SECONDS)) % 1;
  }

  _frame = () => {
    if (this._stopped) return;
    this._raf = requestAnimationFrame(this._frame);
    const dt = Math.min(this.clock.getDelta(), MAX_STEP);
    this._age += dt;
    if (!this.still) this._fly(dt);
    this._placeCamera();
    this.world.update(tour.x, tour.z);
    this.dayNight.t = tour.clock;
    this.dayNight.update(this.still ? 0 : dt);
    this.sunRig.aim(this.dayNight.lightDir, this.camera.position);
    tickWater(this.still ? 0 : dt, this.dayNight); // the water moves with the sky, as in the game
    this.renderer.render(this.scene, this.camera);

    if (this.ready && !this.still) return;
    let meshed = 0;
    for (const chunk of this.world.chunks.values()) if (chunk.mesh) meshed++;
    if (!this.ready) {
      if (meshed >= READY_CHUNKS || this._age >= READY_SECONDS) {
        this.ready = true;
        if (this.onReady) this.onReady();
      }
    }
    if (this.still) {
      // A still picture: once no new terrain has arrived for a moment, the
      // view is complete — stop drawing it.
      if (meshed !== this._meshed) {
        this._meshed = meshed;
        this._settledAt = this._age;
      } else if (this.ready && this._age - this._settledAt > 1.5) {
        cancelAnimationFrame(this._raf);
        this._raf = 0;
      }
    }
  };

  _resize() {
    if (this._stopped) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (!this._raf && this.ready) this.renderer.render(this.scene, this.camera); // the still picture
  }

  // Stops the flight and frees the world. The renderer stays (see
  // sharedRenderer); everything this instance put on the GPU is released here.
  dispose() {
    if (this._released) return;
    this._released = true;
    this._stopped = true;
    cancelAnimationFrame(this._raf);
    this._observer.disconnect();
    this.world.dispose(); // stops the chunk workers, frees the chunk meshes
    this.dayNight.dispose();
    this.sunRig.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this._lost);
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }
}
