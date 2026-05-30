import * as THREE from 'three';
import { World } from './World.js';
import { Player } from '../player/Player.js';
import { Interaction } from '../player/Interaction.js';
import { ItemDrops } from '../player/ItemDrops.js';
import { buildToolModel } from '../player/HeldItem.js';
import { getBlockId, getBlock } from '../blocks/BlockRegistry.js';
import { getItem } from '../items/ItemRegistry.js';
import { SEA_LEVEL } from '../config.js';

// Blocks the player can place, shown in the hotbar.
const HOTBAR = ['grass', 'dirt', 'stone', 'sand', 'gravel', 'oak_log', 'oak_leaves', 'snow', 'clay'];

// Tool cycle for the temporary T-key (until inventory/crafting exists). Bare
// hand first, then the pickaxe tiers.
const TOOL_CYCLE = [null, 'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'gold_pickaxe', 'diamond_pickaxe'];

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

    // Collected items (temporary store; replaced by the inventory in Phase 3).
    this.collected = new Map();
    this.itemDrops.onCollect = (name, count) => {
      this.collected.set(name, (this.collected.get(name) || 0) + count);
    };

    // Hotbar selection.
    this.hotbar = HOTBAR.map((name) => ({ name, id: getBlockId(name), color: getBlock(getBlockId(name)).color }));
    this.selectedIndex = 0;
    this._applySelection();
    this._bindHotbar();

    // First-person held tool view-model, parented to the camera so it tracks
    // the view. The camera must be in the scene graph to be lit/rendered.
    this.scene.add(this.camera);
    this.heldAnchor = new THREE.Group();
    this.heldAnchor.position.set(0.42, -0.38, -0.7);
    this.heldAnchor.rotation.set(0.1, -0.5, 0.2);
    this.camera.add(this.heldAnchor);
    this.heldModel = null;
    this.heldTime = 0;

    // Tool cycling (temporary).
    this.toolIndex = 0;
    this._updateHeldModel();
    this._bindTool();

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

  _applySelection() {
    this.interaction.selectedBlock = this.hotbar[this.selectedIndex].id;
  }

  _bindHotbar() {
    window.addEventListener('keydown', (e) => {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= this.hotbar.length) {
        this.selectedIndex = n - 1;
        this._applySelection();
      }
    });
    this.renderer.domElement.addEventListener('wheel', (e) => {
      if (document.pointerLockElement !== this.renderer.domElement) return;
      const dir = Math.sign(e.deltaY);
      this.selectedIndex = (this.selectedIndex + dir + this.hotbar.length) % this.hotbar.length;
      this._applySelection();
    });
  }

  _bindTool() {
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyT') return;
      this.toolIndex = (this.toolIndex + 1) % TOOL_CYCLE.length;
      const name = TOOL_CYCLE[this.toolIndex];
      this.interaction.currentTool = name ? getItem(name) : null;
      this._updateHeldModel();
    });
  }

  _updateHeldModel() {
    if (this.heldModel) {
      this.heldAnchor.remove(this.heldModel);
      this.heldModel.traverse((o) => o.geometry && o.geometry.dispose());
    }
    const name = TOOL_CYCLE[this.toolIndex];
    const item = name ? getItem(name) : null;
    this.heldModel = buildToolModel(name, item ? item.color : null);
    this.heldAnchor.add(this.heldModel);
  }

  start() {
    this._running = true;
    this.clock.start();
    this._loop();
  }

  _loop = () => {
    if (!this._running) return;
    const dt = this.clock.getDelta();

    this.player.update(dt);
    this.interaction.update(dt);
    this.itemDrops.update(dt, this.player.pos);
    this.world.update(this.player.pos.x, this.player.pos.z, 2);
    this._animateHeld(dt);
    this.renderer.render(this.scene, this.camera);

    if (this.onStats) {
      const p = this.player.pos;
      const tool = this.interaction.currentTool;
      this.onStats({
        x: p.x.toFixed(1),
        y: p.y.toFixed(1),
        z: p.z.toFixed(1),
        underwater: p.y + 1.6 < SEA_LEVEL,
        chunks: this.world.chunks.size,
        flying: this.player.flying,
        hotbar: this.hotbar,
        selectedIndex: this.selectedIndex,
        tool: tool ? tool.display : 'Hand',
        collected: Array.from(this.collected.entries()).map(([name, count]) => {
          const it = getItem(name);
          return { name, display: it ? it.display : name, color: it ? it.color : '#fff', count };
        }),
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
