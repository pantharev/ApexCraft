import * as THREE from 'three';
import { isSolid, getBlockId } from '../blocks/BlockRegistry.js';
import { Sound, soundCategory } from '../systems/Sound.js';

const WATER = getBlockId('water');

// Player physics + first-person controls. Uses an AABB swept against the voxel
// grid for collision. Pointer lock drives camera look; WASD drives movement.
const WIDTH = 0.6; // half-extent ~0.3 each side
const HEIGHT = 1.8;
const EYE = 1.62;
const GRAVITY = 28;
const JUMP_SPEED = 9;
const WALK_SPEED = 5.5;
const FLY_SPEED = 12;
// Swimming.
const SWIM_SPEED = 4;
const WATER_GRAVITY = 20; // still weaker than air, but enough to plunge in
const WATER_DRAG = 0.91;  // gradual drag (closer to 1 = momentum carries on entry)
const SWIM_UP = 6;        // velocity when holding Space underwater
const SENSITIVITY = 0.0014; // radians per pixel of mouse movement
const LOOK_SMOOTH = 18; // higher = snappier; lower = floatier

export class Player {
  constructor(world, camera, domElement) {
    this.world = world;
    this.camera = camera;
    this.dom = domElement;

    this.pos = new THREE.Vector3(0, 80, 0); // feet position
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.targetYaw = 0; // raw input target; rendered yaw eases toward this
    this.targetPitch = 0;
    this.onGround = false;
    this.flying = false;
    this._peakY = this.pos.y; // highest point since last on ground (fall damage)
    this.onLand = null; // (fallDistance) => void
    this.inWater = false;
    this._wasInWater = false;
    this._stepT = 0; // footstep cadence accumulator
    this._swimT = 0; // swim-stroke cadence accumulator

    this.keys = {};
    this.locked = false;
    this.enabled = true; // false while a UI (inventory) is open

    this._bindEvents();
  }

  _bindEvents() {
    this.dom.addEventListener('click', () => {
      Sound.resume(); // unlock audio on a user gesture
      if (!this.enabled) return; // don't grab the mouse while a UI is open
      if (!this.locked) this.dom.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Ignore spurious large jumps some browsers emit on pointer-lock entry.
      const mx = Math.abs(e.movementX) > 200 ? 0 : e.movementX;
      const my = Math.abs(e.movementY) > 200 ? 0 : e.movementY;
      this.targetYaw -= mx * SENSITIVITY;
      this.targetPitch -= my * SENSITIVITY;
      const lim = Math.PI / 2 - 0.01;
      this.targetPitch = Math.max(-lim, Math.min(lim, this.targetPitch));
    });
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'KeyF' && this.enabled) this.flying = !this.flying;
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
  }

  // Is the AABB at position p intersecting any solid block?
  _collides(p) {
    const minX = Math.floor(p.x - WIDTH / 2);
    const maxX = Math.floor(p.x + WIDTH / 2);
    const minY = Math.floor(p.y);
    const maxY = Math.floor(p.y + HEIGHT);
    const minZ = Math.floor(p.z - WIDTH / 2);
    const maxZ = Math.floor(p.z + WIDTH / 2);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (isSolid(this.world.getBlock(x, y, z))) return true;
        }
      }
    }
    return false;
  }

  // Move along one axis, stopping at the first collision.
  _moveAxis(axis, amount) {
    const next = this.pos.clone();
    next[axis] += amount;
    if (!this._collides(next)) {
      this.pos[axis] = next[axis];
      return false;
    }
    return true; // blocked
  }

  update(dt) {
    dt = Math.min(dt, 0.05); // clamp big frame gaps

    // Ease the rendered look angle toward the raw input target. Exponential
    // smoothing keeps it frame-rate independent and removes the snappy jitter.
    const t = 1 - Math.exp(-LOOK_SMOOTH * dt);
    this.yaw += (this.targetYaw - this.yaw) * t;
    this.pitch += (this.targetPitch - this.pitch) * t;

    // Movement input relative to yaw (ignored while a UI is open).
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const dir = new THREE.Vector3();
    if (this.enabled) {
      if (this.keys['KeyW']) dir.add(forward);
      if (this.keys['KeyS']) dir.sub(forward);
      if (this.keys['KeyD']) dir.add(right);
      if (this.keys['KeyA']) dir.sub(right);
      if (dir.lengthSq() > 0) dir.normalize();
    }

    if (this.flying) {
      const speed = FLY_SPEED;
      this.pos.x += dir.x * speed * dt;
      this.pos.z += dir.z * speed * dt;
      if (this.enabled && this.keys['Space']) this.pos.y += speed * dt;
      if (this.enabled && this.keys['ShiftLeft']) this.pos.y -= speed * dt;
      this.vel.set(0, 0, 0);
    } else {
      // In water if the lower body is in a water block (enables swimming).
      this.inWater = this.world.getBlock(
        Math.floor(this.pos.x), Math.floor(this.pos.y + 0.5), Math.floor(this.pos.z)
      ) === WATER;
      if (this.inWater && !this._wasInWater) Sound.splash(); // entered water

      const speed = this.inWater ? SWIM_SPEED : WALK_SPEED;
      this.vel.x = dir.x * speed;
      this.vel.z = dir.z * speed;

      if (this.inWater) {
        // Sink under gravity with gradual drag, so an incoming fall carries you
        // down a bit before settling to a slow sink. Space swims up.
        if (this.enabled && this.keys['Space']) {
          this.vel.y = SWIM_UP;
        } else {
          this.vel.y -= WATER_GRAVITY * dt;
          this.vel.y *= WATER_DRAG;
        }
      } else {
        this.vel.y -= GRAVITY * dt;
        if (this.enabled && this.keys['Space'] && this.onGround) {
          this.vel.y = JUMP_SPEED;
          this.onGround = false;
          Sound.jump();
        }
      }

      this._moveAxis('x', this.vel.x * dt);
      this._moveAxis('z', this.vel.z * dt);
      const blockedY = this._moveAxis('y', this.vel.y * dt);
      if (blockedY) {
        if (this.vel.y < 0) {
          // Just landed: report the fall distance from the tracked apex.
          if (!this.onGround && !this.inWater) {
            const fall = this._peakY - this.pos.y;
            if (fall > 0 && this.onLand) this.onLand(fall);
            Sound.land(this._belowCategory());
          }
          this.onGround = true;
        }
        this.vel.y = 0;
      } else {
        this.onGround = false;
      }
    }

    // Footsteps while walking on the ground.
    const movingFlat = Math.hypot(this.vel.x, this.vel.z) > 0.5;
    if (this.onGround && !this.flying && !this.inWater && movingFlat) {
      this._stepT += dt;
      if (this._stepT >= 0.34) { Sound.step(this._belowCategory()); this._stepT = 0; }
    } else {
      this._stepT = 0.34; // so the next step plays promptly
    }

    // Gentle swim strokes while moving in water.
    if (this.inWater && (movingFlat || (this.enabled && this.keys['Space']))) {
      this._swimT += dt;
      if (this._swimT >= 0.5) { Sound.swim(); this._swimT = 0; }
    } else if (!this.inWater) {
      this._swimT = 0.5;
    }
    this._wasInWater = this.inWater;

    // Track the apex of a fall/jump so we can measure landing distance. Water
    // cancels fall damage, so keep the apex pinned while swimming.
    if (this.flying || this.onGround || this.inWater) this._peakY = this.pos.y;
    else this._peakY = Math.max(this._peakY, this.pos.y);

    // Sync camera.
    this.camera.position.set(this.pos.x, this.pos.y + EYE, this.pos.z);
    const dirVec = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    this.camera.lookAt(this.camera.position.clone().add(dirVec));
  }

  _belowCategory() {
    const id = this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.1), Math.floor(this.pos.z));
    return soundCategory(id);
  }

  spawnAtSurface() {
    const spot = this.world.findSpawn();
    const h = this.world.surfaceHeight(spot.x, spot.z);
    this.pos.set(spot.x + 0.5, h + 2, spot.z + 0.5);
    this.vel.set(0, 0, 0);
    this._peakY = this.pos.y;
    this.onGround = false;
  }
}
