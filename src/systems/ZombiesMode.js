import { playerSpawns, zombieGates } from '../world/arenas/index.js';
import { Sound } from './Sound.js';

// Zombies wave-defense state machine. Host/solo-authoritative (same model as
// HideSeek): it owns the match state, runs the wave director (spawn queue,
// kill scoring, wipe detection), and broadcasts snapshots; guests mirror the
// state via applyState() and reconcile their local player from it.
//
// Phases: lobby -> build (shop + fortify) -> wave (kill them all) -> build ->
// ... forever, scaling up — until a full team wipe ends it at 'gameover'.

const BUILD_TIME_FIRST = 25; // s to fortify before wave 1
const BUILD_TIME = 45;       // s between waves (shop + repairs)
const END_TIME = 12;         // gameover screen before returning to the lobby
const LIVE_CAP = 12;         // max wave mobs alive at once (perf + snapshot size)
const DETECT_ALL = 999;      // wave mobs hunt across the whole arena

// Per-kill points by mob type, plus a bonus for surviving the wave.
export const KILL_POINTS = { zombie: 10, spider: 15, skeleton: 20, creeper: 25 };
const WAVE_BONUS_ALIVE = 50;
const WAVE_BONUS_DEAD = 25;
const START_POINTS = 0;

// Between-wave shop. Purchases are optimistic: the buyer grants itself the
// goods immediately and the host decrements the points (floored at 0) — the
// same trust level as edits/booms/mobHits everywhere else in the netcode.
export const SHOP = [
  { id: 'planks', label: 'Planks ×16', item: 'oak_planks', count: 16, cost: 20 },
  { id: 'stone', label: 'Stone ×8', item: 'stone', count: 8, cost: 30 },
  { id: 'arrows', label: 'Arrows ×16', item: 'arrow', count: 16, cost: 10 },
  { id: 'boom', label: 'Exploding ×4', item: 'arrow_explosive', count: 4, cost: 40 },
  { id: 'venom', label: 'Venom ×2', item: 'arrow_venom', count: 2, cost: 50 },
  { id: 'apples', label: 'Apples ×3', item: 'apple', count: 3, cost: 10 },
  { id: 'heal', label: 'Full heal', item: null, count: 0, cost: 25 },
];
export const shopById = Object.fromEntries(SHOP.map((s) => [s.id, s]));

// Wave composition: how many, and what mix. Spiders climb walls (anti-turtle),
// skeletons answer pillar-towers, creepers crack sealed boxes open.
function waveTotal(wave) { return Math.min(6 + wave * 3, 45); }
function pickType(wave, rng) {
  const r = rng();
  if (wave >= 8 && r < 0.10) return 'creeper';
  if (wave >= 6 && r < 0.25) return 'skeleton';
  if (wave >= 4 && r < 0.45) return 'spider';
  return 'zombie';
}
function healthMul(wave) { return Math.min(4, 1 + 0.15 * (wave - 1)); }
function spawnInterval(wave) { return Math.max(0.8, 2.2 - wave * 0.1); }

export class ZombiesMode {
  constructor(game) {
    this.game = game;
    this.net = game.net || null;
    // Solo and the multiplayer host run the simulation; guests only mirror it.
    this.authoritative = !this.net || this.net.isHost;
    this.selfId = this.net ? this.net.id : 'self';
    this.state = this._emptyState();
    this._applied = { phase: null, alive: true }; // last applied to the local player
    this._tracked = new Set(); // live wave mobs (authoritative only)
    this._queue = [];          // types still to spawn this wave
    this._spawnT = 0;
    this._bcastT = 0;
    this.onChanged = null; // set by Game: fires onMatch + (host) broadcasts
  }

  _emptyState() {
    return {
      phase: 'lobby', timeLeft: 0, wave: 0, remaining: 0, total: 0,
      alive: {}, points: {}, kills: {}, spawns: {}, finalWave: 0,
    };
  }

  // ---- Roster (authoritative only) ----

  _humans() {
    if (!this.net) return ['self'];
    return [this.net.id, ...this.net.players.keys()];
  }

  // ---- Public control (from the HUD / Game) ----

  // Begin a match: roster up, everyone to the keep, enter the first build phase.
  start() {
    if (!this.authoritative) return;
    const s = this.state;
    if (s.phase !== 'lobby' && s.phase !== 'gameover') return;
    const ids = this._humans();
    const alive = {}, points = {}, kills = {}, spawns = {};
    const sp = playerSpawns(ids.length);
    ids.forEach((id, i) => {
      alive[id] = true;
      points[id] = START_POINTS;
      kills[id] = 0;
      spawns[id] = sp[i];
    });
    this.state = {
      phase: 'build', timeLeft: BUILD_TIME_FIRST, wave: 0, remaining: 0, total: 0,
      alive, points, kills, spawns, finalWave: 0,
    };
    this._changed();
  }

  // Skip the rest of the build timer and bring the wave on.
  startWave() {
    if (this.authoritative) { if (this.state.phase === 'build') this._startWave(); }
    else this.net.sendMatch({ action: 'startWave' });
  }

  // The local player died (Game hooks vitals.onDeath into this).
  reportDead() {
    if (this.authoritative) this.markDead(this.selfId);
    else this.net.sendMatch({ action: 'died' });
  }

  // Buy from the between-wave shop. Optimistic: the buyer grants itself the
  // goods now; the authority decrements the points (see SHOP note above).
  buy(id) {
    const entry = shopById[id];
    const s = this.state;
    if (!entry || s.phase !== 'build') return false;
    if ((s.points[this.selfId] || 0) < entry.cost) return false;
    if (entry.id === 'heal') {
      this.game.vitals.health = 20;
    } else {
      this.game.inventory.addItem(entry.item, entry.count);
      this.game.inventory.notify();
    }
    Sound.eat();
    if (this.authoritative) {
      s.points[this.selfId] = Math.max(0, (s.points[this.selfId] || 0) - entry.cost);
      this._changed();
    } else {
      // Local optimistic view until the next broadcast agrees.
      s.points[this.selfId] = Math.max(0, (s.points[this.selfId] || 0) - entry.cost);
      this._changed(true);
      this.net.sendMatch({ action: 'buy', id });
    }
    return true;
  }

  // ---- Authoritative intent handling (host receives guest commands) ----

  handleIntent(fromId, msg) {
    if (!this.authoritative || !msg) return;
    if (msg.action === 'start') this.start();
    else if (msg.action === 'startWave') { if (this.state.phase === 'build') this._startWave(); }
    else if (msg.action === 'died') this.markDead(fromId);
    else if (msg.action === 'buy') {
      const entry = shopById[msg.id];
      const s = this.state;
      if (!entry || s.phase !== 'build') return;
      s.points[fromId] = Math.max(0, (s.points[fromId] || 0) - entry.cost);
      this._changed();
    }
  }

  // A player joined mid-match: enter the roster now, fight from the next
  // build phase (dead-spectator until then if a wave is running).
  playerJoined(id) {
    if (!this.authoritative) return;
    const s = this.state;
    if (s.phase === 'lobby') return; // start() rosters everyone present
    if (id in s.alive) return;
    s.alive[id] = s.phase !== 'wave';
    s.points[id] = s.points[id] || START_POINTS;
    s.kills[id] = s.kills[id] || 0;
    s.spawns[id] = playerSpawns(Object.keys(s.alive).length).pop();
    this._changed();
  }

  // A player disconnected mid-match: drop them so a quitter can't hold the
  // wipe check hostage (runs on every client; the authority decides from it).
  playerLeft(id) {
    const s = this.state;
    if (!(id in s.alive) && !(id in s.points)) return;
    delete s.alive[id];
    delete s.points[id];
    delete s.kills[id];
    delete s.spawns[id];
    if (this.authoritative && s.phase === 'wave') this._checkWipe();
    this._changed();
  }

  // Host migration: this client now owns the simulation. The old host's wave
  // mobs died with its MobManager, so a wave in flight can't be finished —
  // fold back to a build phase and carry on from there.
  becomeAuthority() {
    this.authoritative = true;
    this._tracked.clear();
    this._queue.length = 0;
    const s = this.state;
    if (s.phase === 'wave') {
      s.phase = 'build';
      s.timeLeft = BUILD_TIME;
      s.remaining = 0;
      this._checkWipe();
    }
    this._changed();
  }

  markDead(id) {
    const s = this.state;
    if (s.phase !== 'wave' || s.alive[id] === false) return;
    s.alive[id] = false;
    this._checkWipe();
    this._changed();
  }

  // ---- Per-frame update ----

  update(dt) {
    if (this.authoritative) this._tick(dt);
    this._applyLocal();
  }

  _tick(dt) {
    const s = this.state;
    if (s.phase === 'lobby') return; // wait for start()

    if (s.phase === 'build') {
      s.timeLeft -= dt;
      if (s.timeLeft <= 0) this._startWave();
    } else if (s.phase === 'wave') {
      this._directWave(dt);
    } else if (s.phase === 'gameover') {
      s.timeLeft -= dt;
      if (s.timeLeft <= 0) { this.state = this._emptyState(); this._changed(); }
    }

    // Re-broadcast ~1 Hz so multiplayer guests keep their timers in sync.
    this._bcastT += dt;
    if (this.net && this.net.isHost && this._bcastT >= 1) { this._bcastT = 0; this._changed(); }
  }

  _startWave() {
    const s = this.state;
    s.wave += 1;
    s.phase = 'wave';
    s.timeLeft = 0;
    // Build the spawn queue for this wave (Math.random is fine — the queue
    // lives only on the authority; guests just see the mobs).
    const total = waveTotal(s.wave);
    this._queue = [];
    for (let i = 0; i < total; i++) this._queue.push(pickType(s.wave, Math.random));
    s.total = total;
    s.remaining = total;
    this._spawnT = 0.5; // beat of silence, then the first spawn
    // Everyone rostered fights this wave (dead players revived by _applyLocal).
    for (const id of Object.keys(s.alive)) s.alive[id] = true;
    Sound.fuse(); // wave klaxon stand-in
    this._changed();
  }

  // The wave director: trickle-spawn from the queue at the gates, score kills,
  // end the wave when the arena is clear.
  _directWave(dt) {
    const s = this.state;
    const mobs = this.game.mobs;

    // Live count + kill scoring sweep.
    let live = 0;
    for (const mob of this._tracked) {
      if (mob.dead || mob.removed) {
        if (!mob._zScored) {
          mob._zScored = true;
          const killer = mob.lastHitBy;
          if (killer != null && killer in s.points) {
            s.points[killer] += KILL_POINTS[mob.type] || 10;
            s.kills[killer] = (s.kills[killer] || 0) + 1;
          }
          this._changed();
        }
        if (mob.removed) this._tracked.delete(mob);
      } else {
        live++;
      }
    }

    // Trickle spawn while the queue lasts.
    if (this._queue.length && live < LIVE_CAP) {
      this._spawnT -= dt;
      if (this._spawnT <= 0) {
        this._spawnT = spawnInterval(s.wave);
        const gates = zombieGates();
        const g = gates[Math.floor(Math.random() * gates.length)];
        const type = this._queue.pop();
        const mob = mobs._spawn(type, g.x, g.y, g.z);
        mob._wave = true;
        mob.detectOverride = DETECT_ALL;
        mob.health = Math.round(mob.health * healthMul(s.wave));
        this._tracked.add(mob);
      }
    }

    const remaining = this._queue.length +
      [...this._tracked].filter((m) => !m.dead && !m.removed).length;
    if (remaining !== s.remaining) { s.remaining = remaining; this._changed(); }

    if (remaining === 0) this._endWave();
  }

  _endWave() {
    const s = this.state;
    this._tracked.clear();
    for (const id of Object.keys(s.alive)) {
      s.points[id] = (s.points[id] || 0) + (s.alive[id] ? WAVE_BONUS_ALIVE : WAVE_BONUS_DEAD);
      s.alive[id] = true; // the fallen return for the build phase (_applyLocal revives)
    }
    s.phase = 'build';
    s.timeLeft = BUILD_TIME;
    this._changed();
  }

  _checkWipe() {
    const s = this.state;
    if (s.phase !== 'wave') return;
    if (Object.keys(s.alive).some((id) => s.alive[id])) return;
    // Full team wipe: clear the horde, show the result, then back to the lobby.
    s.phase = 'gameover';
    s.finalWave = s.wave;
    s.timeLeft = END_TIME;
    for (const mob of this._tracked) mob.removed = true;
    this._tracked.clear();
    this._queue.length = 0;
    this._changed();
  }

  // ---- Local player reconciliation (runs on every client) ----

  _applyLocal() {
    const s = this.state;
    const player = this.game.player;
    const alive = s.alive[this.selfId] !== false;

    // Entering the match / a new build phase: revive and reposition the dead.
    if (s.phase === 'build' && this._applied.phase !== 'build') {
      if (this._applied.phase === 'lobby' || this._applied.phase === 'gameover' || this._applied.phase == null) {
        this._teleportLocal(); // match start: everyone to the keep
      }
      if (this.game.vitals.dead && alive) this._reviveLocal();
      player.flying = false;
    }
    // Died during a build phase (e.g. a point-blank exploding arrow): markDead
    // ignores build-phase deaths, so `alive` stayed true — revive at wave start.
    if (s.phase === 'wave' && this._applied.phase !== 'wave' && this.game.vitals.dead && alive) {
      this._reviveLocal();
    }

    // Back in the lobby after a game over: stand the spectator back up.
    if (s.phase === 'lobby' && this._applied.phase !== 'lobby' && this.game.vitals.dead) {
      this._reviveLocal();
    }

    // The shop slams shut when the wave arrives.
    if (s.phase === 'wave' && this._applied.phase !== 'wave' && this.game.openScreen === 'shop') {
      this.game.setScreen(null);
    }

    // Dead mid-wave: free-fly spectator until the next build phase.
    if (!alive && this.game.vitals.dead) {
      player.flying = true;
      player.enabled = this.game.openScreen === null;
    }

    this._applied = { phase: s.phase, alive };
  }

  _reviveLocal() {
    const player = this.game.player;
    this.game.vitals.reset();
    this.game.interaction.locked = false; // spectating locked it
    this._teleportLocal();
    player.flying = false;
    player.enabled = this.game.openScreen === null;
  }

  _teleportLocal() {
    const spawn = this.state.spawns && this.state.spawns[this.selfId];
    if (!spawn) return;
    const p = this.game.player;
    p.pos.set(spawn.x, spawn.y, spawn.z);
    p.vel.set(0, 0, 0);
    p._peakY = spawn.y; // no fall damage from the teleport
  }

  // ---- Guest application of broadcast state ----

  applyState(s) {
    if (!s) return;
    this.state = s;
    this._changed(true);
  }

  // Notify React and (host) broadcast. `received` = applied from the network,
  // so don't re-broadcast it.
  _changed(received = false) {
    if (this.onChanged) this.onChanged(this.state, received);
  }
}
