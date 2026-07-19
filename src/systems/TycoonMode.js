import { Sound } from './Sound.js';
import { PLOTS, plotOf, millStamp, houseStamp } from '../world/arenas/maps/millside.js';
import { FLOOR_Y } from '../world/arenas/lib.js';
import { isSolid } from '../blocks/BlockRegistry.js';

// Tycoon mode: a persistent idle world (no rounds, no phases). Each player
// claims one of Millside's four plots by stepping on its golden pad; AI
// workers shuttle logs from the plot's grove to its mill, and every delivery
// pays the plot cash. Purchases happen at the plot's three wall pads.
//
// Same authoritative-manager shape as ZombiesMode: solo/host simulates and
// broadcasts `state`, guests mirror it and send buy intents over the shared
// match/matchState channel. Unlike zombies points, tycoon state persists —
// Game.serialize() stores the plots (keyed by player *name*, so money and
// upgrades survive reload and rejoin; the pets rebind-by-name precedent).
//
// The mill/house buildings are never part of this state: upgrades stamp
// prefabs (millStamp/houseStamp) as ordinary world edits, which the edit
// machinery already syncs to guests and persists in World.edits.

// Cost of hiring worker #(n+1) when you have n (the first comes with the plot).
export const WORKER_COSTS = [0, 25, 75, 200, 500, 1200];
export const MAX_WORKERS = 6;

// Mill: tier -> upgrade cost / $ per delivery / worker speed multiplier.
export const MILL_COSTS = { 2: 50, 3: 300, 4: 1500 };
export const MILL_PAY = { 1: 4, 2: 9, 3: 22, 4: 55 };
export const MILL_SPEED = { 1: 1.0, 2: 1.15, 3: 1.3, 4: 1.5 };
export const MAX_MILL = 4;

// House: purely visual tiers (the flex).
export const HOUSE_COSTS = { 1: 100, 2: 600, 3: 2500 };
export const MAX_HOUSE = 3;

const FY = FLOOR_Y;

export class TycoonMode {
  constructor(game) {
    this.game = game;
    this.net = game.net || null;
    // Solo and the multiplayer host run the simulation; guests only mirror it.
    this.authoritative = !this.net || this.net.isHost;
    this.selfId = this.net ? this.net.id : 'self';
    this.selfName = (typeof localStorage !== 'undefined' && localStorage.getItem('apex_player_name')) || 'Player';
    this.state = this._emptyState();
    this._bcastT = 0;
    this.onChanged = null; // set by Game: fires onMatch + (host) broadcasts
  }

  _emptyState() {
    return {
      // One record per Millside plot, index-aligned with PLOTS. mill 0 =
      // unclaimed; a null owner with an ownerName is a reserved plot waiting
      // for that player to return.
      plots: PLOTS.map(() => ({ owner: null, ownerName: null, money: 0, mill: 0, house: 0, workers: 0 })),
    };
  }

  // Index of the local player's plot, or -1 (the HUD reads this too).
  myPlot() {
    return this.state.plots.findIndex((p) => p.owner === this.selfId);
  }

  // ---- Persistence (authority only; guests get state over the wire) ----

  load(saved) {
    if (!saved || !Array.isArray(saved.plots)) return;
    const s = this._emptyState();
    saved.plots.forEach((r, i) => {
      if (!s.plots[i] || !r) return;
      s.plots[i] = {
        owner: null, // pids are session-scoped; names rebind below / on join
        ownerName: r.ownerName || null,
        money: Math.max(0, +r.money || 0),
        mill: Math.min(MAX_MILL, Math.max(0, +r.mill || 0)),
        house: Math.min(MAX_HOUSE, Math.max(0, +r.house || 0)),
        workers: Math.min(MAX_WORKERS, Math.max(0, +r.workers || 0)),
      };
    });
    this.state = s;
    // Solo: rebind our plot — by name if it matches, else the first claimed
    // plot (a renamed solo player must never be locked out of their tycoon).
    if (!this.net) {
      const mine = s.plots.find((p) => p.mill > 0 && p.ownerName === this.selfName)
        || s.plots.find((p) => p.mill > 0);
      if (mine) mine.owner = 'self';
    } else {
      // Hosting from this save: rebind the host's own plot by name.
      const mine = s.plots.find((p) => p.mill > 0 && p.ownerName === this.selfName);
      if (mine) mine.owner = this.selfId;
    }
    this._changed();
  }

  serialize() {
    return {
      plots: this.state.plots.map((p) => ({
        ownerName: p.ownerName, money: p.money, mill: p.mill, house: p.house, workers: p.workers,
      })),
    };
  }

  // ---- Per-frame update (authority only — guests have nothing to tick) ----

  update(dt) {
    if (!this.authoritative) return;
    this._claimSweep();
    this._workerCensus();

    // Re-broadcast ~1 Hz so late state (money ticks) reaches guests even if
    // an event-driven broadcast got lost.
    this._bcastT += dt;
    if (this.net && this.net.isHost && this._bcastT >= 1) { this._bcastT = 0; this._changed(); }
  }

  // Roster of live players the authority can see: [{id, name, pos}].
  _players() {
    const out = [{ id: 'self', name: this.selfName, pos: this.game.player.pos }];
    if (this.net) {
      out[0].id = this.net.id;
      for (const rp of this.game.remotePlayers.list()) {
        out.push({ id: rp.id, name: this.net.players.get(rp.id)?.name || 'Player', pos: rp.pos });
      }
    }
    return out;
  }

  // Step-on claiming: any plotless player standing on an unclaimed plot's
  // golden pad takes it. The authority resolves in roster order, so two
  // players racing the same pad can never both win it.
  _claimSweep() {
    const s = this.state;
    for (const pl of this._players()) {
      if (s.plots.some((p) => p.owner === pl.id)) continue; // already an owner
      const x = Math.floor(pl.pos.x), z = Math.floor(pl.pos.z);
      const i = s.plots.findIndex((p, idx) => {
        if (p.owner || p.ownerName) return false; // taken or reserved
        const c = PLOTS[idx].claim;
        return x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1;
      });
      if (i < 0) continue;
      const p = s.plots[i];
      p.owner = pl.id;
      p.ownerName = pl.name;
      p.mill = 1;
      p.workers = 1;
      if (pl.id === this.selfId) this.game.onToast?.('🏡 Plot claimed! Your first worker is on the job');
      this._changed();
    }
  }

  // Keep each claimed, online plot's worker mobs in line with its state:
  // spawn any deficit at the mill (workers are never persisted as mobs — the
  // count is the truth and this census self-heals loads, host migration, and
  // void falls). Offline owners pause their crew instead.
  _workerCensus() {
    const s = this.state;
    const live = new Map(); // plot index -> count
    for (const m of this.game.mobs.mobs) {
      if (m.workData && !m.dead) live.set(m.workData.plot, (live.get(m.workData.plot) || 0) + 1);
    }
    for (let i = 0; i < s.plots.length; i++) {
      const p = s.plots[i];
      const paused = !p.owner;
      // Keep existing crews in sync with tier speed + owner presence.
      for (const m of this.game.mobs.mobs) {
        if (m.workData && m.workData.plot === i) {
          m.workData.paused = paused;
          m.workData.speedMul = MILL_SPEED[p.mill] || 1;
        }
      }
      if (paused || p.workers <= 0) continue;
      const deficit = p.workers - (live.get(i) || 0);
      for (let n = 0; n < deficit; n++) this._spawnWorker(i);
    }
  }

  _spawnWorker(i) {
    const plot = PLOTS[i];
    const mx = Math.floor(plot.mill.x), mz = Math.floor(plot.mill.z);
    // Wait until the mill's chunk is generated (the pregen race at load) —
    // a worker spawned into void air would just fall out of the world.
    if (!isSolid(this.game.world.getBlock(mx, FY, mz))) return;
    const mob = this.game.mobs.spawnAt('worker', plot.mill.x, FY + 1, plot.mill.z);
    if (!mob) return;
    mob.workData = {
      plot: i,
      source: { x: plot.source.x, y: FY + 1, z: plot.source.z },
      mill: { x: plot.mill.x, y: FY + 1, z: plot.mill.z },
      speedMul: MILL_SPEED[this.state.plots[i].mill] || 1,
      paused: !this.state.plots[i].owner,
      onDeliver: () => this._credit(i),
    };
  }

  // A worker delivered a load at the mill: pay the plot by its mill tier.
  _credit(i) {
    const p = this.state.plots[i];
    if (!p || !p.owner) return;
    p.money += MILL_PAY[p.mill] || 0;
    this._changed();
  }

  // ---- Purchasing (the three wall pads; buyWall pattern) ----

  // What the next purchase of `kind` costs on plot record `p`, or a refusal
  // string. Exported logic for the HUD's cost hints via nextCost().
  static nextCost(p, kind) {
    if (kind === 'worker') {
      return p.workers >= MAX_WORKERS ? null : WORKER_COSTS[p.workers];
    }
    if (kind === 'mill') return p.mill >= MAX_MILL ? null : MILL_COSTS[p.mill + 1];
    if (kind === 'house') return p.house >= MAX_HOUSE ? null : HOUSE_COSTS[p.house + 1];
    return null;
  }

  // A tycoon pad was right-clicked. Returns a refusal reason string (for the
  // toast) or null on success. Optimistic on guests: apply locally, send the
  // intent, and let the next broadcast settle any race.
  usePad(blockName, pos) {
    const kind = blockName.slice('tycoon_pad_'.length); // worker | mill | house
    const i = plotOf(pos.x, pos.z);
    const p = this.state.plots[i];
    if (!p) return 'No plot here';
    if (p.owner !== this.selfId) {
      return p.owner || p.ownerName
        ? `This is ${p.ownerName || 'someone'}'s plot`
        : 'Claim this plot first — step on its golden pad';
    }
    const cost = TycoonMode.nextCost(p, kind);
    if (cost == null) {
      return kind === 'worker' ? `Your crew is full (${MAX_WORKERS} workers)`
        : kind === 'mill' ? 'Your mill is fully upgraded'
        : 'Your house is fully upgraded';
    }
    if (p.money < cost) return `${LABELS[kind]} costs $${cost} — you have $${p.money}`;

    if (this.authoritative) {
      this._applyBuy(i, kind, cost);
    } else {
      // Optimistic local apply; the host re-validates and its broadcast wins.
      p.money -= cost;
      this._bump(p, kind);
      this._changed(true);
      this.net.sendMatch({ action: 'buy', kind, plot: i });
    }
    Sound.eat();
    this.game.onToast?.(`${EMOJI[kind]} ${LABELS[kind]} — $${cost}`);
    return null;
  }

  _bump(p, kind) {
    if (kind === 'worker') p.workers += 1;
    else if (kind === 'mill') p.mill += 1;
    else if (kind === 'house') p.house += 1;
  }

  // Authority-side purchase: mutate state, stamp the building, broadcast.
  _applyBuy(i, kind, cost) {
    const p = this.state.plots[i];
    p.money -= cost;
    this._bump(p, kind);
    if (kind === 'mill') this._stamp(millStamp(i, p.mill));
    else if (kind === 'house') this._stamp(houseStamp(i, p.house));
    // Workers spawn via the census on the next tick.
    this._changed();
  }

  // Apply a prefab as ordinary world edits, batched into one net message so a
  // ~600-cell building doesn't flood the relay (the mega-TNT pattern).
  _stamp(cells) {
    if (this.net) this.net.beginEditBatch();
    for (const c of cells) this.game.world.setBlock(c.x, c.y, c.z, c.id);
    if (this.net) this.net.endEditBatch();
  }

  // ---- Authoritative intent handling (host receives guest commands) ----

  handleIntent(fromId, msg) {
    if (!this.authoritative || !msg) return;
    if (msg.action === 'buy') {
      const i = +msg.plot;
      const p = this.state.plots[i];
      if (!p || p.owner !== fromId) return; // not theirs (or a stale intent)
      const cost = TycoonMode.nextCost(p, msg.kind);
      if (cost == null || p.money < cost) { this._changed(); return; } // correct the optimist
      this._applyBuy(i, msg.kind, cost);
    } else if (msg.action === 'devGrant') {
      this.devGrant(fromId);
    }
  }

  // Dev-only money tap (localhost): +$500 to the caller's plot.
  devGrant(id = this.selfId) {
    if (!this.game.dev) return;
    if (!this.authoritative) { this.net.sendMatch({ action: 'devGrant' }); return; }
    const p = this.state.plots.find((pl) => pl.owner === id);
    if (!p) return;
    p.money += 500;
    this._changed();
  }

  // ---- Roster churn ----

  // A player joined: hand their reserved plot back, matched by name.
  playerJoined(id, name) {
    if (!this.authoritative) return;
    for (const p of this.state.plots) {
      if (!p.owner && p.ownerName === name && p.mill > 0) {
        p.owner = id;
        this._changed();
        return;
      }
    }
  }

  // A player disconnected: reserve their plot (keep name, money, tiers). The
  // census pauses their workers next tick. Runs on every client, like the
  // zombies roster — the authority's broadcast makes it stick.
  playerLeft(id) {
    for (const p of this.state.plots) {
      if (p.owner === id) {
        p.owner = null;
        if (this.authoritative) this._changed();
      }
    }
  }

  // Host migration: this client now owns the simulation. Worker mobs died
  // with the old host's MobManager; the census respawns them from the
  // last-synced state on the next update.
  becomeAuthority() {
    this.authoritative = true;
    this._changed();
  }

  // ---- Guest application of broadcast state ----

  applyState(s) {
    if (!s || !Array.isArray(s.plots)) return;
    this.state = s;
    this._changed(true);
  }

  // Notify React and (host) broadcast. `received` = applied from the network,
  // so don't re-broadcast it.
  _changed(received = false) {
    if (this.onChanged) this.onChanged(this.state, received);
  }
}

const LABELS = { worker: 'Hire a worker', mill: 'Mill upgrade', house: 'House upgrade' };
const EMOJI = { worker: '🪓', mill: '🏭', house: '🏠' };
