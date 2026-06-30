import * as THREE from 'three';
import { isSolid, getBlock, getBlockId } from '../blocks/BlockRegistry.js';
import { Sound, soundCategory } from '../systems/Sound.js';

const WATER = getBlockId('water');
const LAVA = getBlockId('lava');

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
// Lava is thick and sticky: you wade slowly and sink slowly, with a weak
// struggle upward — enough time to claw out before it burns you to death.
const LAVA_SPEED = 2.2;
const LAVA_GRAVITY = 9;
const LAVA_DRAG = 0.78;   // heavier drag than water -> slow, sluggish sink
const LAVA_UP = 4;        // weaker than water's swim-up
const SENSITIVITY = 0.0014; // radians per pixel of mouse movement
const TOUCH_SENSITIVITY = 0.004; // radians per pixel of touch drag
const LOOK_SMOOTH = 18; // higher = snappier; lower = floatier

export class Player {
  constructor(world, camera, domElement) {
    this.world = world;
    this.camera = camera;
    this.dom = domElement;

    this.pos = new THREE.Vector3(0, 80, 0); // feet position
    this.vel = new THREE.Vector3();
    this.impulse = new THREE.Vector3(); // knockback push, decays over ~half a second
    this.yaw = 0;
    this.pitch = 0;
    this.targetYaw = 0; // raw input target; rendered yaw eases toward this
    this.targetPitch = 0;
    this.onGround = false;
    this.flying = false;
    this._peakY = this.pos.y; // highest point since last on ground (fall damage)
    this.onLand = null; // (fallDistance) => void
    this.inWater = false;
    this.inLava = false;
    this._wasInWater = false;
    this._stepT = 0; // footstep cadence accumulator
    this._swimT = 0; // swim-stroke cadence accumulator
    this._touchMove = null; // {x, z} analog move vector from a touch joystick

    this.keys = {};
    this.locked = false;
    this.enabled = true; // false while a UI (inventory) is open
    this.speedBoost = 1; // dev: walk/fly speed multiplier (G on localhost)
    this.thirdPerson = false; // orbit camera (hide & seek: hiders see their block)
    this.camDist = 4;        // third-person camera pull-back distance

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

  // Is the AABB at position p intersecting any solid block? Slabs only fill
  // the lower half of their cell, so you can stand on them at half height.
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
          const id = this.world.getBlock(x, y, z);
          if (!isSolid(id)) continue;
          if (getBlock(id).slab) {
            if (p.y < y + 0.5 && p.y + HEIGHT > y) return true;
            continue;
          }
          return true;
        }
      }
    }
    return false;
  }

  // Move along one axis, stopping at the first collision. Horizontal moves
  // blocked by a stair block auto-step up onto it (walls still need a jump).
  _moveAxis(axis, amount) {
    const next = this.pos.clone();
    next[axis] += amount;
    if (!this._collides(next)) {
      this.pos[axis] = next[axis];
      return false;
    }
    if (axis !== 'y' && this.onGround && !this.flying) {
      const rise = this._stepRise(next);
      if (rise > 0) {
        const up = next.clone();
        up.y = this.pos.y + rise;
        if (!this._collides(up)) {
          this.pos[axis] = next[axis];
          this.pos.y = up.y;
          this._peakY = Math.max(this._peakY, this.pos.y); // no fall credit
          return false;
        }
      }
    }
    return true; // blocked
  }

  // Step height granted by whatever blocks the foot layer of the AABB at p:
  // stairs allow a full-block step, slabs a half step, anything else none.
  _stepRise(p) {
    const y = Math.floor(p.y + 0.01);
    const minX = Math.floor(p.x - WIDTH / 2), maxX = Math.floor(p.x + WIDTH / 2);
    const minZ = Math.floor(p.z - WIDTH / 2), maxZ = Math.floor(p.z + WIDTH / 2);
    let rise = 0;
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const def = getBlock(this.world.getBlock(x, y, z));
        if (def.stair) rise = Math.max(rise, 1.001);
        else if (def.slab) rise = Math.max(rise, 0.501);
      }
    }
    return rise;
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
      if (this._touchMove) {
        // Analog joystick: keep magnitude (partial tilt = slower).
        dir.add(forward.clone().multiplyScalar(this._touchMove.z));
        dir.add(right.clone().multiplyScalar(this._touchMove.x));
        if (dir.lengthSq() > 1) dir.normalize();
      } else {
        if (this.keys['KeyW']) dir.add(forward);
        if (this.keys['KeyS']) dir.sub(forward);
        if (this.keys['KeyD']) dir.add(right);
        if (this.keys['KeyA']) dir.sub(right);
        if (dir.lengthSq() > 0) dir.normalize();
      }
    }

    if (this.flying) {
      const speed = FLY_SPEED * this.speedBoost;
      this.pos.x += dir.x * speed * dt;
      this.pos.z += dir.z * speed * dt;
      if (this.enabled && this.keys['Space']) this.pos.y += speed * dt;
      if (this.enabled && this.keys['ShiftLeft']) this.pos.y -= speed * dt;
      this.vel.set(0, 0, 0);
    } else {
      // Fluid the lower body sits in: water enables swimming, lava wades slowly.
      const bodyBlock = this.world.getBlock(
        Math.floor(this.pos.x), Math.floor(this.pos.y + 0.5), Math.floor(this.pos.z)
      );
      this.inWater = bodyBlock === WATER;
      this.inLava = bodyBlock === LAVA;
      if (this.inWater && !this._wasInWater) Sound.splash(); // entered water

      const speed = (this.inWater ? SWIM_SPEED : this.inLava ? LAVA_SPEED : WALK_SPEED) * this.speedBoost;
      // Input velocity plus any knockback impulse still in flight.
      this.vel.x = dir.x * speed + this.impulse.x;
      this.vel.z = dir.z * speed + this.impulse.z;
      const decay = Math.exp(-7 * dt);
      this.impulse.x *= decay;
      this.impulse.z *= decay;
      if (Math.abs(this.impulse.x) + Math.abs(this.impulse.z) < 0.05) this.impulse.set(0, 0, 0);

      // Ladders: grab on when the body overlaps one — climb with W/Space,
      // descend with S/Shift, otherwise slide down slowly. No gravity.
      const midBlock = this.world.getBlock(
        Math.floor(this.pos.x), Math.floor(this.pos.y + 0.6), Math.floor(this.pos.z)
      );
      const onLadder = !this.inWater && !this.inLava && getBlock(midBlock).climbable;

      if (onLadder) {
        if (this.enabled && (this.keys['KeyW'] || this.keys['Space'])) this.vel.y = 3.6;
        else if (this.enabled && (this.keys['KeyS'] || this.keys['ShiftLeft'])) this.vel.y = -3.2;
        else this.vel.y = Math.max(this.vel.y - GRAVITY * dt, -1.4); // gentle slide
        this._peakY = this.pos.y; // ladders cancel fall damage
      } else if (this.inWater) {
        // Sink under gravity with gradual drag, so an incoming fall carries you
        // down a bit before settling to a slow sink. Space swims up.
        if (this.enabled && this.keys['Space']) {
          this.vel.y = SWIM_UP;
        } else {
          this.vel.y -= WATER_GRAVITY * dt;
          this.vel.y *= WATER_DRAG;
        }
      } else if (this.inLava) {
        // Thick and sticky: sink slowly under heavy drag; Space struggles up.
        if (this.enabled && this.keys['Space']) {
          this.vel.y = LAVA_UP;
        } else {
          this.vel.y -= LAVA_GRAVITY * dt;
          this.vel.y *= LAVA_DRAG;
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
          if (!this.onGround && !this.inWater && !this.inLava) {
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
    if (this.onGround && !this.flying && !this.inWater && !this.inLava && movingFlat) {
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
    // and lava cancel fall damage, so keep the apex pinned while wading.
    if (this.flying || this.onGround || this.inWater || this.inLava) this._peakY = this.pos.y;
    else this._peakY = Math.max(this._peakY, this.pos.y);

    // Sync camera.
    const dirVec = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    if (this.thirdPerson) {
      // Orbit behind/above the feet so the player can see their own disguise
      // block. Pull back along the look direction, clamped above the floor.
      const target = new THREE.Vector3(this.pos.x, this.pos.y + 0.6, this.pos.z);
      this.camera.position.copy(target).addScaledVector(dirVec, -this.camDist);
      this.camera.position.y = Math.max(this.camera.position.y, this.pos.y + 0.4);
      this.camera.lookAt(target);
    } else {
      this.camera.position.set(this.pos.x, this.pos.y + EYE, this.pos.z);
      this.camera.lookAt(this.camera.position.clone().add(dirVec));
    }
  }

  // Shove the player away from an attacker: horizontal impulse + a hop.
  // (dx, dz) is the push direction (any length); ignored while flying.
  knockback(dx, dz, power = 7) {
    if (this.flying) return;
    const len = Math.hypot(dx, dz) || 1;
    this.impulse.x = (dx / len) * power;
    this.impulse.z = (dz / len) * power;
    if (!this.inWater) this.vel.y = Math.max(this.vel.y, 4.5);
    else this.vel.y = Math.max(this.vel.y, 2);
  }

  // Touch joystick: x = strafe (-1..1), z = forward (+1 = forward).
  setTouchMove(x, z) {
    this._touchMove = (Math.abs(x) > 0.02 || Math.abs(z) > 0.02) ? { x, z } : null;
  }

  // Touch drag look (pixels).
  look(dx, dy) {
    this.targetYaw -= dx * TOUCH_SENSITIVITY;
    const lim = Math.PI / 2 - 0.01;
    this.targetPitch = Math.max(-lim, Math.min(lim, this.targetPitch - dy * TOUCH_SENSITIVITY));
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
