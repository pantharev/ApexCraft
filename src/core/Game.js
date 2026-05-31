import * as THREE from 'three';
import { World } from './World.js';
import { Player } from '../player/Player.js';
import { Interaction } from '../player/Interaction.js';
import { ItemDrops } from '../player/ItemDrops.js';
import { buildHeldModel } from '../player/HeldItem.js';
import { Inventory } from '../player/Inventory.js';
import { Furnaces } from '../player/Furnaces.js';
import { getBlockId } from '../blocks/BlockRegistry.js';
import { getItem } from '../items/ItemRegistry.js';
import { SEA_LEVEL } from '../config.js';

// A small starter kit so placement and tools are usable before crafting exists
// (Phase 4). [item, count] pairs added to the inventory at spawn.
const STARTER_KIT = [
  ['stone_pickaxe', 1],
  ['iron_pickaxe', 1],
  ['diamond_pickaxe', 1],
  ['dirt', 64],
  ['cobblestone', 64],
  ['oak_log', 32],
];

// Owns the Three.js renderer/scene/camera, the World, and the Player, plus the
// requestAnimationFrame loop. Mounted by the React <App/> into a container div.
export class Game {
  constructor(container) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const skyColor = new THREE.Color('#87b6e8');
    this.scene.background = skyColor;
    this.scene.fog = new THREE.Fog(skyColor, 60, 140);

    this.camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );

    // Lighting: sky hemisphere + a directional "sun".
    const hemi = new THREE.HemisphereLight(0xffffff, 0x556677, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(50, 100, 30);
    this.scene.add(sun);

    this.world = new World(this.scene);
    this.player = new Player(this.world, this.camera, this.renderer.domElement);
    this.itemDrops = new ItemDrops(this.world, this.scene);
    this.interaction = new Interaction(
      this.world, this.player, this.camera, this.scene, this.renderer.domElement, this.itemDrops
    );

    // Inventory: mined drops flow in here; leftover (full) stays in the world.
    this.inventory = new Inventory();
    for (const [name, count] of STARTER_KIT) this.inventory.addItem(name, count);
    this.itemDrops.onCollect = (name, count) => this.inventory.addItem(name, count);

    // Placing a block consumes one of the selected stack.
    this.interaction.onPlaced = () => this.inventory.consumeSelected(1);

    // Per-position furnace state, smelting in the background.
    this.furnaces = new Furnaces();
    this.activeFurnace = null;

    // Right-clicking an interactive block opens its screen.
    this.interaction.onUseBlock = (name, pos) => {
      if (name === 'crafting_table') this.setScreen('crafting');
      else if (name === 'furnace') {
        this.activeFurnace = this.furnaces.get(pos.x, pos.y, pos.z);
        this.setScreen('furnace');
      }
    };

    // When a furnace is mined, drop its contents and discard its state.
    this.interaction.onBlockBroken = (name, pos) => {
      if (name !== 'furnace') return;
      const f = this.furnaces.peek(pos.x, pos.y, pos.z);
      if (f) {
        for (const s of [f.input, f.fuel, f.output]) {
          if (s) this.itemDrops.spawn(s.item, s.count, pos.x, pos.y, pos.z);
        }
        this.furnaces.remove(pos.x, pos.y, pos.z);
      }
    };

    // First-person held view-model, parented to the camera so it tracks the
    // view. The camera must be in the scene graph to be lit/rendered.
    this.scene.add(this.camera);
    this.heldAnchor = new THREE.Group();
    this.heldAnchor.position.set(0.42, -0.38, -0.7);
    this.heldAnchor.rotation.set(0.1, -0.5, 0.2);
    this.camera.add(this.heldAnchor);
    this.heldModel = null;
    this.heldTime = 0;
    this._heldName = undefined; // forces first build

    // Open UI screen: null | 'inventory' | 'crafting'. Drives pointer lock,
    // player input freeze, and which React panel renders.
    this.openScreen = null;
    this.onScreenChange = null; // React setter
    this._bindHotbar();
    this._bindScreens();

    // Pre-generate spawn area so the player doesn't fall through ungenerated
    // chunks, then place the player on the surface.
    this.world.update(0, 0, 80);
    this.player.spawnAtSurface();

    this.clock = new THREE.Clock();
    this._running = false;
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);

    this.onStats = null; // optional callback for HUD
  }

  _onResize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _bindHotbar() {
    window.addEventListener('keydown', (e) => {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 9) this.inventory.setSelected(n - 1);
    });
    this.renderer.domElement.addEventListener('wheel', (e) => {
      if (document.pointerLockElement !== this.renderer.domElement) return;
      this.inventory.cycleSelected(e.deltaY);
    });
  }

  _bindScreens() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyE') this.setScreen(this.openScreen ? null : 'inventory');
      else if (e.code === 'Escape' && this.openScreen) this.setScreen(null);
    });
  }

  setScreen(screen) {
    this.openScreen = screen;
    this.player.enabled = screen === null;
    if (screen) {
      document.exitPointerLock();
    } else {
      // Re-grab the mouse; ignore rejection (browser may decline right after exit).
      try {
        const r = this.renderer.domElement.requestPointerLock?.();
        if (r && r.catch) r.catch(() => {});
      } catch (_) { /* user can click to re-lock */ }
    }
    if (this.onScreenChange) this.onScreenChange(screen);
  }

  // Sync the held view-model + interaction targets to the selected hotbar slot.
  _syncHeld() {
    const stack = this.inventory.selectedStack();
    const item = stack ? getItem(stack.item) : null;
    const name = item ? item.name : null;

    this.interaction.currentTool = item && item.toolType ? item : null;
    this.interaction.selectedBlock = item && item.placeBlock ? getBlockId(item.placeBlock) : 0;

    if (name !== this._heldName) {
      this._heldName = name;
      if (this.heldModel) {
        this.heldAnchor.remove(this.heldModel);
        this.heldModel.traverse((o) => o.geometry && o.geometry.dispose());
      }
      this.heldModel = buildHeldModel(item);
      this.heldAnchor.add(this.heldModel);
    }
  }

  start() {
    this._running = true;
    this.clock.start();
    this._loop();
  }

  _loop = () => {
    if (!this._running) return;
    const dt = this.clock.getDelta();

    this._syncHeld();
    this.player.update(dt);
    this.interaction.update(dt);
    this.itemDrops.update(dt, this.player.pos);
    this.furnaces.update(dt);
    this.world.update(this.player.pos.x, this.player.pos.z, 2);
    this._animateHeld(dt);
    this.renderer.render(this.scene, this.camera);

    if (this.onStats) {
      const p = this.player.pos;
      const stack = this.inventory.selectedStack();
      const item = stack ? getItem(stack.item) : null;
      this.onStats({
        x: p.x.toFixed(1),
        y: p.y.toFixed(1),
        z: p.z.toFixed(1),
        underwater: p.y + 1.6 < SEA_LEVEL,
        chunks: this.world.chunks.size,
        flying: this.player.flying,
        held: item ? item.display : 'Empty hand',
      });
    }

    requestAnimationFrame(this._loop);
  };

  // Idle bob plus a fast back-and-forth swing while mining.
  _animateHeld(dt) {
    if (!this.heldModel) return;
    this.heldTime += dt;
    const bob = Math.sin(this.heldTime * 2) * 0.012;
    this.heldAnchor.position.y = -0.38 + bob;

    const baseRot = 0.1;
    if (this.interaction.breaking) {
      this.heldAnchor.rotation.x = baseRot - 0.5 + Math.sin(this.heldTime * 16) * 0.5;
    } else {
      // Ease back to rest.
      this.heldAnchor.rotation.x += (baseRot - this.heldAnchor.rotation.x) * Math.min(1, dt * 12);
    }
  }

  dispose() {
    this._running = false;
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
