import * as THREE from 'three';
import { raycastVoxel } from './Raycast.js';
import { getBlock, isSolid } from '../blocks/BlockRegistry.js';
import { getBlockId } from '../blocks/BlockRegistry.js';
import { Sound, soundCategory } from '../systems/Sound.js';
import { CRACK_MATERIALS, CRACK_STAGES } from '../textures/cracks.js';

const REACH = 6;
const BEDROCK = getBlockId('bedrock');

// Handles block targeting, breaking (hold left), and placing (right click).
// Maintains a wireframe highlight + a break-progress overlay box in the scene.
export class Interaction {
  constructor(world, player, camera, scene, domElement, itemDrops) {
    this.world = world;
    this.player = player;
    this.camera = camera;
    this.scene = scene;
    this.dom = domElement;
    this.itemDrops = itemDrops;

    this.selectedBlock = 0; // block id to place (0 = nothing placeable held)
    this.heldItem = null;   // full item def (doors/stairs place specially)
    this.currentTool = null; // null = bare hand (tier 0, speed 1)
    this.onPlaced = null; // called after a successful placement
    this.onUseBlock = null; // called when right-clicking an interactive block
    this.onBlockBroken = null; // called after a block is removed (name, coords)
    this.heldFood = 0; // food value of the held item (0 if not food)
    this.onEat = null; // called to consume held food
    this.onAttack = null; // returns true if a mob was hit (suppresses mining)
    this.target = null; // last raycast result
    this.breaking = false;
    this.breakProgress = 0;
    this._breakKey = null; // identity of block currently being broken
    this._mineSfxT = 0;    // throttles the mining "hit" sound

    // Highlight wireframe.
    const box = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 })
    );
    this.highlight.visible = false;
    scene.add(this.highlight);

    // Break-progress overlay: staged crack textures wrapped around the block.
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), CRACK_MATERIALS[0]);
    this.crack.visible = false;
    this._crackStage = 0;
    scene.add(this.crack);

    this._bind();
  }

  _bind() {
    this.dom.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== this.dom) return;
      if (e.button === 0) this.primaryDown();
      else if (e.button === 2) this.secondary();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.primaryUp();
    });
    // Suppress the context menu so right-click can place.
    this.dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Primary action (left mouse / mine button): attack a targeted mob, else
  // start breaking. Shared by mouse and touch input.
  primaryDown() {
    if (this.onAttack && this.onAttack()) return;
    this.breaking = true;
  }

  primaryUp() {
    this.breaking = false;
    this.breakProgress = 0;
    this._breakKey = null;
  }

  // Secondary action (right mouse / place button): use block or place.
  secondary() {
    this._rightClick();
  }

  // Touch tap: attack a targeted mob instantly, otherwise place/use.
  attackOrPlace() {
    if (this.onAttack && this.onAttack()) return;
    this._rightClick();
  }

  // Touch hold: start mining only (no mob attack — that's the tap).
  startMining() {
    this.breaking = true;
  }

  // Right-click: toggle a door, use an interactive block (crafting table,
  // furnace, chest, bed), or place the held block.
  _rightClick() {
    if (this.target) {
      const b = this.target.block;
      const block = getBlock(this.world.getBlock(b.x, b.y, b.z));
      if (block.door) {
        this._toggleDoor(b, block);
        return;
      }
      if (block.interactive && this.onUseBlock) {
        this.onUseBlock(block.name, b);
        return;
      }
    }
    if (this.selectedBlock) {
      this._place();
    } else if (this.heldFood > 0 && this.onEat) {
      this.onEat();
    }
  }

  // Swing a door (both halves) between closed and open.
  _toggleDoor(b, block) {
    const newId = getBlockId(block.name === 'door' ? 'door_open' : 'door');
    this.world.setBlock(b.x, b.y, b.z, newId);
    if (getBlock(this.world.getBlock(b.x, b.y + 1, b.z)).door) {
      this.world.setBlock(b.x, b.y + 1, b.z, newId);
    }
    if (getBlock(this.world.getBlock(b.x, b.y - 1, b.z)).door) {
      this.world.setBlock(b.x, b.y - 1, b.z, newId);
    }
    Sound.door(block.name === 'door');
  }

  _place() {
    if (!this.target || !this.selectedBlock) return; // nothing placeable held
    const p = this.target.place;
    if (isSolid(this.world.getBlock(p.x, p.y, p.z))) return;
    if (this._overlapsPlayer(p.x, p.y, p.z)) return;

    const item = this.heldItem;
    if (item && item.door) {
      // Doors are two blocks tall — both cells must be free.
      if (isSolid(this.world.getBlock(p.x, p.y + 1, p.z))) return;
      if (this._overlapsPlayer(p.x, p.y + 1, p.z)) return;
      const id = getBlockId('door');
      this.world.setBlock(p.x, p.y, p.z, id);
      this.world.setBlock(p.x, p.y + 1, p.z, id);
    } else if (item && item.stairs) {
      // Stairs ascend away from the player (in the look direction).
      const fx = -Math.sin(this.player.yaw), fz = -Math.cos(this.player.yaw);
      const name = Math.abs(fx) > Math.abs(fz)
        ? (fx > 0 ? 'oak_stairs_px' : 'oak_stairs_nx')
        : (fz > 0 ? 'oak_stairs_pz' : 'oak_stairs_nz');
      this.world.setBlock(p.x, p.y, p.z, getBlockId(name));
    } else {
      this.world.setBlock(p.x, p.y, p.z, this.selectedBlock);
    }
    Sound.place(soundCategory(this.selectedBlock));
    if (this.onPlaced) this.onPlaced();
  }

  // Remove a block and spawn its drops. If the block requires a tool the
  // player lacks (wrong type or too low a tier), it breaks with no drop.
  _breakBlock(block, b) {
    // Doors: breaking either half removes both, dropping one door item.
    if (block.door) {
      this.world.setBlock(b.x, b.y, b.z, 0);
      if (getBlock(this.world.getBlock(b.x, b.y + 1, b.z)).door) this.world.setBlock(b.x, b.y + 1, b.z, 0);
      if (getBlock(this.world.getBlock(b.x, b.y - 1, b.z)).door) this.world.setBlock(b.x, b.y - 1, b.z, 0);
      Sound.dig(soundCategory(getBlockId('oak_planks')), 1);
      if (this.onBlockBroken) this.onBlockBroken(block.name, b);
      if (this.itemDrops) this.itemDrops.spawn('door', 1, b.x, b.y, b.z);
      return;
    }

    this.world.setBlock(b.x, b.y, b.z, 0);
    Sound.dig(soundCategory(getBlockId(block.name)), 1); // break sound
    if (this.onBlockBroken) this.onBlockBroken(block.name, b);

    // A plant sitting on this block loses its support and pops too.
    const above = getBlock(this.world.getBlock(b.x, b.y + 1, b.z));
    if (above.plant) {
      this.world.setBlock(b.x, b.y + 1, b.z, 0);
      this._spawnDrops(above, { x: b.x, y: b.y + 1, z: b.z }, true);
    }

    this._spawnDrops(block, b, false);
  }

  _spawnDrops(block, b, ignoreTool) {
    const drops = block.drops || [];
    if (drops.length === 0) return;

    if (!ignoreTool && block.requiresTool) {
      const tool = this.currentTool;
      const ok = tool && tool.toolType === block.requiresTool && tool.tier >= (block.minToolTier || 1);
      if (!ok) return; // no drop without the proper tool
    }

    for (const d of drops) {
      const [lo, hi] = Array.isArray(d.count) ? d.count : [d.count, d.count];
      const count = lo + Math.floor(Math.random() * (hi - lo + 1));
      if (count > 0 && this.itemDrops) {
        this.itemDrops.spawn(d.item, count, b.x, b.y, b.z);
      }
    }
  }

  // Would a block at (bx,by,bz) intersect the player's AABB? Prevents
  // placing a block inside yourself.
  _overlapsPlayer(bx, by, bz) {
    const pos = this.player.pos;
    const minX = pos.x - 0.3, maxX = pos.x + 0.3;
    const minY = pos.y, maxY = pos.y + 1.8;
    const minZ = pos.z - 0.3, maxZ = pos.z + 0.3;
    return (
      bx + 1 > minX && bx < maxX &&
      by + 1 > minY && by < maxY &&
      bz + 1 > minZ && bz < maxZ
    );
  }

  update(dt) {
    // Cast from the camera along its view direction.
    const origin = this.camera.position;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    this.target = raycastVoxel(this.world, origin, dir, REACH);

    if (!this.target) {
      this.highlight.visible = false;
      this.crack.visible = false;
      this.breakProgress = 0;
      this._breakKey = null;
      return;
    }

    const b = this.target.block;
    this.highlight.visible = true;
    this.highlight.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5);

    const id = this.world.getBlock(b.x, b.y, b.z);
    const block = getBlock(id);
    const key = `${b.x},${b.y},${b.z}`;

    // Reset progress if the player retargets a different block.
    if (key !== this._breakKey) {
      this.breakProgress = 0;
      this._breakKey = key;
    }

    if (this.breaking && id !== BEDROCK && block.hardness >= 0) {
      // Mining speed: the right tool (required or preferred) grants its
      // multiplier, otherwise 1x.
      const tool = this.currentTool;
      const matches = tool && (block.requiresTool === tool.toolType || block.preferredTool === tool.toolType);
      const speed = matches ? tool.miningSpeed : 1;
      const breakTime = Math.max(0.1, (block.hardness ?? 1) * 0.75 / speed);
      this.breakProgress += dt / breakTime;
      if (this.breakProgress >= 1) {
        this._breakBlock(block, b);
        this.breakProgress = 0;
        this._breakKey = null;
        this.crack.visible = false;
        return;
      }
      this.crack.visible = true;
      this.crack.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5);
      const stage = Math.min(CRACK_STAGES - 1, (this.breakProgress * CRACK_STAGES) | 0);
      if (stage !== this._crackStage) { this._crackStage = stage; this.crack.material = CRACK_MATERIALS[stage]; }
      // Periodic "hit" sound while mining.
      this._mineSfxT -= dt;
      if (this._mineSfxT <= 0) { Sound.dig(soundCategory(id), 0.5); this._mineSfxT = 0.22; }
    } else {
      this.crack.visible = false;
    }
  }
}
