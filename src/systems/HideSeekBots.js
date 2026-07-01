import { FLOOR_Y, activeMap } from '../world/arenas/index.js';
import { isSolid } from '../blocks/BlockRegistry.js';
import { TAG_RANGE } from './HideSeek.js';

// Simple Prop Hunt bots so a solo player has opponents. Only the authority
// (solo player or multiplayer host) runs these; they're socket-less virtual
// players rendered through the RemotePlayers pool.
//
// Seeker AI is intentionally beatable: a bot only notices a hider that is
// within sight range AND has a clear line of sight (walls/props block it), and
// a hider that holds still (disguised) is far harder to spot than one running
// around. When it can't see anyone it wanders — and chases your *last known*
// spot, so breaking line of sight and freezing lets you slip away.

const SPAWN_Y = FLOOR_Y + 1;
const SEEK_SPEED = 3.6;    // slower than the player's walk (5.5) so you can flee
const HIDE_SPEED = 4.5;
const WANDER_SPEED = 2.8;  // relaxed pace while searching
const ARRIVE = 1.2;        // distance at which a bot "arrives" at its target
const TAG_COOLDOWN = 1.2;  // seconds between a seeker bot's tag attempts
const SIGHT = 12;          // how far a bot can notice a *moving* hider
const SIGHT_STILL = 4.5;   // a still, disguised hider blends in until this close
const GIVE_UP = 4;         // seconds chasing a lost target before wandering off

export class HideSeekBots {
  constructor(game) {
    this.game = game;
    this.bots = new Map(); // id -> bot
    this._n = 0;
  }

  // Ensure exactly n bots exist (reusing any from a previous round, trimming
  // surplus), and return their ids.
  spawn(n) {
    const existing = [...this.bots.keys()];
    // Trim surplus bots beyond n.
    for (let i = n; i < existing.length; i++) {
      const id = existing[i];
      if (this.game.remotePlayers) this.game.remotePlayers.remove(id);
      this.bots.delete(id);
    }
    const ids = existing.slice(0, n);
    // Create any additional bots needed.
    for (let i = existing.length; i < n; i++) {
      const id = `#bot:${++this._n}`;
      this.bots.set(id, {
        id, x: 0, y: SPAWN_Y, z: 0, yaw: 0,
        role: 'hider', alive: true, disguise: 0, target: null, tagT: 0,
        roam: null, lastSeen: null, lostT: 0,
      });
      if (this.game.remotePlayers) this.game.remotePlayers.add(id, `Bot ${this._n}`);
      ids.push(id);
    }
    return ids;
  }

  // Set up each bot for a fresh round.
  beginRound(roles, spawns, disguise) {
    for (const bot of this.bots.values()) {
      bot.role = roles[bot.id] || 'hider';
      bot.alive = true;
      bot.disguise = disguise[bot.id] || 0;
      bot.tagT = 0;
      bot.roam = null; bot.lastSeen = null; bot.lostT = 0;
      const sp = spawns[bot.id];
      if (sp) { bot.x = sp.x; bot.y = sp.y; bot.z = sp.z; }
      // Hiders pick a spot to scuttle to during the countdown.
      bot.target = bot.role === 'hider' ? this._randSpot() : null;
      this._render(bot);
    }
  }

  onEliminated(id) {
    const bot = this.bots.get(id);
    if (bot) { bot.alive = false; bot.target = null; this._render(bot); }
  }

  // A taunt was heard: draw seeker bots within `radius` toward (x,z).
  alert(x, z, radius) {
    for (const bot of this.bots.values()) {
      if (bot.role !== 'seeker' || !bot.alive) continue;
      if (Math.hypot(bot.x - x, bot.z - z) <= radius) { bot.lastSeen = { x, z }; bot.lostT = 0; bot.roam = null; }
    }
  }

  endRound() {
    for (const bot of this.bots.values()) bot.target = null;
  }

  update(dt, state) {
    if (!this.game.remotePlayers) return;
    for (const bot of this.bots.values()) {
      if (!bot.alive) continue; // caught bots stay revealed where they fell
      if (state.phase === 'countdown') {
        if (bot.role === 'hider' && bot.target) this._moveToward(bot, bot.target, HIDE_SPEED, dt);
      } else if (state.phase === 'seeking') {
        if (bot.role === 'seeker') this._seek(bot, state, dt);
        // Hiders lock onto the block grid, exactly like a still disguised
        // player — a bot caught mid-stride by the countdown ending would
        // otherwise freeze off-centre and stick out among the real props.
        else this._settle(bot);
      }
      this._render(bot);
    }
  }

  _seek(bot, state, dt) {
    bot.tagT -= dt;
    const seen = this._spot(bot, state);
    if (seen) {
      // In sight: chase, remember where, and tag if close enough.
      bot.lastSeen = { x: seen.x, z: seen.z };
      bot.lostT = 0;
      bot.roam = null;
      this._moveToward(bot, seen, SEEK_SPEED, dt);
      if (Math.hypot(seen.x - bot.x, seen.z - bot.z) <= TAG_RANGE && bot.tagT <= 0) {
        bot.tagT = TAG_COOLDOWN;
        this.game.hideSeek._resolveTag(bot.id, seen.id);
      }
      return;
    }
    // Lost sight: head to the last known spot for a bit, then give up.
    if (bot.lastSeen) {
      this._moveToward(bot, bot.lastSeen, SEEK_SPEED, dt);
      bot.lostT += dt;
      if (bot.lostT > GIVE_UP || Math.hypot(bot.lastSeen.x - bot.x, bot.lastSeen.z - bot.z) < ARRIVE) {
        bot.lastSeen = null; bot.lostT = 0;
      }
      return;
    }
    // Nobody in view: wander the arena searching.
    if (!bot.roam || Math.hypot(bot.roam.x - bot.x, bot.roam.z - bot.z) < ARRIVE) bot.roam = this._randSpot();
    this._moveToward(bot, bot.roam, WANDER_SPEED, dt);
  }

  // The nearest hider this bot can actually see: within sight range (much
  // shorter for a still, disguised hider) and with a clear line of sight.
  _spot(bot, state) {
    let best = null, bestD = Infinity;
    const consider = (id, x, z, moving) => {
      const d = Math.hypot(x - bot.x, z - bot.z);
      if (d > (moving ? SIGHT : SIGHT_STILL)) return;
      if (d >= bestD || !this._canSee(bot, x, z)) return;
      bestD = d; best = { id, x, z };
    };
    for (const b of this.bots.values()) {
      if (!b.alive || b.role !== 'hider') continue;
      consider(b.id, b.x, b.z, b.target !== null); // still walking to its spot = moving
    }
    if (state.roles['self'] === 'hider' && state.alive['self'] !== false) {
      const p = this.game.player.pos, v = this.game.player.vel;
      // A frozen (disguised) hider has zeroed velocity, so they blend in.
      consider('self', p.x, p.z, Math.hypot(v.x, v.z) > 0.5);
    }
    return best;
  }

  // Voxel line-of-sight sampling at head height: a wall or prop between the
  // bot and the target blocks vision.
  _canSee(bot, tx, tz) {
    const y = FLOOR_Y + 1;
    const dx = tx - bot.x, dz = tz - bot.z;
    const steps = Math.ceil(Math.hypot(dx, dz));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (isSolid(this.game.world.getBlock(Math.floor(bot.x + dx * t), y, Math.floor(bot.z + dz * t)))) return false;
    }
    return true;
  }

  // Snap a hiding bot to the centre of its block and stop moving.
  _settle(bot) {
    bot.x = Math.floor(bot.x) + 0.5;
    bot.z = Math.floor(bot.z) + 0.5;
    bot.target = null;
  }

  _moveToward(bot, tgt, speed, dt) {
    const dx = tgt.x - bot.x, dz = tgt.z - bot.z;
    const d = Math.hypot(dx, dz);
    if (d < ARRIVE) {
      // Hiders settle onto the block centre and hold still, like a real prop.
      if (bot.role === 'hider') {
        bot.x = Math.floor(bot.x) + 0.5;
        bot.z = Math.floor(bot.z) + 0.5;
        bot.target = null;
      }
      return;
    }
    bot.x += (dx / d) * speed * dt;
    bot.z += (dz / d) * speed * dt;
    bot.y = SPAWN_Y;
    bot.yaw = Math.atan2(dx, dz);
  }

  // A place to wander to: one of the map's patrol waypoints (jittered), or a
  // random point in the arena square if the map doesn't define any.
  _randSpot() {
    const spots = activeMap().botSpots;
    if (spots && spots.length) {
      const s = spots[Math.floor(Math.random() * spots.length)];
      return { x: s.x + (Math.random() * 2 - 1) * 4, z: s.z + (Math.random() * 2 - 1) * 4 };
    }
    const R = activeMap().half - 6;
    return { x: (Math.random() * 2 - 1) * R, z: (Math.random() * 2 - 1) * R };
  }

  _render(bot) {
    const rp = this.game.remotePlayers;
    if (!rp) return;
    rp.setState({ id: bot.id, x: bot.x, y: bot.y, z: bot.z, yaw: bot.yaw });
    // Disguise only while a live hider; caught hiders revert to their avatar.
    // A local hider keeps the bot's name tag visible over the block (must match
    // what HideSeek._syncRemoteDisguises passes, or the two calls fight).
    if (rp.setDisguise) {
      const hiding = bot.role === 'hider' && bot.alive;
      const hs = this.game.hideSeek;
      const selfHider = !!hs && hs.state.roles[hs.selfId] === 'hider';
      rp.setDisguise(bot.id, hiding ? bot.disguise : 0, hiding && selfHider);
    }
  }

  clearAll() {
    if (this.game.remotePlayers) for (const id of this.bots.keys()) this.game.remotePlayers.remove(id);
    this.bots.clear();
  }
}
