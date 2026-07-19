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
import { Particles } from '../systems/Particles.js';
import { Explosions, MEGA_TNT_RADIUS } from '../systems/Explosions.js';
import { DamageZones } from '../systems/DamageZones.js';
import { Liquids } from '../systems/Liquids.js';
import { Music } from '../systems/Music.js';
import { ChessGames } from '../chess/ChessGames.js';
import { RemotePlayers } from '../net/RemotePlayers.js';
import { GhostMobs } from '../net/GhostMobs.js';
import { Sound } from '../systems/Sound.js';
import { blockAverageColor } from '../textures/atlas.js';
import { saveWorld } from '../systems/Storage.js';
import { WORLD_SEED } from '../config.js';
import { villageForCell, VILLAGE_CELL } from '../world/structures/VillagePlan.js';
import { setGenMode } from '../world/generators/TerrainGen.js';
import { setActiveMap, activeMap, MAPS } from '../world/arenas/index.js';
import { HideSeek, TAG_RANGE } from '../systems/HideSeek.js';
import { HideSeekBots } from '../systems/HideSeekBots.js';
import { ZombiesMode } from '../systems/ZombiesMode.js';
import { TycoonMode } from '../systems/TycoonMode.js';
import { TAUNTS, tauntById } from '../systems/taunts.js';
import { getBlockId, isSolid, liquidKind } from '../blocks/BlockRegistry.js';
import { getItem } from '../items/ItemRegistry.js';
import { MOBS } from '../entities/mobTypes.js';
import { SEA_LEVEL } from '../config.js';

// Pet toast label: 'black_cat' -> 'Black Cat'.
const petLabel = (type) => type.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

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

// Creative loadout: just the top tools in hand. Every block is reachable from
// the scrollable creative palette (see CreativeInventory), so the inventory is
// otherwise left empty for the player to fill. Placement never consumes.
// Bow ammunition, cycled with X while holding the bow. Special arrows carry a
// smaller direct hit but an area effect on impact: a compact entity-only blast
// (never breaks blocks — defenses stay yours) or a lingering venom pool.
const AMMO = {
  arrow: { dmg: 5 },
  arrow_explosive: { dmg: 2, boom: 1.7 },
  arrow_venom: { dmg: 2, zone: { r: 2.5, dps: 4, ttl: 6 } },
};
const AMMO_ORDER = ['arrow', 'arrow_explosive', 'arrow_venom'];

// Zombies loadout: bow-first combat plus enough blocks and food to survive the
// opening waves — everything else comes from the points shop between waves.
const ZOMBIES_KIT = [
  ['bow', 1],
  ['arrow', 32],
  ['stone_sword', 1],
  ['oak_planks', 32],
  ['apple', 4],
];

const CREATIVE_KIT = [
  ['diamond_pickaxe', 1],
  ['diamond_axe', 1],
  ['diamond_sword', 1],
  ['water_bucket', 1],
  ['lava_bucket', 1],
  ['jukebox', 1],
  ['music_disc_sunfields', 1],
  ['music_disc_wanderlight', 1],
  ['music_disc_moonveil', 1],
  ['music_disc_hollow', 1],
  ['music_disc_deepglow', 1],
  ['music_disc_sunburst', 1],
  ['music_disc_voyage', 1],
];

// Owns the Three.js renderer/scene/camera, the World, and the Player, plus the
// requestAnimationFrame loop. Mounted by the React <App/> into a container div.
export class Game {
  constructor(container, save = null, net = null) {
    this.container = container;
    // Every window/document listener goes through _on() so dispose() can remove
    // it — Game instances come and go per world, and a leaked handler on a
    // disposed game keeps firing (e.g. Enter starting a Prop Hunt round in a
    // scene that's no longer rendered).
    this._listeners = [];
    this._save = save || null;
    this.net = net; // multiplayer connection (null = single-player)
    // Guests (and migrated hosts) play someone else's world — don't persist it.
    this._canPersist = !net || net.isOrigin;
    this.worldId = save?.id || 'default';
    this.worldName = save?.name || 'World';
    this.seed = save?.seed ?? WORLD_SEED;
    // Game mode (survival = default, with mobs + mining; creative = infinite
    // blocks, no mobs, no damage; hideseek = Prop Hunt minigame on a fixed
    // arena; zombies = co-op wave defense on a fixed arena). A per-world
    // setting, fixed at creation.
    this.mode = ['creative', 'hideseek', 'zombies', 'tycoon'].includes(save?.mode) ? save.mode : 'survival';
    this.creative = this.mode === 'creative';
    this.hideseek = this.mode === 'hideseek';
    this.zombies = this.mode === 'zombies';
    this.tycoon = this.mode === 'tycoon';
    // Arena worlds play on a named arena map, fixed at creation like the
    // seed. Select it before any chunk generates (unknown/legacy ids fall back
    // to the default map inside setActiveMap).
    const arena = this.hideseek || this.zombies || this.tycoon;
    this.map = arena
      ? (MAPS[save?.map] ? save.map : (this.zombies ? 'bastion' : this.tycoon ? 'millside' : 'town'))
      : null;
    if (arena) setActiveMap(this.map);
    // Tell the chunk generator which world to build before any chunk generates
    // (flat arena for hide & seek / zombies, procedural terrain otherwise).
    setGenMode(arena ? 'arena' : null);
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
    // Hide & seek and tycoon players carry nothing — those arenas are fixed
    // and there's no building.
    else if (!this.hideseek && !this.tycoon) {
      const kit = this.creative ? CREATIVE_KIT : this.zombies ? ZOMBIES_KIT : STARTER_KIT;
      for (const [name, count] of kit) this.inventory.addItem(name, count);
    }
    this.itemDrops.onCollect = (name, count) => this.inventory.addItem(name, count);

    // Placing a block consumes one of the selected stack — except in creative,
    // where blocks are infinite.
    this.interaction.creative = this.creative;
    // Hide & seek: the arena is fixed — no breaking or placing for anyone.
    // (Seekers still "attack" to tag hiders; that goes through onAttack below.)
    this.interaction.locked = this.hideseek;
    // Tycoon: the world is read-only but right-click USE (doors, purchase
    // pads) still works — a narrower gate than `locked`.
    this.interaction.noEdit = this.tycoon;
    this.interaction.onPlaced = () => { if (!this.creative) this.inventory.consumeSelected(1); };

    // Survival stats + the damage/eat/death hooks. Creative = invulnerable,
    // no hunger, and start in flight for building.
    this.vitals = new Vitals(this.player, this.world);
    // Creative + hide & seek + tycoon players take no environmental damage —
    // in hide & seek, elimination is a match concept handled by the round, and
    // tycoon is a peaceful management mode with nothing to die to.
    this.vitals.godMode = this.creative || this.hideseek || this.tycoon;
    if (this.creative) this.player.flying = true;
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
    // Buckets: scooping swaps in the filled bucket, pouring returns the empty
    // one. Creative buckets are bottomless, like block placement.
    this.interaction.onBucket = (action, kind) => {
      if (this.creative) return;
      this.inventory.consumeSelected(1);
      this.inventory.addItem(action === 'fill' ? `${kind}_bucket` : 'bucket', 1);
      // Scooping water sometimes nets a fish — the only fish source (tames cats).
      if (action === 'fill' && kind === 'water' && Math.random() < 0.2) {
        this.inventory.addItem('raw_fish', 1);
        if (this.onToast) this.onToast('You caught a fish!');
      }
    };
    // Creative spawner items: place a live mob at the targeted cell. Guests
    // ask the host, who owns the simulation.
    this.interaction.onSpawnMob = (type, cell) => {
      if (!this.creative || !MOBS[type]) return;
      const x = cell.x + 0.5, y = cell.y, z = cell.z + 0.5;
      if (this.net && !this.net.isHost) this.net.sendSpawnMob({ t: type, x, y, z });
      else this.mobs.spawnAt(type, x, y, z);
    };
    this.vitals.onDeath = () => this._handleDeath();
    this.onPlayerHurt = null; // React red-flash callback
    this.vitals.onDamage = () => { if (this.onPlayerHurt) this.onPlayerHurt(); };

    // Survival stats restore.
    if (this._save?.vitals) this.vitals.load(this._save.vitals);

    // Day/night cycle + mobs.
    this.dayNight = new DayNight(this.scene, this.sun, this.hemi, this.camera);
    if (this._save?.time != null) { this.dayNight.t = this._save.time; this.dayNight.update(0); }
    // Zombies arenas are locked to night on every client (a mode constant, not
    // synced state): zombies have burns:true and would cook in daylight.
    if (this.zombies) { this.dayNight.t = 0.78; this.dayNight.frozen = true; this.dayNight.update(0); }
    // Tycoon is locked to a pleasant working morning (the inverse constant).
    if (this.tycoon) { this.dayNight.t = 0.30; this.dayNight.frozen = true; this.dayNight.update(0); }
    this.mobs = new MobManager(this.world, this.scene, this.itemDrops);
    // No ambient spawning or distance despawn in zombies mode (the wave
    // director is the only spawner, and gate mobs must not despawn just
    // because the team is across the arena) or creative (only spawner-item
    // mobs exist).
    this.mobs.autoSpawn = !this.creative && !this.zombies && !this.tycoon;
    this.torchLights = new TorchLights(this.scene, this.world);
    this.projectiles = new Projectiles(this.world, this.scene);
    this.particles = new Particles(this.scene);
    this.explosions = new Explosions(this.world, this.scene, this.particles);
    this.damageZones = new DamageZones(this.scene, this.particles);
    this.ammoType = 'arrow'; // bow ammo selection, cycled with X
    // Guns (Zombies mode): per-gun magazine/reserve, keyed by item name —
    // owning a duplicate just shares the ammo. Persisted with the save.
    this.guns = this._save?.guns || {};
    this._gunCd = 0;       // seconds until the held gun may fire again
    this._reloading = 0;   // seconds left on the current reload
    this._reloadGun = null;
    this._recoil = 0;      // viewmodel kick impulse, decays in _animateHeld
    this.liquids = new Liquids(this.world);
    // Context-aware music (day/night/cave rotation + jukebox discs). Purely
    // local — every player hears their own soundtrack, like the SFX bed.
    this.music = new Music();
    this.music.onTrack = (name, disc) => {
      if (disc && this.onToast) this.onToast(`♪ Now playing: ${name}`);
    };
    this._musicCtx = 'day';
    this._musicCtxT = 0; // recompute the context a couple of times per second
    // Jukebox contents: "x,y,z" -> disc item name. Local + saved, like chests.
    this.jukeboxes = new Map(Object.entries(this._save?.jukeboxes || {}));
    this._discBoxKey = null; // which jukebox the playing disc sits in
    this._waterT = 0; // water texture scroll clock

    // Every block edit: spray break particles (local AND remote breaks), and
    // broadcast local edits in multiplayer (remote applies suppress the echo).
    // _blastEdits suppresses the per-block bursts while an explosion applies
    // its crater — a mega TNT removes ~3k blocks in one frame and its fireball
    // already covers the visual.
    this._blastEdits = false;
    this.world.onEdit = (x, y, z, id, prev) => {
      // No break burst when a liquid drains — flow is constant block churn.
      if (id === 0 && prev && !this._blastEdits && !liquidKind(prev)) {
        this.particles.burst(x + 0.5, y + 0.5, z + 0.5, blockAverageColor(prev));
      }
      // Wake the flow sim around every edit, whatever its source (player,
      // explosion, or a remote peer) — guests enqueue too but never process.
      this.liquids.touch(x, y, z);
      if (this.net && !this.net.applying) this.net.sendEdit(x, y, z, id);
    };

    // Multiplayer: remote avatars, guest-side mob ghosts, and event wiring.
    this.remotePlayers = null;
    this.ghostMobs = null;
    if (net) {
      this.remotePlayers = new RemotePlayers(this.scene);
      this.ghostMobs = new GhostMobs(this.scene, net);
      for (const [id, p] of net.players) this.remotePlayers.add(id, p.name);
      net.onEdit = (x, y, z, id) => {
        net.applying = true;
        this.world.setBlock(x, y, z, id);
        net.applying = false;
      };
      // A bulk edit message is an explosion crater: suppress per-block break
      // particles while it applies (the 'boom' event renders the visuals).
      net.onEditBatch = (active) => { this._blastEdits = active; };
      net.onPlayerJoined = (p) => {
        this.remotePlayers.add(p.id, p.name);
        // Zombies: roster a late joiner into the running match (host only).
        if (this.zombiesMode && net.isHost) this.zombiesMode.playerJoined(p.id);
        // Tycoon: hand a returning player their reserved plot, by name.
        if (this.tycoonMode && net.isHost) this.tycoonMode.playerJoined(p.id, p.name);
        // Host: rebind orphaned pets to a returning owner, matched by name.
        if (net.isHost) {
          for (const m of this.mobs.mobs) {
            if (!m.owner && m.ownerName === p.name && m.def.tamable) {
              m.owner = p.id;
              m.sitting = false;
            }
          }
        }
      };
      net.onPlayerLeft = (p) => {
        this.remotePlayers.remove(p.id);
        // Drop them from the match roster too, or a departed hider becomes an
        // untaggable ghost / a departed defender holds the wipe check hostage.
        this._matchMode()?.playerLeft(p.id);
        // Host: orphan the leaver's pets — they sit and wait, keeping the
        // owner's name so they rebind if that player rejoins.
        if (net.isHost) {
          for (const m of this.mobs.mobs) {
            if (m.owner === p.id) {
              m.owner = null;
              m.sitting = true;
            }
          }
        }
      };
      net.onPlayerState = (s) => this.remotePlayers.setState(s);
      net.onMobs = (snap) => { if (!net.isHost) this.ghostMobs.apply(snap); };
      // Guest: the snapshot flipping a ghost's owner to us resolves our tame
      // attempt (or greets us with a rebound pet after a rejoin).
      this._pendingTameId = null;
      this.ghostMobs.onPetUpdate = (g, was) => {
        if (was || g.owner !== net.id) return;
        const label = petLabel(g.type);
        if (this._pendingTameId === g.id) {
          this._pendingTameId = null;
          this.particles.burst(g.pos.x, g.pos.y + g.h + 0.3, g.pos.z, '#ff6a9a', 12, 1.8);
          if (this.onToast) this.onToast(`${label} tamed! It will follow you`);
        } else if (this.onToast) {
          this.onToast(`${label} is following you`);
        }
      };
      net.onProjectile = (p) => {
        this.projectiles.spawn(p.x, p.y, p.z, new THREE.Vector3(p.dx, p.dy, p.dz), p.speed, p.dmg || 0, p.target, { kind: p.kind });
        Sound.shoot();
      };
      // Remote explosion: visuals + own damage; on the host, _boomCtx carries
      // the real MobManager, so a guest's exploding arrow damages mobs here.
      // b.by attributes those kills to the shooter.
      net.onBoom = (b) => {
        const c = this._boomCtx();
        c.by = b.by;
        this.explosions.boom(b.x, b.y, b.z, b.r, c, false);
      };
      // Remote venom/acid pool: every client renders it; only the host damages
      // mobs (the server stamps `owner` with the sender for kill attribution).
      // z.hp marks a spitter acid pool that also ticks the local player.
      net.onZone = (z) => this.damageZones.spawn(z.x, z.y, z.z, z.r, z.dps, z.ttl, z.owner, !!z.hp);
      // Chess: the host validates every action and broadcasts the new view.
      net.onChess = (m) => {
        if (!net.isHost || !m) return;
        let view = null;
        if (m.action === 'open') view = this.chessGames.open(m.key, m.from);
        else if (m.action === 'move') view = this.chessGames.move(m.key, m.from, m.a, m.b);
        else if (m.action === 'reset') view = this.chessGames.reset(m.key, m.from);
        else if (m.action === 'bot') view = this.chessGames.setBot(m.key, m.from, m.level ? `#bot:${m.level}` : null);
        if (view) this._pushChess(view);
      };
      net.onChessState = (view) => {
        if (view && view.key === this.activeChessKey && this.onChess) this.onChess(view);
      };
      // Match modes (hide & seek / zombies): guests send intents to the host;
      // the host broadcasts the authoritative match state, which everyone
      // applies. A room has exactly one mode, so the channel is shared.
      net.onMatch = (m) => { if (net.isHost && m) this._matchMode()?.handleIntent(m.from, m); };
      net.onMatchState = (s) => { this._matchMode()?.applyState(s); };
      // Taunts: the host broadcasts them; every client renders the floating icon.
      net.onTaunt = (m) => { if (m) this.playTauntFx(m.id, m.taunt); };
      net.onHitPlayer = (dmg, kx, kz) => {
        this.vitals.damage(dmg);
        // Shove strength rides as the vector magnitude when it beats the
        // default 7 (charger slam) — ordinary melee kdirs are length < 2.
        if (kx || kz) this.player.knockback(kx, kz, Math.max(7, Math.hypot(kx, kz)));
      };
      net.onMobHit = (m) => { // a guest hit one of our simulated mobs
        const mob = this.mobs.byId(m.i);
        if (mob) {
          if (m.from) { // kill attribution (Zombies points) + pet revenge marks
            mob.lastHitBy = m.from;
            mob.lastHitAt = performance.now() / 1000;
          }
          mob.takeDamage(m.dmg, new THREE.Vector3(m.x, m.y, m.z));
          Sound.mobHurt();
        }
      };
      net.onPetAction = (m) => { // a guest right-clicked one of our tamable mobs
        if (!net.isHost || !m) return;
        const mob = this.mobs.byId(m.i);
        if (mob) this._petInteract(mob, m.from, m.item, m.action);
      };
      net.onSpawnMob = (m) => { // a guest used a creative spawner item
        if (!net.isHost || !m || !this.creative) return;
        this.mobs.spawnAt(m.t, +m.x || 0, +m.y || 0, +m.z || 0);
      };
      net.onBecomeHost = () => {
        this.ghostMobs.clear(); // our MobManager takes over
        // Take over the match simulation from our last-synced state.
        this._matchMode()?.becomeAuthority();
      };
      // Zombies/tycoon arenas ignore the clock sync — their locks are absolute.
      net.onTime = (t) => { if (!this.zombies && !this.tycoon) this.dayNight.t = t; };
      this._netT = 0;     // player-state send accumulator (~15 Hz)
      this._mobNetT = 0;  // mob snapshot accumulator (~10 Hz)
      this._mobsWereLive = false; // creative: was the last sent snapshot non-empty?
      this._timeNetT = 0; // clock sync accumulator (every 5 s)
    }

    // Solo Prop Hunt still renders its bots as remote avatars, so it needs a
    // RemotePlayers pool even without a network connection.
    if (this.hideseek && !this.remotePlayers) this.remotePlayers = new RemotePlayers(this.scene);

    // Dev-only (localhost): T cycles day/night, V teleports to the nearest
    // village (again = next one), G toggles a 3x speed boost, N skips the
    // current Zombies phase (build → wave, wave → cleared).
    if (this.dev) {
      this._on(window, 'keydown', (e) => {
        if (e.code === 'KeyT') {
          this._devTime = (this._devTime + 1) % 3;
          if (this._devTime === 1) { this.dayNight.t = 0.25; this.dayNight.frozen = true; }
          else if (this._devTime === 2) { this.dayNight.t = 0.78; this.dayNight.frozen = true; }
          else { this.dayNight.frozen = false; }
          this.dayNight.update(0);
        } else if (e.code === 'KeyV') {
          this._devTeleportVillage();
        } else if (e.code === 'KeyG') {
          this.player.speedBoost = this.player.speedBoost > 1 ? 1 : 3;
        } else if (e.code === 'KeyN' && this.zombiesMode) {
          const phase = this.zombiesMode.state.phase;
          this.zombiesMode.devSkip();
          if (phase === 'wave') this.onToast?.('⏭ Wave skipped');
        }
      });
    }

    this.interaction.onAttack = () => {
      // Hide & seek: only a seeker acts, and only to tag a disguised hider
      // during the seeking phase. A miss is a wrong guess (handled by tag()).
      if (this.hideseek) {
        if (!this.hideSeek) return false;
        const st = this.hideSeek.state;
        if (st.roles[this.hideSeek.selfId] !== 'seeker' || st.phase !== 'seeking') return false;
        const d = new THREE.Vector3();
        this.camera.getWorldDirection(d);
        let hit = this.remotePlayers ? this.remotePlayers.raycast(this.camera.position, d, TAG_RANGE) : null;
        // The avatar raycast is a pure sphere test — also require voxel line of
        // sight, so a hider tucked behind a wall can't be tagged through it.
        // A blocked swing is a plain miss (the wrong-guess stun applies).
        if (hit && !this._tagVisible(this.remotePlayers.map.get(hit).cur)) hit = null;
        Sound.swing();
        this.hideSeek.tag(hit);
        return true;
      }

      // Holding a bow fires an arrow, a gun fires a round, instead of meleeing.
      if (this.vitals.dead) return true; // spectators don't shoot
      const stack = this.inventory.selectedStack();
      if (stack && stack.item === 'bow') { this._shootBow(); return true; }
      const heldDef = stack ? getItem(stack.item) : null;
      if (heldDef && heldDef.gun) { this._shootGun(heldDef); return true; }

      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const mob = this._mobApi().raycast(this.camera.position, dir, 4);
      Sound.swing();
      if (!mob) return false;
      const tool = this.interaction.currentTool;
      mob.lastHitBy = this._selfPid(); // kill attribution (Zombies points) + pet revenge
      mob.lastHitAt = performance.now() / 1000;
      mob.takeDamage(tool && tool.attackDamage ? tool.attackDamage : 1, this.player.pos);
      Sound.mobHurt();
      return true;
    };

    // Right-clicking a mob: tame / feed / sit-toggle for tamable pets.
    // Guests act on ghost mirrors and send the intent to the host (see
    // _guestPetInteract, added with the multiplayer wiring).
    this.interaction.onUseMob = () => {
      if (this.hideseek || this.vitals.dead) return false;
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const mob = this._mobApi().raycast(this.camera.position, dir, 3.5);
      if (!mob) return false;
      if (this.net && !this.net.isHost) return this._guestPetInteract(mob);
      return this._petInteract(mob, 'self');
    };

    // Chess tables: per-position games. Single-player is hotseat (you play
    // both sides); in multiplayer the host owns every board.
    this.chessGames = new ChessGames({ hotseat: !net });
    if (this._save?.chess && (!net || net.isOrigin)) this.chessGames.load(this._save.chess);
    this.activeChessKey = null;
    this.onChess = null;   // React: receives table views once the screen mounts
    this.chessView = null; // latest view — the screen reads this on mount
    this._botTag = null;   // dedupe guard so a position triggers one bot move

    // Per-position furnace + chest state.
    this.furnaces = new Furnaces();
    if (this._save?.furnaces) this.furnaces.load(this._save.furnaces);
    this.activeFurnace = null;
    this.chests = new ChestStorage();
    if (this._save?.chests) this.chests.load(this._save.chests);
    this.activeChest = null;

    // Right-clicking an interactive block opens its screen (or starts sleep).
    this.interaction.onUseBlock = (name, pos) => {
      if (name === 'crafting_table') this.setScreen('crafting');
      else if (name === 'furnace') {
        this.activeFurnace = this.furnaces.get(pos.x, pos.y, pos.z);
        this.setScreen('furnace');
      } else if (name === 'chest') {
        this.activeChest = this.chests.open(this.world, pos.x, pos.y, pos.z);
        this.setScreen('chest');
      } else if (name === 'bed' || name === 'bed_head') {
        this._sleep();
      } else if (name === 'tnt') {
        // Light it: the block becomes a primed, flashing entity.
        this.world.setBlock(pos.x, pos.y, pos.z, 0);
        this.explosions.prime(pos.x, pos.y, pos.z);
      } else if (name === 'mega_tnt') {
        // Mega TNT: a much larger blast with a longer fuse — get clear!
        this.world.setBlock(pos.x, pos.y, pos.z, 0);
        this.explosions.prime(pos.x, pos.y, pos.z, 3.0, MEGA_TNT_RADIUS, 'mega_tnt');
      } else if (name === 'chess_table') {
        this._openChess(pos);
      } else if (name === 'jukebox') {
        this._useJukebox(pos);
      } else if (name === 'mystery_box') {
        this._useMysteryBox();
      } else if (name.startsWith('wallbuy_')) {
        const err = this.zombiesMode?.buyWall(name.slice(8));
        if (err && this.onToast) this.onToast(err);
      } else if (name.startsWith('tycoon_pad_')) {
        const err = this.tycoonMode?.usePad(name, pos);
        if (err && this.onToast) this.onToast(err);
      }
    };
    this.onSleep = null; // React fade-to-black overlay
    this.onToast = null; // React transient message
    this._sleeping = false;

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
      } else if (name === 'jukebox') {
        this._ejectDisc(pos, `${pos.x},${pos.y},${pos.z}`);
      }
    };

    // Hide & seek (Prop Hunt): the round manager + its solo/host bot filler.
    // The manager owns match state; React reads it through onMatch.
    this.hideSeek = null;
    this.hsBots = null;
    this.onMatch = null;
    this.tauntWheel = { open: false, selected: -1 }; // radial taunt selector
    this.onTauntWheel = null; // React setter
    this._wheelDir = { x: 0, y: 0 };
    if (this.hideseek) {
      // Bots are solo-only for now; multiplayer rounds use the real players.
      if (!net) this.hsBots = new HideSeekBots(this);
      this.hideSeek = new HideSeek(this);
      this.hideSeek.onChanged = (state, received) => {
        if (this.onMatch) this.onMatch(state);
        if (this.net && this.net.isHost && !received) this.net.sendMatchState(state);
      };
      // Late joiner: adopt the round already in progress from the server.
      if (this._save?.match) this.hideSeek.applyState(this._save.match);
    }

    // Zombies: the wave-defense director. Same authoritative-manager shape and
    // the same match/matchState channel (a room has exactly one mode).
    this.zombiesMode = null;
    if (this.zombies) {
      this.zombiesMode = new ZombiesMode(this);
      this.zombiesMode.onChanged = (state, received) => {
        if (this.onMatch) this.onMatch(state);
        if (this.net && this.net.isHost && !received) this.net.sendMatchState(state);
      };
      // Late joiner: adopt the match already in progress from the server.
      if (this._save?.match) this.zombiesMode.applyState(this._save.match);
    }

    // Tycoon: the plot/economy manager. Same authoritative shape and channel;
    // unlike the match modes its state persists (Game.serialize's `tycoon`).
    this.tycoonMode = null;
    if (this.tycoon) {
      this.tycoonMode = new TycoonMode(this);
      this.tycoonMode.onChanged = (state, received) => {
        if (this.onMatch) this.onMatch(state);
        if (this.net && this.net.isHost && !received) this.net.sendMatchState(state);
      };
      // Late joiner: adopt the live plots from the server. Otherwise (solo /
      // hosting) restore the saved tycoon; buildings replay from the edits.
      if (this._save?.match) this.tycoonMode.applyState(this._save.match);
      else if (this._save?.tycoon && this.tycoonMode.authoritative) this.tycoonMode.load(this._save.tycoon);
    }

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
    if (this.hideseek) { this._bindHideSeek(); this._bindTauntWheel(); }
    if (this.zombies) this._bindZombies();
    if (this.tycoon) this._bindTycoon();

    // Pre-generate spawn area so the player doesn't fall through ungenerated
    // chunks, then place the player. For a loaded game, generate around the
    // saved position so the player doesn't briefly fall through ungenerated land.
    if (this._save?.player) {
      this._restorePlayer(this._save.player);
      this.world.update(this.player.pos.x, this.player.pos.z, 80);
    } else if (this.hideseek || this.zombies || this.tycoon) {
      // Arena maps define their lobby spawn explicitly — spawnAtSurface scans
      // top-down and would drop the player onto a roof (or a future ceiling).
      this.world.update(0, 0, 80);
      const s = activeMap().lobbySpawn();
      this.player.pos.set(s.x, s.y, s.z);
      this.player._peakY = s.y;
    } else {
      this.world.update(0, 0, 80);
      this.player.spawnAtSurface();
    }

    // Restore tamed pets — after pregen so their chunks exist, host/SP only
    // (guests mirror the host's mobs). A guest's pet loads orphaned + sitting
    // and rebinds when that player rejoins.
    if (this._save?.pets && !this.hideseek && !this.zombies && !this.tycoon && (!net || net.isHost)) {
      for (const r of this._save.pets) {
        this.mobs.spawnPet({
          t: r.t, x: r.x, y: r.y, z: r.z, hp: r.hp, name: r.name,
          owner: r.own ? 'self' : null,
          sitting: r.own ? !!r.sit : true,
        });
      }
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

  // Voxel line of sight from the camera to a tag target (feet position, chest
  // height). Sampling stops short of the target so the block face a disguised
  // hider is hugging doesn't occlude them.
  _tagVisible(target) {
    const from = this.camera.position;
    const tx = target.x - from.x, ty = (target.y + 0.9) - from.y, tz = target.z - from.z;
    const steps = Math.ceil(Math.hypot(tx, ty, tz) / 0.25);
    for (let i = 1; i <= steps - 3; i++) {
      const t = i / steps;
      const bx = Math.floor(from.x + tx * t);
      const by = Math.floor(from.y + ty * t);
      const bz = Math.floor(from.z + tz * t);
      if (isSolid(this.world.getBlock(bx, by, bz))) return false;
    }
    return true;
  }

  // Mob interface for attacks/projectiles: guests target the ghost mirror of
  // the host's simulation; hosts and single-player target the real mobs.
  _mobApi() {
    return this.net && !this.net.isHost ? this.ghostMobs : this.mobs;
  }

  // Shared context for explosions (TNT fuses, creepers, remote booms).
  _boomCtx() {
    return {
      playerPos: this.player.pos,
      damagePlayer: (dmg, kx, kz) => {
        this.vitals.damage(dmg);
        this.player.knockback(kx, kz, 9);
      },
      // Only the simulation owner damages real mobs.
      mobs: this.net && !this.net.isHost ? null : this.mobs,
      broadcast: this.net ? (x, y, z, r, by) => this.net.sendBoom(x, y, z, r, by) : null,
      // Blast-edit bracketing: batch the network sync into one message and
      // skip per-block break particles while the crater is carved.
      beginEdits: () => {
        this._blastEdits = true;
        if (this.net) this.net.beginEditBatch();
      },
      endEdits: () => {
        this._blastEdits = false;
        if (this.net) this.net.endEditBatch();
      },
    };
  }

  // Cosmetic explosion for the exploding-llama taunt: fireball + sound + a fun
  // shove, but never breaks the arena (applyEdits=false) and never costs health
  // (godMode is on in hide & seek, so damage is absorbed — only knockback lands).
  cosmeticBoom(x, y, z, r) {
    this.explosions.boom(x, y, z, r, {
      playerPos: this.player.pos,
      damagePlayer: (dmg, kx, kz) => this.player.knockback(kx, kz, 6),
      mobs: null,
      broadcast: null,
    }, false);
    if (this.net && this.net.isHost) this.net.sendBoom(x, y, z, r);
  }

  // Render a taunt on this client: floating emoji over the taunter + sound + a
  // little particle puff. Called locally by the authority and via net.onTaunt.
  playTauntFx(playerId, tauntId) {
    const def = tauntById[tauntId];
    if (!def) return;
    if (this.hideSeek && playerId === this.hideSeek.selfId) this.hideSeek.showLocalTaunt(def.emoji, def.duration);
    else if (this.remotePlayers) this.remotePlayers.showTaunt(playerId, def.emoji, def.duration);
    if (Sound[def.sound]) Sound[def.sound]();
    const pos = this.hideSeek ? this.hideSeek._playerPos(playerId) : null;
    if (pos) this.particles.burst(pos.x, pos.y + 2.3, pos.z, def.color, 14, 2.4);
  }

  // Dev (localhost, V key): jump to the nearest village; if already standing
  // in one, jump to the next-nearest. Scans a wide cell ring so it finds
  // villages well beyond the loaded area.
  _devTeleportVillage() {
    const p = this.player.pos;
    const ccx = Math.floor(p.x / VILLAGE_CELL), ccz = Math.floor(p.z / VILLAGE_CELL);
    const list = [];
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        const v = villageForCell(ccx + dx, ccz + dz);
        if (v) list.push(v);
      }
    }
    if (!list.length) return;
    list.sort((a, b) =>
      Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    let target = list[0];
    for (let i = 0; i < list.length; i++) {
      if (Math.hypot(list[i].x - p.x, list[i].z - p.z) < 40) {
        target = list[(i + 1) % list.length];
        break;
      }
    }
    // Pre-generate around the destination so the village is there on arrival.
    this.world.update(target.x, target.z, 80);
    const y = this.world.surfaceHeight(target.x, target.z);
    this.player.pos.set(target.x + 0.5, y + 2, target.z + 0.5);
    this.player.vel.set(0, 0, 0);
    this.player._peakY = this.player.pos.y; // no fall damage from the jump
  }

  // addEventListener that dispose() undoes. Use for anything on window or
  // document (targets that outlive this Game instance).
  _on(target, type, fn) {
    target.addEventListener(type, fn);
    this._listeners.push([target, type, fn]);
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
    this._on(window, 'keydown', (e) => {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 9) this.inventory.setSelected(n - 1);
    });
    this.renderer.domElement.addEventListener('wheel', (e) => {
      if (document.pointerLockElement !== this.renderer.domElement) return;
      this.inventory.cycleSelected(e.deltaY);
    });
  }

  _bindScreens() {
    this._on(window, 'keydown', (e) => {
      if (e.code === 'KeyE') this.setScreen(this.openScreen ? null : 'inventory');
      else if (e.code === 'Escape' && this.openScreen) this.setScreen(null);
      else if (e.code === 'KeyM') { const on = Sound.toggle(); if (this.music.enabled !== on) this.music.toggle(); }
      else if (e.code === 'KeyX' && !this.openScreen) this._cycleAmmo();
    });
  }

  // The active match-mode manager (hide & seek, zombies, or tycoon), if any.
  // All share the match/matchState net channel and the onMatch React channel.
  _matchMode() {
    return this.hideSeek || this.zombiesMode || this.tycoonMode || null;
  }

  // Zombies: dead defenders spectate and must not draw mob aggro.
  _playerTargetable(id) {
    if (!this.zombiesMode) return true;
    const key = id === 'self' ? this.zombiesMode.selfId : id;
    return this.zombiesMode.state.alive[key] !== false;
  }

  // Zombies keys: Enter starts a match (lobby/gameover) or brings the next
  // wave early (build); B opens the shop during a build phase. (UI buttons
  // can't be clicked under pointer-lock, so it's keys.)
  _bindZombies() {
    this._on(window, 'keydown', (e) => {
      if (!this.zombiesMode || this.openScreen) return;
      const st = this.zombiesMode.state;
      if (e.code === 'Enter') {
        if (st.phase === 'lobby' || st.phase === 'gameover') this.zStart();
        else if (st.phase === 'build') this.zStartWave();
      } else if (e.code === 'KeyB' && st.phase === 'build') {
        this.setScreen('shop');
      } else if (e.code === 'KeyR') {
        // Reload the held gun (guns are zombies-only, so R binds here).
        const held = this.interaction.heldItem;
        if (held && held.gun) this._startReload(held);
      }
    });
  }

  // Tycoon keys: dev-only (localhost) money tap for testing the pads and
  // upgrade stamps without grinding deliveries.
  _bindTycoon() {
    this._on(window, 'keydown', (e) => {
      if (!this.tycoonMode || this.openScreen) return;
      if (e.code === 'KeyP' && this.dev) this.tycoonMode.devGrant();
    });
  }

  // ---- Zombies controls, called by the HUD / touch UI ----

  zStart() {
    if (!this.zombiesMode) return;
    if (this.zombiesMode.authoritative) this.zombiesMode.start();
    else this.net.sendMatch({ action: 'start' });
  }

  zStartWave() { this.zombiesMode?.startWave(); }

  // Hide & seek keys: Enter starts/advances a round; number keys pick a disguise
  // while hiding (countdown) or fire a taunt (seeking). (UI buttons can't be
  // clicked under pointer-lock, so it's keys.)
  _bindHideSeek() {
    this._on(window, 'keydown', (e) => {
      if (!this.hideSeek) return;
      const st = this.hideSeek.state;
      if (e.code === 'Enter' && (st.phase === 'lobby' || st.phase === 'roundEnd')) { this.hsStart(); return; }
      const n = parseInt(e.key, 10);
      if (!(n >= 1)) return;
      if (st.phase === 'countdown') {
        if (n <= this.hideSeek.propIds.length) this.hsPickDisguise(this.hideSeek.propIds[n - 1]);
      } else if (st.phase === 'seeking') {
        // Only alive hiders taunt.
        const role = st.roles[this.hideSeek.selfId];
        if (role === 'hider' && st.alive[this.hideSeek.selfId] !== false && n <= TAUNTS.length) {
          this.hsTaunt(TAUNTS[n - 1].id);
        }
      }
    });
  }

  // ---- Hide & seek (Prop Hunt) controls, called by the HUD ----

  hsStart() {
    if (!this.hideSeek) return;
    if (this.hideSeek.authoritative) this.hideSeek.start();
    else this.net.sendMatch({ action: 'start' });
  }

  hsPickDisguise(blockId) { this.hideSeek?.pickDisguise(blockId); }

  hsTaunt(tauntId) {
    if (!this.hideSeek) return;
    if (this.hideSeek.authoritative) this.hideSeek.taunt(tauntId);
    else this.net.sendMatch({ action: 'taunt', id: tauntId });
  }

  // ---- Radial taunt wheel: hold R to fan the taunts out in a ring, aim with
  // the mouse (camera-look pauses), release to fire the highlighted taunt. ----

  _bindTauntWheel() {
    this._on(window, 'keydown', (e) => {
      if (e.code === 'KeyR' && !e.repeat && !this.tauntWheel.open && this._canTaunt()) this._openWheel();
    });
    this._on(window, 'keyup', (e) => {
      if (e.code === 'KeyR' && this.tauntWheel.open) this._closeWheel(true);
    });
    this._on(document, 'mousemove', (e) => {
      if (this.tauntWheel.open) this._aimWheel(e.movementX || 0, e.movementY || 0);
    });
  }

  _canTaunt() {
    if (!this.hideSeek) return false;
    const s = this.hideSeek.state;
    return s.phase === 'seeking'
      && s.roles[this.hideSeek.selfId] === 'hider'
      && s.alive[this.hideSeek.selfId] !== false;
  }

  _openWheel() {
    this.tauntWheel = { open: true, selected: -1 };
    this._wheelDir = { x: 0, y: 0 };
    this.player.lookFrozen = true; // aim the wheel instead of the camera
    if (this.onTauntWheel) this.onTauntWheel(this.tauntWheel);
  }

  _aimWheel(dx, dy) {
    const MAX = 120;
    let x = this._wheelDir.x + dx, y = this._wheelDir.y + dy;
    const len = Math.hypot(x, y);
    if (len > MAX) { x = (x / len) * MAX; y = (y / len) * MAX; }
    this._wheelDir = { x, y };
    const sel = this._wheelSelection();
    if (sel !== this.tauntWheel.selected) {
      this.tauntWheel = { open: true, selected: sel };
      if (this.onTauntWheel) this.onTauntWheel(this.tauntWheel);
    }
  }

  // The taunt the aim vector points at, or -1 inside the dead zone.
  _wheelSelection() {
    const { x, y } = this._wheelDir;
    if (Math.hypot(x, y) < 16) return -1;
    const aim = Math.atan2(y, x);
    const n = TAUNTS.length;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2; // taunt i sits at this ring angle
      let d = aim - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) < bestD) { bestD = Math.abs(d); best = i; }
    }
    return best;
  }

  _closeWheel(fire) {
    const sel = this.tauntWheel.selected;
    this.tauntWheel = { open: false, selected: -1 };
    this.player.lookFrozen = false;
    if (this.onTauntWheel) this.onTauntWheel(this.tauntWheel);
    if (fire && sel >= 0 && sel < TAUNTS.length) this.hsTaunt(TAUNTS[sel].id);
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
    // Zombies: no inventory scatter (that gear was bought) and no respawn
    // overlay — the player spectates until the next wave revives them.
    if (this.zombies) { this._zombiesDeath(); return; }
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

  // Zombies death: become a free-fly spectator (interaction off) and report
  // it to the wave director; the next build phase revives everyone.
  _zombiesDeath() {
    Sound.death();
    this.player.flying = true;
    this.interaction.locked = true;
    if (this.onToast) this.onToast('You died — spectating until the next wave');
    this.zombiesMode?.reportDead();
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
      mode: this.mode,
      ...(this.map ? { map: this.map } : {}),
      edits: this.world.serializeEdits(),
      player: { x: p.x, y: p.y, z: p.z, yaw: this.player.yaw, pitch: this.player.pitch },
      vitals: this.vitals.serialize(),
      inventory: this.inventory.serialize(),
      guns: this.guns,
      furnaces: this.furnaces.serialize(),
      chests: this.chests.serialize(),
      jukeboxes: Object.fromEntries(this.jukeboxes),
      // Tamed pets are the only mobs that persist. `own: 1` = the saving
      // player's own pet; guests' pets are stored by name and rebind on join.
      pets: this.mobs.mobs
        .filter((m) => m.owner && !m.dead)
        .map((m) => ({
          t: m.type, x: +m.pos.x.toFixed(1), y: +m.pos.y.toFixed(1), z: +m.pos.z.toFixed(1),
          hp: m.health, sit: m.sitting ? 1 : 0,
          own: m.owner === 'self' ? 1 : 0, name: m.ownerName || null,
        })),
      chess: this.chessGames.serialize(),
      // Tycoon plots persist by owner NAME (pids are session-scoped) — money
      // and tiers survive reload; buildings replay from `edits`.
      ...(this.tycoonMode ? { tycoon: this.tycoonMode.serialize() } : {}),
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

  // ---- Chess table ----

  // My seat identity at chess tables: 'p1' hotseat in single-player, 'host'
  // for the multiplayer host, the socket id for guests.
  _chessId() {
    if (!this.net) return 'p1';
    return this.net.isHost ? 'host' : this.net.id;
  }

  // Render locally and, as host, broadcast the authoritative view. The view is
  // also stored so the chess screen can read it when it mounts — the first
  // push happens before React mounts the screen (this was the "setting up the
  // board…" hang). Bots get scheduled here too.
  _pushChess(view) {
    this.chessView = view;
    if (view.key === this.activeChessKey && this.onChess) this.onChess(view);
    if (this.net && this.net.isHost) this.net.sendChessState(view);
    this._maybeBotMove(view);
  }

  // If the seat to move is a bot (and we own the simulation), play its move
  // after a short think-pause. Tagged by position so each triggers once.
  _maybeBotMove(view) {
    if (this.net && !this.net.isHost) return;
    const seat = view.turn === 'w' ? view.white : view.black;
    if (!seat || typeof seat !== 'string' || !seat.startsWith('#bot:')) return;
    if (view.status === 'checkmate' || view.status === 'stalemate' || view.status === 'draw') return;
    const tag = `${view.key}:${view.turn}:${view.last ? view.last.join('-') : 'start'}`;
    if (this._botTag === tag) return;
    this._botTag = tag;
    setTimeout(() => {
      const v = this.chessGames.botMove(view.key);
      if (v) this._pushChess(v);
    }, 550);
  }

  // Seat (or dismiss, level 0) a bot opponent at the open table.
  chessBot(level) {
    if (!this.activeChessKey) return;
    if (!this.net || this.net.isHost) {
      const view = this.chessGames.setBot(this.activeChessKey, this._chessId(), level ? `#bot:${level}` : null);
      if (view) this._pushChess(view);
    } else {
      this.net.sendChess({ action: 'bot', key: this.activeChessKey, level });
    }
  }

  _openChess(pos) {
    this.activeChessKey = `${pos.x},${pos.y},${pos.z}`;
    if (!this.net || this.net.isHost) {
      this._pushChess(this.chessGames.open(this.activeChessKey, this._chessId()));
    } else {
      this.net.sendChess({ action: 'open', key: this.activeChessKey });
    }
    this.setScreen('chess');
  }

  chessMove(from, to) {
    if (!this.activeChessKey) return;
    if (!this.net || this.net.isHost) {
      const view = this.chessGames.move(this.activeChessKey, this._chessId(), from, to);
      if (view) this._pushChess(view);
    } else {
      this.net.sendChess({ action: 'move', key: this.activeChessKey, a: from, b: to });
    }
  }

  chessReset() {
    if (!this.activeChessKey) return;
    if (!this.net || this.net.isHost) {
      const view = this.chessGames.reset(this.activeChessKey, this._chessId());
      if (view) this._pushChess(view);
    } else {
      this.net.sendChess({ action: 'reset', key: this.activeChessKey });
    }
  }

  // Legal targets for highlighting. Guests compute them locally from the
  // synced view (the host still validates the actual move).
  chessLegalTargets(view, from) {
    return this.chessGames.legalTargetsFor(view, from, this._chessId());
  }

  // Sleep in a bed: short fade to black, then wake at dawn. Night only; in
  // multiplayer only the host owns the clock.
  _sleep() {
    if (this._sleeping) return;
    if (this.net && !this.net.isHost) {
      if (this.onToast) this.onToast('Only the host can skip the night');
      return;
    }
    if (!this.dayNight.isNight) {
      if (this.onToast) this.onToast('You can only sleep at night');
      return;
    }
    this._sleeping = true;
    this.player.enabled = false;
    if (this.onSleep) this.onSleep(true);
    setTimeout(() => {
      this.dayNight.t = 0.02; // just after sunrise
      this.dayNight.frozen = this._devTime !== 0 ? this.dayNight.frozen : false;
      this.dayNight.update(0);
      if (this.net && this.net.isHost) this.net.sendTime(this.dayNight.t);
      this._sleeping = false;
      this.player.enabled = this.openScreen === null;
      if (this.onSleep) this.onSleep(false);
    }, 1800);
  }

  // Right-click on a mob, run by the simulation owner (host / single-player).
  // `pid` is the acting player: 'self' for the local player, else a guest
  // socket id (via net, where `itemName`/`action` come from the message and
  // the guest already consumed the item client-side — a raced intent, e.g.
  // taming a mob someone else just claimed, is simply dropped). Returns true
  // when the click was consumed (so it doesn't fall through to block use).
  _petInteract(mob, pid, itemName, action) {
    const def = mob.def;
    if (!def || !def.tamable || mob.dead) return false;
    const local = pid === 'self';
    const item = local ? (this.inventory.selectedStack()?.item ?? null) : (itemName ?? null);
    const label = petLabel(mob.type);
    const hearts = () =>
      this.particles.burst(mob.pos.x, mob.pos.y + mob.h + 0.3, mob.pos.z, '#ff6a9a', 12, 1.8);

    if (!mob.owner) {
      if (action && action !== 'tame') return true; // raced: owner just left
      if (item !== def.tameItem) return false; // wild + wrong item: not our click
      if (local && !this.creative) this.inventory.consumeSelected(1);
      if (Math.random() < 1 / 3) {
        mob.owner = pid;
        mob.ownerName = local ? null : (this.net?.players.get(pid)?.name ?? null);
        mob.sitting = false;
        mob.fleeTimer = 0;
        mob.setTag(mob.ownerName ? `♥ ${mob.ownerName}` : '♥');
        hearts();
        if (local && this.onToast) this.onToast(`${label} tamed! It will follow you`);
      } else if (local && this.onToast) {
        this.onToast(`The ${label.toLowerCase()} ignores you...`);
      }
      return true;
    }
    if (mob.owner !== pid) {
      if (local && this.onToast) this.onToast(`That's ${mob.ownerName || 'someone else'}'s pet`);
      return true;
    }
    // Our pet: feed it if we're holding pet food and it's hurt, else sit/stay.
    const itemDef = item && getItem(item);
    const canFeed = itemDef && def.petFoods?.includes(item) && mob.health < def.health;
    if (canFeed && (!action || action === 'feed')) {
      if (local && !this.creative) this.inventory.consumeSelected(1);
      mob.health = Math.min(def.health, mob.health + Math.max(2, (itemDef.food || 1) * 2));
      hearts();
      Sound.eat();
      if (local && this.onToast) this.onToast(`${label} fed (+health)`);
      return true;
    }
    if (action && action !== 'sit') return true; // raced guest intent: drop it
    mob.sitting = !mob.sitting;
    mob.heading = null;
    if (local && this.onToast) this.onToast(mob.sitting ? `${label} is sitting` : `${label} is following you`);
    return true;
  }

  // Guest-side mob right-click: precheck against the ghost's mirrored state,
  // send the intent to the host, and consume/toast optimistically. The
  // authoritative result comes back through the mob snapshot (a tame success
  // lands via ghostMobs.onPetUpdate).
  _guestPetInteract(g) {
    const def = g.def;
    if (!def || !def.tamable || g.dead) return false;
    const item = this.inventory.selectedStack()?.item ?? null;
    const label = petLabel(g.type);
    if (!g.owner) {
      if (item !== def.tameItem) return false;
      if (!this.creative) this.inventory.consumeSelected(1);
      this._pendingTameId = g.id;
      this.net.sendPetAction({ i: g.id, action: 'tame', item });
      return true;
    }
    if (g.owner !== this.net.id) {
      if (this.onToast) this.onToast(`That's ${g.ownerName || 'someone else'}'s pet`);
      return true;
    }
    const itemDef = item && getItem(item);
    if (itemDef && def.petFoods?.includes(item) && g.health < def.health) {
      if (!this.creative) this.inventory.consumeSelected(1);
      this.net.sendPetAction({ i: g.id, action: 'feed', item });
      Sound.eat();
      if (this.onToast) this.onToast(`${label} fed (+health)`);
      return true;
    }
    this.net.sendPetAction({ i: g.id, action: 'sit', item: null });
    // Optimistic toast; the pose itself arrives with the next snapshot.
    if (this.onToast) this.onToast(g.sitting ? `${label} is following you` : `${label} is sitting`);
    return true;
  }

  // Fire an arrow from the camera if the player has ammo. The selected ammo
  // type (X to cycle) is used when in stock, falling back to plain arrows.
  _shootBow() {
    let ammo = this.ammoType;
    if (this.inventory.count(ammo) <= 0) ammo = 'arrow';
    if (this.inventory.count(ammo) <= 0) return;
    this.inventory.removeItems(ammo, 1);
    this.inventory.notify();
    const spec = AMMO[ammo];
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const o = this.camera.position;
    const kind = ammo === 'arrow' ? undefined : ammo;
    this.projectiles.spawn(o.x, o.y, o.z, dir, 30, spec.dmg, 'mob', {
      kind,
      owner: this._selfPid(),
      onHit: spec.boom || spec.zone ? (pos) => this._arrowImpact(ammo, pos) : null,
    });
    Sound.shoot();
    // Co-op: others see the arrow fly, but it can't hurt them (no PvP).
    if (this.net) {
      this.net.sendProjectile({ x: o.x, y: o.y, z: o.z, dx: dir.x, dy: dir.y, dz: dir.z, speed: 30, dmg: 0, target: 'none', kind });
    }
  }

  // My id in match/attribution space ('self' single-player, socket id online).
  _selfPid() { return this.net ? this.net.id : 'self'; }

  // The Mystery Box block: a spin at the crate (works mid-wave too — running
  // a gamble under pressure is the point), with reasons on refusal.
  _useMysteryBox() {
    const zm = this.zombiesMode;
    if (!zm) return;
    const st = zm.state;
    if (st.phase !== 'build' && st.phase !== 'wave') {
      if (this.onToast) this.onToast('Start the match to use the Mystery Box');
      return;
    }
    if (!zm.buy('box') && this.onToast) this.onToast('Not enough points for the Mystery Box');
  }

  // Special-ammo impact effects. Explosive: a compact entity-only blast —
  // applyEdits=false so player defenses never take collateral (creepers stay
  // the only block-breakers). Venom: a lingering damage pool.
  _arrowImpact(ammo, pos) {
    const spec = AMMO[ammo];
    if (spec.boom) {
      this._splashImpact(pos, spec.boom);
    } else if (spec.zone) {
      const { r, dps, ttl } = spec.zone;
      this.damageZones.spawn(pos.x, pos.y, pos.z, r, dps, ttl, this._selfPid());
      if (this.net) this.net.sendZone({ x: pos.x, y: pos.y, z: pos.z, r, dps, ttl });
    }
  }

  // A spitter glob hit the ground: leave a short-lived acid pool that ticks
  // players standing in it (hp flag → hurtPlayer on every client).
  _acidSplash(pos) {
    this.damageZones.spawn(pos.x, pos.y, pos.z, 2, 3, 4, null, true);
    if (this.net) this.net.sendZone({ x: pos.x, y: pos.y, z: pos.z, r: 2, dps: 3, ttl: 4, hp: 1 });
  }

  // Entity-only splash (exploding arrows, ray gun bolts): never carves blocks.
  // On a guest, the local boom has no mobs to damage — the broadcast reaches
  // the host, whose replay applies it (attributed via `by`).
  _splashImpact(pos, radius) {
    const c = this._boomCtx();
    c.by = this._selfPid();
    this.explosions.boom(pos.x, pos.y, pos.z, radius, c, false);
    if (c.broadcast) c.broadcast(pos.x, pos.y, pos.z, radius, c.by);
  }

  // Fire the held gun (Zombies weapons): fire-rate gated, magazine-fed, with
  // per-shot spread, viewmodel recoil, and a cosmetic tracer for peers. Dry
  // trigger auto-reloads.
  _shootGun(item) {
    const spec = item.gun;
    const g = this.guns[item.name] ||
      (this.guns[item.name] = { mag: spec.mag, reserve: spec.reserve });
    if (this._reloading > 0 || this._gunCd > 0) return;
    if (g.mag <= 0) {
      Sound.dryFire();
      this._startReload(item);
      return;
    }
    g.mag--;
    this._gunCd = 60 / spec.rpm;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    if (spec.spread) {
      dir.x += (Math.random() * 2 - 1) * spec.spread;
      dir.y += (Math.random() * 2 - 1) * spec.spread;
      dir.z += (Math.random() * 2 - 1) * spec.spread;
      dir.normalize();
    }
    const o = this.camera.position;
    const kind = spec.boom ? 'ray' : 'bullet';
    this.projectiles.spawn(o.x, o.y, o.z, dir, spec.speed, spec.dmg, 'mob', {
      kind,
      owner: this._selfPid(),
      onHit: spec.boom ? (pos) => this._splashImpact(pos, spec.boom) : null,
    });
    this._recoil = Math.min(0.5, this._recoil + (spec.boom ? 0.3 : spec.auto ? 0.1 : 0.2));
    if (spec.boom) Sound.rayZap(); else Sound.gunShot(spec.auto);
    // Co-op: others see the tracer fly, but it can't hurt them (no PvP).
    if (this.net) {
      this.net.sendProjectile({ x: o.x, y: o.y, z: o.z, dx: dir.x, dy: dir.y, dz: dir.z, speed: spec.speed, dmg: 0, target: 'none', kind });
    }
  }

  // Begin reloading the held gun (R, or automatically on a dry trigger).
  _startReload(item) {
    const spec = item.gun;
    const g = this.guns[item.name];
    if (!g || this._reloading > 0 || g.mag >= spec.mag || g.reserve <= 0) return;
    this._reloading = spec.reload;
    this._reloadGun = item.name;
    Sound.reload();
  }

  // Cycle bow ammo (X). Only types in stock are offered; plain arrows always
  // qualify so the cycle never dead-ends.
  _cycleAmmo() {
    const stocked = AMMO_ORDER.filter((a) => a === 'arrow' || this.inventory.count(a) > 0);
    const i = stocked.indexOf(this.ammoType);
    this.ammoType = stocked[(i + 1) % stocked.length];
    if (this.onToast) {
      const item = getItem(this.ammoType);
      this.onToast(`🏹 Ammo: ${item ? item.display : this.ammoType} (${this.inventory.count(this.ammoType)})`);
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

  // Right-clicking a jukebox: with a disc inside, eject it; with a disc in
  // hand, drop it in and let it spin.
  _useJukebox(pos) {
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (this.jukeboxes.get(key)) {
      this._ejectDisc(pos, key);
      return;
    }
    const stack = this.inventory.selectedStack();
    const item = stack ? getItem(stack.item) : null;
    if (!item || !item.disc) return;
    this.jukeboxes.set(key, item.name);
    if (!this.creative) this.inventory.consumeSelected(1);
    this._discBoxKey = key;
    this.music.playDisc(item.disc, pos);
  }

  // Pop the disc out (use again / block broken) and stop its music.
  _ejectDisc(pos, key) {
    const inside = this.jukeboxes.get(key);
    if (!inside) return;
    this.jukeboxes.delete(key);
    if (this._discBoxKey === key) {
      this.music.stopDisc();
      this._discBoxKey = null;
    }
    this.itemDrops.spawn(inside, 1, pos.x, pos.y + 1, pos.z);
  }

  // Sync the held view-model + interaction targets to the selected hotbar slot.
  _syncHeld() {
    const stack = this.inventory.selectedStack();
    const item = stack ? getItem(stack.item) : null;
    const name = item ? item.name : null;

    this.interaction.currentTool = item && item.toolType ? item : null;
    this.interaction.selectedBlock = item && item.placeBlock ? getBlockId(item.placeBlock) : 0;
    this.interaction.heldItem = item;
    this.interaction.heldFood = item && item.food ? item.food : 0;

    if (name !== this._heldName) {
      this._heldName = name;
      // Swapping weapons abandons a reload in progress.
      this._reloading = 0;
      this._reloadGun = null;
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

    // Guns: fire-rate cooldown, reload completion, and full-auto while the
    // primary button is held (onAttack only fires once per press).
    if (this._gunCd > 0) this._gunCd -= dt;
    if (this._reloading > 0) {
      this._reloading -= dt;
      if (this._reloading <= 0) {
        const g = this.guns[this._reloadGun];
        const def = this._reloadGun ? getItem(this._reloadGun) : null;
        if (g && def?.gun) {
          const take = Math.min(def.gun.mag - g.mag, g.reserve);
          g.mag += take;
          g.reserve -= take;
        }
        this._reloading = 0;
        this._reloadGun = null;
      }
    }
    if (this.interaction.attackHeld && !this.vitals.dead && this.player.enabled) {
      const held = this.interaction.heldItem;
      if (held && held.gun && held.gun.auto) this._shootGun(held);
    }
    this.itemDrops.update(dt, this.player.pos);
    this.furnaces.update(dt);
    this.vitals.update(dt);
    this.dayNight.update(dt);
    this.torchLights.update(this.player.pos);
    if (this.hideSeek) this.hideSeek.update(dt);
    if (this.zombiesMode) this.zombiesMode.update(dt);
    if (this.tycoonMode) this.tycoonMode.update(dt);
    const isGuest = this.net && !this.net.isHost;
    if (isGuest) {
      // Guests mirror the host's mob simulation instead of running their own.
      this.ghostMobs.update(dt);
    } else if (!this.hideseek) {
      // Hide & seek worlds have no mobs at all. Creative ticks the simulation
      // too, but with autoSpawn off only spawner-item mobs ever exist.
      this.mobs.update(dt, {
        playerPos: this.player.pos,
        // Host: mobs hunt every player in the room — minus dead defenders in
        // zombies mode (spectators are not targets).
        players: this.net
          ? [{ id: 'self', pos: this.player.pos }, ...this.remotePlayers.list()]
              .filter((pl) => this._playerTargetable(pl.id))
          : (this.zombiesMode && this.vitals.dead ? [] : null),
        // Pet owners are 'self' for the host, but hit attribution stamps
        // _selfPid() (socket id online) — the wolf-assist matcher bridges the
        // two with this.
        selfPid: this._selfPid(),
        isNight: this.dayNight.isNight,
        attackPlayer: (dmg, id = 'self', kdir = null, power = 0) => {
          if (id === 'self' || !this.net) {
            this.vitals.damage(dmg);
            if (kdir) this.player.knockback(kdir.x, kdir.z, power || 7);
          } else {
            // Melee hit on a remote player; they apply their own knockback.
            // A shove stronger than the default (charger slam) rides as the
            // kdir magnitude — knockback() normalizes direction, and plain
            // hits send raw position diffs (length < 2), so onHitPlayer can
            // decode power as max(7, |kdir|) with no new net fields.
            const kl = kdir ? Math.hypot(kdir.x, kdir.z) || 1 : 1;
            this.net.sendHitPlayer(id, dmg, kdir && power
              ? { x: (kdir.x / kl) * power, z: (kdir.z / kl) * power }
              : kdir);
          }
        },
        shoot: (sx, sy, sz, dx, dy, dz, dmg, kind) => {
          // Acid globs (spitter) and rocks (tank) fly slower — a readable,
          // dodgeable arc.
          const speed = kind === 'acid' ? 14 : kind === 'rock' ? 15 : 22;
          this.projectiles.spawn(sx, sy, sz, new THREE.Vector3(dx, dy, dz), speed, dmg, 'player', {
            kind,
            // Only the authority owns onHit, so exactly one pool per glob;
            // guests get theirs from the sendZone broadcast.
            onHit: kind === 'acid' ? (pos) => this._acidSplash(pos) : null,
          });
          Sound.shoot();
          // Guests simulate the same arrow locally so it can hit *them*.
          if (this.net) this.net.sendProjectile({ x: sx, y: sy, z: sz, dx, dy, dz, speed, dmg, target: 'player', kind });
        },
        explode: (mob) => {
          const c = this._boomCtx();
          this.explosions.boom(mob.pos.x, mob.pos.y + 0.8, mob.pos.z, 2.6, c, true);
          if (c.broadcast) c.broadcast(mob.pos.x, mob.pos.y + 0.8, mob.pos.z, 2.6);
        },
      });
    }
    this.projectiles.update(dt, {
      playerPos: this.player.pos,
      hitPlayer: (dmg, vel) => {
        this.vitals.damage(dmg);
        if (vel) this.player.knockback(vel.x, vel.z, 5); // ride the arrow's push
      },
      mobs: this._mobApi(),
    });

    // Multiplayer sync: our transform at ~15 Hz; host adds mob snapshots
    // (~10 Hz) and the world clock (every 5 s).
    if (this.remotePlayers) this.remotePlayers.update(dt);
    if (this.net) {
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
        // Prop Hunt never simulates mobs. Creative only streams while mobs
        // exist (plus one empty snapshot to clear guests' ghosts) — don't
        // broadcast empty snapshots at 10 Hz for a whole mob-less session.
        const haveMobs = this.mobs.mobs.length > 0;
        const simMobs = !this.hideseek && (!this.creative || haveMobs || this._mobsWereLive);
        this._mobNetT += dt;
        if (simMobs && this._mobNetT >= 0.1) {
          this._mobNetT = 0;
          this.net.sendMobs(this.mobs.snapshot());
          this._mobsWereLive = haveMobs;
        }
        this._timeNetT += dt;
        if (this._timeNetT >= 5) { this._timeNetT = 0; this.net.sendTime(this.dayNight.t); }
      }
    }
    this.particles.update(dt);
    this.explosions.update(dt, this._boomCtx());
    // Venom pools: visuals everywhere; mob damage only on the sim owner.
    // Acid pools also tick the LOCAL player on every client.
    this.damageZones.update(dt, this.net && !this.net.isHost ? null : this.mobs, {
      pos: this.player.pos,
      dead: this.vitals.dead,
      damage: (n) => this.vitals.damage(n),
    });
    // Liquid flow: only the authority simulates; guests receive the edits.
    this.liquids.enabled = !this.net || this.net.isHost;
    this.liquids.update(dt);
    // Music context (cave when well below the surface, else day/night),
    // recomputed a couple of times per second — surfaceHeight scans a column.
    this._musicCtxT -= dt;
    if (this._musicCtxT <= 0) {
      this._musicCtxT = 0.6;
      const p = this.player.pos;
      const surf = this.world.surfaceHeight(Math.floor(p.x), Math.floor(p.z));
      const cave = surf - p.y >= 8 && p.y < SEA_LEVEL + 2;
      this._musicCtx = cave ? 'cave' : this.dayNight.isNight ? 'night' : 'day';
    }
    this.music.update(dt, { context: this._musicCtx, playerPos: this.player.pos });
    // Drift the shared water texture for a gentle current.
    this._waterT += dt;
    const waterMap = this.world.waterMaterial.map;
    waterMap.offset.set((this._waterT * 0.02) % 1, (this._waterT * 0.012) % 1);
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
        creative: this.creative,
        hideseek: this.hideseek,
        zombies: this.zombies,
        tycoon: this.tycoon,
        gunAmmo: item && item.gun && this.guns[item.name]
          ? { mag: this.guns[item.name].mag, reserve: this.guns[item.name].reserve, reloading: this._reloading > 0 }
          : null,
        dev: this.dev,
        devTime: ['Auto', 'Day', 'Night'][this._devTime],
        devBoost: this.player.speedBoost > 1,
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
      this.heldAnchor.position.z = -0.7;
    } else {
      // Ease toward rest plus any gun recoil kick (muzzle up, gun shoved back);
      // the impulse decays exponentially so rapid fire stacks smoothly.
      const kick = this._recoil;
      this.heldAnchor.rotation.x += ((baseRot + kick * 0.9) - this.heldAnchor.rotation.x) * Math.min(1, dt * 30);
      this.heldAnchor.position.z = -0.7 + kick * 0.25;
      this._recoil = kick > 0.004 ? kick * Math.max(0, 1 - dt * 9) : 0;
    }
  }

  dispose() {
    this._running = false;
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('beforeunload', this._onUnload);
    for (const [target, type, fn] of this._listeners) target.removeEventListener(type, fn);
    this._listeners.length = 0;
    if (this._resizeObserver) this._resizeObserver.disconnect();
    this.torchLights.dispose();
    this.damageZones.dispose();
    this.music.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
