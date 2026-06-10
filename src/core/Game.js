import * as THREE from 'three';
import { World } from './World.js';
import { Player } from '../player/Player.js';
import { Interaction } from '../player/Interaction.js';
import { ItemDrops } from '../player/ItemDrops.js';
import { buildHeldModel } from '../player/HeldItem.js';
import { Inventory } from '../player/Inventory.js';
import { Furnaces } from '../player/Furnaces.js';
import { ChestStorage } from '../player/ChestStorage.js';
import { Vitals } from '../player/Vitals.js';
import { DayNight } from '../systems/DayNight.js';
import { MobManager } from '../systems/MobManager.js';
import { TorchLights } from '../systems/TorchLights.js';
import { Projectiles } from '../systems/Projectiles.js';
import { RemotePlayers } from '../net/RemotePlayers.js';
import { GhostMobs } from '../net/GhostMobs.js';
import { Sound } from '../systems/Sound.js';
import { saveWorld } from '../systems/Storage.js';
import { WORLD_SEED } from '../config.js';
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
  ['apple', 8],
  ['torch', 16],
  ['stone_sword', 1],
  ['chest', 2],
  ['bow', 1],
  ['arrow', 32],
];

// Owns the Three.js renderer/scene/camera, the World, and the Player, plus the
// requestAnimationFrame loop. Mounted by the React <App/> into a container div.
export class Game {
  constructor(container, save = null, net = null) {
    this.container = container;
    this._save = save || null;
    this.net = net; // multiplayer connection (null = single-player)
    // Guests (and migrated hosts) play someone else's world — don't persist it.
    this._canPersist = !net || net.isOrigin;
    this.worldId = save?.id || 'default';
    this.worldName = save?.name || 'World';
    this.seed = save?.seed ?? WORLD_SEED;
    this.dev = typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname);
    this._devTime = 0; // 0 = auto, 1 = day, 2 = night

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    const skyColor = new THREE.Color('#87b6e8');
    this.scene.background = skyColor;
    this.scene.fog = new THREE.Fog(skyColor, 90, 200);

    this.camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );

    // Lighting: sky hemisphere + a directional "sun" (driven by DayNight).
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x556677, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 0.8);
    this.sun.position.set(50, 100, 30);
    this.scene.add(this.sun);

    this.world = new World(this.scene);
    // Replay saved block edits before any terrain is generated.
    if (this._save) this.world.loadEdits(this._save.edits);
    this.player = new Player(this.world, this.camera, this.renderer.domElement);
    this.itemDrops = new ItemDrops(this.world, this.scene);
    this.interaction = new Interaction(
      this.world, this.player, this.camera, this.scene, this.renderer.domElement, this.itemDrops
    );

    // Inventory: mined drops flow in here; leftover (full) stays in the world.
    this.inventory = new Inventory();
    if (this._save?.inventory) this.inventory.load(this._save.inventory);
    else for (const [name, count] of STARTER_KIT) this.inventory.addItem(name, count);
    this.itemDrops.onCollect = (name, count) => this.inventory.addItem(name, count);

    // Placing a block consumes one of the selected stack.
    this.interaction.onPlaced = () => this.inventory.consumeSelected(1);

    // Survival stats + the damage/eat/death hooks.
    this.vitals = new Vitals(this.player, this.world);
    this.onDead = null; // React setter for the death overlay
    this.player.onLand = (fall) => this.vitals.applyFall(fall);
    this.interaction.onEat = () => {
      const stack = this.inventory.selectedStack();
      const item = stack && getItem(stack.item);
      if (item && item.food) {
        this.vitals.eat(item.food);
        this.inventory.consumeSelected(1);
        Sound.eat();
      }
    };
    this.vitals.onDeath = () => this._handleDeath();
    this.onPlayerHurt = null; // React red-flash callback
    this.vitals.onDamage = () => { if (this.onPlayerHurt) this.onPlayerHurt(); };

    // Survival stats restore.
    if (this._save?.vitals) this.vitals.load(this._save.vitals);

    // Day/night cycle + mobs.
    this.dayNight = new DayNight(this.scene, this.sun, this.hemi, this.camera);
    if (this._save?.time != null) { this.dayNight.t = this._save.time; this.dayNight.update(0); }
    this.mobs = new MobManager(this.world, this.scene, this.itemDrops);
    this.torchLights = new TorchLights(this.scene, this.world);
    this.projectiles = new Projectiles(this.world, this.scene);

    // Multiplayer: remote avatars, guest-side mob ghosts, and event wiring.
    this.remotePlayers = null;
    this.ghostMobs = null;
    if (net) {
      this.remotePlayers = new RemotePlayers(this.scene);
      this.ghostMobs = new GhostMobs(this.scene, net);
      for (const [id, p] of net.players) this.remotePlayers.add(id, p.name);

      // Local edits broadcast; remote edits apply with the echo suppressed.
      this.world.onEdit = (x, y, z, id) => { if (!net.applying) net.sendEdit(x, y, z, id); };
      net.onEdit = (x, y, z, id) => {
        net.applying = true;
        this.world.setBlock(x, y, z, id);
        net.applying = false;
      };
      net.onPlayerJoined = (p) => this.remotePlayers.add(p.id, p.name);
      net.onPlayerLeft = (p) => this.remotePlayers.remove(p.id);
      net.onPlayerState = (s) => this.remotePlayers.setState(s);
      net.onMobs = (snap) => { if (!net.isHost) this.ghostMobs.apply(snap); };
      net.onProjectile = (p) => {
        this.projectiles.spawn(p.x, p.y, p.z, new THREE.Vector3(p.dx, p.dy, p.dz), p.speed, p.dmg || 0, p.target);
        Sound.shoot();
      };
      net.onHitPlayer = (dmg) => this.vitals.damage(dmg);
      net.onMobHit = (m) => { // a guest hit one of our simulated mobs
        const mob = this.mobs.byId(m.i);
        if (mob) { mob.takeDamage(m.dmg, new THREE.Vector3(m.x, m.y, m.z)); Sound.mobHurt(); }
      };
      net.onBecomeHost = () => this.ghostMobs.clear(); // our MobManager takes over
      net.onTime = (t) => { this.dayNight.t = t; };
      this._netT = 0;     // player-state send accumulator (~15 Hz)
      this._mobNetT = 0;  // mob snapshot accumulator (~10 Hz)
      this._timeNetT = 0; // clock sync accumulator (every 5 s)
    }

    // Dev-only (localhost): press T to cycle day -> night -> auto.
    if (this.dev) {
      window.addEventListener('keydown', (e) => {
        if (e.code !== 'KeyT') return;
        this._devTime = (this._devTime + 1) % 3;
        if (this._devTime === 1) { this.dayNight.t = 0.25; this.dayNight.frozen = true; }
        else if (this._devTime === 2) { this.dayNight.t = 0.78; this.dayNight.frozen = true; }
        else { this.dayNight.frozen = false; }
        this.dayNight.update(0);
      });
    }

    this.interaction.onAttack = () => {
      // Holding a bow fires an arrow instead of meleeing.
      const stack = this.inventory.selectedStack();
      if (stack && stack.item === 'bow') { this._shootBow(); return true; }

      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const mob = this._mobApi().raycast(this.camera.position, dir, 4);
      Sound.swing();
      if (!mob) return false;
      const tool = this.interaction.currentTool;
      mob.takeDamage(tool && tool.attackDamage ? tool.attackDamage : 1, this.player.pos);
      Sound.mobHurt();
      return true;
    };

    // Per-position furnace + chest state.
    this.furnaces = new Furnaces();
    if (this._save?.furnaces) this.furnaces.load(this._save.furnaces);
    this.activeFurnace = null;
    this.chests = new ChestStorage();
    if (this._save?.chests) this.chests.load(this._save.chests);
    this.activeChest = null;

    // Right-clicking an interactive block opens its screen.
    this.interaction.onUseBlock = (name, pos) => {
      if (name === 'crafting_table') this.setScreen('crafting');
      else if (name === 'furnace') {
        this.activeFurnace = this.furnaces.get(pos.x, pos.y, pos.z);
        this.setScreen('furnace');
      } else if (name === 'chest') {
        this.activeChest = this.chests.open(this.world, pos.x, pos.y, pos.z);
        this.setScreen('chest');
      }
    };

    // When a furnace/chest is mined, drop its contents and discard its state.
    this.interaction.onBlockBroken = (name, pos) => {
      if (name === 'furnace') {
        const f = this.furnaces.peek(pos.x, pos.y, pos.z);
        if (f) {
          for (const s of [f.input, f.fuel, f.output]) {
            if (s) this.itemDrops.spawn(s.item, s.count, pos.x, pos.y, pos.z);
          }
          this.furnaces.remove(pos.x, pos.y, pos.z);
        }
      } else if (name === 'chest') {
        const c = this.chests.peek(pos.x, pos.y, pos.z);
        if (c) {
          for (const s of c.slots) if (s) this.itemDrops.spawn(s.item, s.count, pos.x, pos.y, pos.z);
          this.chests.remove(pos.x, pos.y, pos.z);
        }
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
    // chunks, then place the player. For a loaded game, generate around the
    // saved position so the player doesn't briefly fall through ungenerated land.
    if (this._save?.player) {
      this._restorePlayer(this._save.player);
      this.world.update(this.player.pos.x, this.player.pos.z, 80);
    } else {
      this.world.update(0, 0, 80);
      this.player.spawnAtSurface();
    }

    this.clock = new THREE.Clock();
    this._autosaveTimer = 0;
    this._running = false;
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    // Track the container so the canvas sizes correctly even if it's laid out
    // (or resized) after construction.
    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(this.container);
    this._onResize();

    // Best-effort save when the tab closes.
    this._onUnload = () => { if (!this.vitals.dead && this._canPersist) saveWorld(this.worldId, this.serialize()); };
    window.addEventListener('beforeunload', this._onUnload);

    this.onStats = null;  // optional callback for HUD
    this.onSaved = null;  // optional callback when a save completes
  }

  // Mob interface for attacks/projectiles: guests target the ghost mirror of
  // the host's simulation; hosts and single-player target the real mobs.
  _mobApi() {
    return this.net && !this.net.isHost ? this.ghostMobs : this.mobs;
  }

  _onResize() {
    // Fall back to the window if the container hasn't been laid out yet, and
    // guard against a zero height (which would make the aspect NaN).
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight || 1;
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
      else if (e.code === 'KeyM') Sound.toggle();
    });
  }

  setScreen(screen) {
    this.openScreen = screen;
    this.player.enabled = screen === null;
    if (screen) {
      Sound.container();
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

  // Mobile play/pause (no pointer lock). Freezes the player when paused.
  setTouchActive(active) {
    this.player.enabled = active;
    if (active) Sound.resume();
  }

  // On death: scatter the whole inventory as drops, freeze the player, and
  // raise the death overlay.
  _handleDeath() {
    const p = this.player.pos;
    for (let i = 0; i < this.inventory.slots.length; i++) {
      const s = this.inventory.slots[i];
      if (s) this.itemDrops.spawn(s.item, s.count, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      this.inventory.slots[i] = null;
    }
    this.inventory.notify();
    this.player.enabled = false;
    this.openScreen = null;
    this.activeFurnace = null;
    if (this.onScreenChange) this.onScreenChange(null);
    Sound.death();
    document.exitPointerLock();
    if (this.onDead) this.onDead(true);
  }

  _restorePlayer(p) {
    this.player.pos.set(p.x, p.y, p.z);
    this.player.vel.set(0, 0, 0);
    this.player.yaw = this.player.targetYaw = p.yaw || 0;
    this.player.pitch = this.player.targetPitch = p.pitch || 0;
    this.player._peakY = p.y;
  }

  // Bundle the whole world/player state for persistence. In multiplayer the
  // host's edits map already includes everyone's changes (applied via
  // setBlock), so the shared world persists with the host's save.
  serialize() {
    const p = this.player.pos;
    return {
      id: this.worldId,
      name: this.worldName,
      seed: this.seed,
      lastPlayed: Date.now(),
      edits: this.world.serializeEdits(),
      player: { x: p.x, y: p.y, z: p.z, yaw: this.player.yaw, pitch: this.player.pitch },
      vitals: this.vitals.serialize(),
      inventory: this.inventory.serialize(),
      furnaces: this.furnaces.serialize(),
      chests: this.chests.serialize(),
      time: this.dayNight.t,
    };
  }

  async save() {
    if (!this._canPersist) return false; // guests don't own this world
    if (this.vitals.dead) return false; // don't persist a mid-death state
    const ok = await saveWorld(this.worldId, this.serialize());
    if (ok && this.onSaved) this.onSaved();
    return ok;
  }

  // Fire an arrow from the camera if the player has ammo.
  _shootBow() {
    if (this.inventory.count('arrow') <= 0) return;
    this.inventory.removeItems('arrow', 1);
    this.inventory.notify();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const o = this.camera.position;
    this.projectiles.spawn(o.x, o.y, o.z, dir, 30, 5, 'mob');
    Sound.shoot();
    // Co-op: others see the arrow fly, but it can't hurt them (no PvP).
    if (this.net) {
      this.net.sendProjectile({ x: o.x, y: o.y, z: o.z, dx: dir.x, dy: dir.y, dz: dir.z, speed: 30, dmg: 0, target: 'none' });
    }
  }

  respawn() {
    this.vitals.reset();
    this.player.spawnAtSurface();
    this.player.enabled = true;
    if (this.onDead) this.onDead(false);
    try {
      const r = this.renderer.domElement.requestPointerLock?.();
      if (r && r.catch) r.catch(() => {});
    } catch (_) { /* user can click to re-lock */ }
  }

  // Sync the held view-model + interaction targets to the selected hotbar slot.
  _syncHeld() {
    const stack = this.inventory.selectedStack();
    const item = stack ? getItem(stack.item) : null;
    const name = item ? item.name : null;

    this.interaction.currentTool = item && item.toolType ? item : null;
    this.interaction.selectedBlock = item && item.placeBlock ? getBlockId(item.placeBlock) : 0;
    this.interaction.heldFood = item && item.food ? item.food : 0;

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
    this.vitals.update(dt);
    this.dayNight.update(dt);
    this.torchLights.update(this.player.pos);
    const isGuest = this.net && !this.net.isHost;
    if (isGuest) {
      // Guests mirror the host's mob simulation instead of running their own.
      this.ghostMobs.update(dt);
    } else {
      this.mobs.update(dt, {
        playerPos: this.player.pos,
        // Host: mobs hunt every player in the room.
        players: this.net
          ? [{ id: 'self', pos: this.player.pos }, ...this.remotePlayers.list()]
          : null,
        isNight: this.dayNight.isNight,
        attackPlayer: (dmg, id = 'self') => {
          if (id === 'self' || !this.net) this.vitals.damage(dmg);
          else this.net.sendHitPlayer(id, dmg); // melee hit on a remote player
        },
        shoot: (sx, sy, sz, dx, dy, dz, dmg) => {
          this.projectiles.spawn(sx, sy, sz, new THREE.Vector3(dx, dy, dz), 22, dmg, 'player');
          Sound.shoot();
          // Guests simulate the same arrow locally so it can hit *them*.
          if (this.net) this.net.sendProjectile({ x: sx, y: sy, z: sz, dx, dy, dz, speed: 22, dmg, target: 'player' });
        },
      });
    }
    this.projectiles.update(dt, {
      playerPos: this.player.pos,
      hitPlayer: (dmg) => this.vitals.damage(dmg),
      mobs: this._mobApi(),
    });

    // Multiplayer sync: our transform at ~15 Hz; host adds mob snapshots
    // (~10 Hz) and the world clock (every 5 s).
    if (this.net) {
      this.remotePlayers.update(dt);
      this._netT += dt;
      if (this._netT >= 1 / 15) {
        this._netT = 0;
        const p = this.player.pos;
        this.net.sendState({
          x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
          yaw: +this.player.yaw.toFixed(3), pitch: +this.player.pitch.toFixed(3),
        });
      }
      if (this.net.isHost) {
        this._mobNetT += dt;
        if (this._mobNetT >= 0.1) { this._mobNetT = 0; this.net.sendMobs(this.mobs.snapshot()); }
        this._timeNetT += dt;
        if (this._timeNetT >= 5) { this._timeNetT = 0; this.net.sendTime(this.dayNight.t); }
      }
    }
    this.world.update(this.player.pos.x, this.player.pos.z, 3);
    this._animateHeld(dt);
    this.renderer.render(this.scene, this.camera);

    // Autosave every 15s (hosts/single-player only; guests don't own the world).
    this._autosaveTimer += dt;
    if (this._autosaveTimer >= 15) {
      this._autosaveTimer = 0;
      if (this._canPersist) this.save();
    }

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
        health: this.vitals.health,
        hunger: this.vitals.hunger,
        air: this.vitals.air,
        submerged: this.vitals.submerged,
        clock: this.dayNight.clock(),
        night: this.dayNight.isNight,
        mobs: this._mobApi().mobs.length,
        dev: this.dev,
        devTime: ['Auto', 'Day', 'Night'][this._devTime],
        room: this.net ? this.net.code : null,
        peers: this.net ? this.net.peerCount + 1 : 0,
        hosting: this.net ? this.net.isHost : false,
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
    window.removeEventListener('beforeunload', this._onUnload);
    if (this._resizeObserver) this._resizeObserver.disconnect();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
