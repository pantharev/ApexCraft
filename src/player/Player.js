import * as THREE from 'three';
import { isSolid } from '../blocks/BlockRegistry.js';

// Player physics + first-person controls. Uses an AABB swept against the voxel
// grid for collision. Pointer lock drives camera look; WASD drives movement.
const WIDTH = 0.6; // half-extent ~0.3 each side
const HEIGHT = 1.8;
const EYE = 1.62;
const GRAVITY = 28;
const JUMP_SPEED = 9;
const WALK_SPEED = 5.5;
const FLY_SPEED = 12;

export class Player {
  constructor(world, camera, domElement) {
    this.world = world;
    this.camera = camera;
    this.dom = domElement;

    this.pos = new THREE.Vector3(0, 80, 0); // feet position
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;

    this.keys = {};
    this.locked = false;

    this._bindEvents();
  }

  _bindEvents() {
    this.dom.addEventListener('click', () => {
      if (!this.locked) this.dom.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      const lim = Math.PI / 2 - 0.01;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    });
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'KeyF') this.flying = !this.flying;
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

    // Movement input relative to yaw.
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const dir = new THREE.Vector3();
    if (this.keys['KeyW']) dir.add(forward);
    if (this.keys['KeyS']) dir.sub(forward);
    if (this.keys['KeyD']) dir.add(right);
    if (this.keys['KeyA']) dir.sub(right);
    if (dir.lengthSq() > 0) dir.normalize();

    if (this.flying) {
      const speed = FLY_SPEED;
      this.pos.x += dir.x * speed * dt;
      this.pos.z += dir.z * speed * dt;
      if (this.keys['Space']) this.pos.y += speed * dt;
      if (this.keys['ShiftLeft']) this.pos.y -= speed * dt;
      this.vel.set(0, 0, 0);
    } else {
      const speed = WALK_SPEED;
      this.vel.x = dir.x * speed;
      this.vel.z = dir.z * speed;
      this.vel.y -= GRAVITY * dt;
      if (this.keys['Space'] && this.onGround) {
        this.vel.y = JUMP_SPEED;
        this.onGround = false;
      }

      this._moveAxis('x', this.vel.x * dt);
      this._moveAxis('z', this.vel.z * dt);
      const blockedY = this._moveAxis('y', this.vel.y * dt);
      if (blockedY) {
        if (this.vel.y < 0) this.onGround = true;
        this.vel.y = 0;
      } else {
        this.onGround = false;
      }
    }

    // Sync camera.
    this.camera.position.set(this.pos.x, this.pos.y + EYE, this.pos.z);
    const dirVec = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
    this.camera.lookAt(this.camera.position.clone().add(dirVec));
  }

  spawnAtSurface() {
    const h = this.world.surfaceHeight(0, 0);
    this.pos.set(0.5, h + 2, 0.5);
  }
}
