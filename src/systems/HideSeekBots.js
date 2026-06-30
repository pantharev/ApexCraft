import { FLOOR_Y, ARENA_HALF } from '../world/arenas/index.js';
import { TAG_RANGE } from './HideSeek.js';

// Simple Prop Hunt bots so a solo player has opponents. Only the authority
// (solo player or multiplayer host) runs these; they're socket-less virtual
// players rendered through the RemotePlayers pool. The AI is intentionally
// crude: hiders walk to a spot and freeze; seekers home in on the nearest
// hider and tag it.

const SPAWN_Y = FLOOR_Y + 1;
const SEEK_SPEED = 4.2;
const HIDE_SPEED = 4.5;
const ARRIVE = 1.2;        // distance at which a bot "arrives" at its target
const TAG_COOLDOWN = 1.2;  // seconds between a seeker bot's tag attempts

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
        // Hiders hold still once disguised.
      }
      this._render(bot);
    }
  }

  _seek(bot, state, dt) {
    // Gather every alive hider: other bots plus the local player if hiding.
    let best = null, bestD = Infinity;
    for (const b of this.bots.values()) {
      if (!b.alive || b.role !== 'hider') continue;
      const d = Math.hypot(b.x - bot.x, b.z - bot.z);
      if (d < bestD) { bestD = d; best = { id: b.id, x: b.x, z: b.z }; }
    }
    if (state.roles['self'] === 'hider' && state.alive['self'] !== false) {
      const p = this.game.player.pos;
      const d = Math.hypot(p.x - bot.x, p.z - bot.z);
      if (d < bestD) { bestD = d; best = { id: 'self', x: p.x, z: p.z }; }
    }
    if (!best) return;
    this._moveToward(bot, best, SEEK_SPEED, dt);
    bot.tagT -= dt;
    if (bestD <= TAG_RANGE && bot.tagT <= 0) {
      bot.tagT = TAG_COOLDOWN;
      this.game.hideSeek._resolveTag(bot.id, best.id);
    }
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

  _randSpot() {
    const R = ARENA_HALF - 6;
    return { x: (Math.random() * 2 - 1) * R, z: (Math.random() * 2 - 1) * R };
  }

  _render(bot) {
    const rp = this.game.remotePlayers;
    if (!rp) return;
    rp.setState({ id: bot.id, x: bot.x, y: bot.y, z: bot.z, yaw: bot.yaw });
    // Disguise only while a live hider; caught hiders revert to their avatar.
    if (rp.setDisguise) rp.setDisguise(bot.id, bot.role === 'hider' && bot.alive ? bot.disguise : 0);
  }

  clearAll() {
    if (this.game.remotePlayers) for (const id of this.bots.keys()) this.game.remotePlayers.remove(id);
    this.bots.clear();
  }
}
