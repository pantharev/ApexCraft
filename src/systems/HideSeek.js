import { getBlock } from '../blocks/BlockRegistry.js';
import { buildBlockCube } from '../items/ItemModels.js';
import { emojiSprite } from '../net/RemotePlayers.js';
import { seekerSpawn, hiderSpawns, propIds } from '../world/arenas/index.js';
import { tauntById } from './taunts.js';

// Prop Hunt round state machine. Host/solo-authoritative: it owns the match
// state, advances the phase timers, assigns roles, teleports players, and
// decides the winner. Guests don't run any of this — they just receive the
// broadcast state via applyState() and render it.
//
// Phases: lobby -> countdown (hiders disperse & disguise; seekers penned) ->
// seeking (seekers hunt; tags eliminate hiders) -> roundEnd -> back to lobby.

const HIDE_TIME = 20;   // seconds hiders get to disperse and disguise
const SEEK_TIME = 150;  // seconds seekers get to find everyone
const END_TIME = 8;     // results screen before returning to the lobby
const TARGET_PLAYERS = 6; // fill up to this many with bots (solo/host)
export const TAG_RANGE = 4;
const STUN_TIME = 3;    // seconds a seeker is frozen after a wrong guess
const SEEKER_RATIO = 4; // ~1 seeker per this many players
const TAUNT_COOLDOWN = 2.5; // seconds between a player's taunts

export class HideSeek {
  constructor(game) {
    this.game = game;
    this.net = game.net || null;
    // Solo and the multiplayer host run the simulation; guests only mirror it.
    this.authoritative = !this.net || this.net.isHost;
    this.selfId = this.net ? this.net.id : 'self';
    // Disguise palette (block ids) of the active arena map, exposed for the
    // HUD. Resolved here (not at module scope) so each world gets its own map's
    // palette — a page session can open worlds with different maps.
    this.propIds = propIds();
    this.state = this._emptyState();
    this._applied = { phase: null, role: null, alive: true }; // last applied to the local player
    this.onChanged = null; // set by Game: fires onMatch + (host) broadcasts
  }

  _emptyState() {
    return { phase: 'lobby', timeLeft: 0, round: 0, roles: {}, alive: {}, disguise: {}, stun: {}, spawns: {}, score: {}, winner: null };
  }

  // ---- Roster (authoritative only) ----

  _humans() {
    if (!this.net) return ['self'];
    return [this.net.id, ...this.net.players.keys()];
  }

  // ---- Public control (from the HUD / Game) ----

  // Begin a round: fill with bots, assign roles, teleport, enter countdown.
  start() {
    if (!this.authoritative || this.state.phase === 'countdown' || this.state.phase === 'seeking') return;
    const humans = this._humans();
    let botIds = [];
    if (this.game.hsBots) {
      const need = Math.max(0, TARGET_PLAYERS - humans.length);
      botIds = this.game.hsBots.spawn(need);
    }
    const ids = [...humans, ...botIds];

    // Assign roles: ~1 seeker per SEEKER_RATIO players, at least one.
    const shuffled = this._shuffle(ids.slice());
    const numSeekers = Math.max(1, Math.floor(ids.length / SEEKER_RATIO));
    const roles = {}, alive = {}, disguise = {}, stun = {}, score = {};
    const prevScore = this.state.score || {}; // style score is cumulative across rounds
    shuffled.forEach((id, i) => {
      roles[id] = i < numSeekers ? 'seeker' : 'hider';
      alive[id] = true;
      score[id] = prevScore[id] || 0;
    });

    // Spawn placement + default disguises for hiders.
    const hiderList = ids.filter((id) => roles[id] === 'hider');
    const seekerList = ids.filter((id) => roles[id] === 'seeker');
    const hSpawns = hiderSpawns(hiderList.length);
    const spawns = {};
    hiderList.forEach((id, i) => {
      spawns[id] = hSpawns[i];
      disguise[id] = this.propIds[Math.floor(Math.random() * this.propIds.length)];
    });
    seekerList.forEach((id, i) => { spawns[id] = seekerSpawn(i); });

    this.state = {
      phase: 'countdown', timeLeft: HIDE_TIME, round: this.state.round + 1,
      roles, alive, disguise, stun, spawns, score, winner: null,
    };
    this._teleportLocal();
    if (this.game.hsBots) this.game.hsBots.beginRound(roles, spawns, disguise);
    this._changed();
  }

  // A hider chooses the block to disguise as.
  pickDisguise(blockId) {
    if (this.state.roles[this.selfId] !== 'hider') return;
    if (this.authoritative) {
      this.state.disguise[this.selfId] = blockId;
      this._changed();
    } else {
      this.net.sendMatch({ action: 'disguise', blockId });
    }
  }

  // The local seeker swung at targetId (a remote/bot hider). Null = a miss.
  tag(targetId) {
    if (this.authoritative) this._resolveTag(this.selfId, targetId);
    else this.net.sendMatch({ action: 'tag', target: targetId });
  }

  // A hider triggers a taunt: a floating emoji + style points, at the cost of
  // drawing seekers toward them.
  taunt(tauntId) {
    if (this.authoritative) this._applyTaunt(this.selfId, tauntId);
    else this.net.sendMatch({ action: 'taunt', id: tauntId });
  }

  // ---- Authoritative intent handling (host receives guest commands) ----

  handleIntent(fromId, msg) {
    if (!this.authoritative || !msg) return;
    if (msg.action === 'start') this.start();
    else if (msg.action === 'disguise') {
      if (this.state.roles[fromId] === 'hider') { this.state.disguise[fromId] = msg.blockId; this._changed(); }
    } else if (msg.action === 'tag') this._resolveTag(fromId, msg.target);
    else if (msg.action === 'taunt') this._applyTaunt(fromId, msg.id);
  }

  // A player disconnected mid-match: drop them from the roster. Without this a
  // departed hider is an untaggable ghost — seekers could never clear the round
  // and would always time out to "hiders win". Runs on every client (the local
  // state is corrected immediately; on guests the next host broadcast agrees),
  // but only the authority may decide the round from it.
  playerLeft(id) {
    const s = this.state;
    if (!(id in s.roles)) return;
    delete s.roles[id];
    delete s.alive[id];
    delete s.disguise[id];
    delete s.stun[id];
    delete s.spawns[id];
    if (this.authoritative && s.phase === 'seeking') this._checkWin();
    this._changed();
  }

  // Host migration: this client now owns the simulation. The departed host may
  // still be in the roster (leave/migration event order isn't guaranteed), so
  // re-check the win condition on takeover rather than waiting for the next tag.
  becomeAuthority() {
    this.authoritative = true;
    if (this.state.phase === 'seeking') this._checkWin();
  }

  // Authoritative: award style points, alert nearby seekers, play + broadcast
  // the effect, and queue the llama's cosmetic blast.
  _applyTaunt(playerId, tauntId) {
    const def = tauntById[tauntId];
    const s = this.state;
    if (!def || s.phase !== 'seeking') return;
    if (s.roles[playerId] !== 'hider' || s.alive[playerId] === false) return;
    if (!this._tauntCd) this._tauntCd = {};
    if ((this._tauntCd[playerId] || 0) > 0) return; // still cooling down
    this._tauntCd[playerId] = TAUNT_COOLDOWN;

    s.score[playerId] = (s.score[playerId] || 0) + def.points;

    const pos = this._playerPos(playerId);
    if (pos && this.game.hsBots) this.game.hsBots.alert(pos.x, pos.z, def.alert);

    this.game.playTauntFx(playerId, tauntId);
    if (this.net && this.net.isHost) this.net.sendTaunt({ id: playerId, taunt: tauntId });

    if (def.explode) {
      if (!this._llamas) this._llamas = [];
      this._llamas.push({ id: playerId, tEnd: def.duration });
    }
    this._changed();
  }

  // Best-known world position of a participant (self / bot / remote).
  _playerPos(playerId) {
    if (playerId === this.selfId) { const p = this.game.player.pos; return { x: p.x, y: p.y, z: p.z }; }
    if (playerId.startsWith('#bot:') && this.game.hsBots) {
      const b = this.game.hsBots.bots.get(playerId);
      if (b) return { x: b.x, y: b.y, z: b.z };
    }
    const rp = this.game.remotePlayers;
    if (rp && rp.map.has(playerId)) { const c = rp.map.get(playerId).cur; return { x: c.x, y: c.y, z: c.z }; }
    return null;
  }

  _resolveTag(seekerId, targetId) {
    if (this.state.phase !== 'seeking') return;
    if (this.state.roles[seekerId] !== 'seeker') return;
    if (this._stunned(seekerId)) return;
    const hit = targetId && this.state.roles[targetId] === 'hider' && this.state.alive[targetId];
    if (hit) {
      this.state.alive[targetId] = false;
      if (this.game.hsBots) this.game.hsBots.onEliminated(targetId);
      this._checkWin();
    } else {
      // Wrong guess: stun the seeker for a few seconds (remaining-seconds form).
      this.state.stun[seekerId] = STUN_TIME;
    }
    this._changed();
  }

  // ---- Per-frame update ----

  update(dt) {
    if (this.authoritative) this._tick(dt);
    if (this.game.hsBots) this.game.hsBots.update(dt, this.state);
    this._syncRemoteDisguises();
    this._applyLocal(dt);
    this._tickLocalTaunt(dt);
  }

  // A taunt emoji over the local player's own head — they're first-person with
  // no RemotePlayers avatar, so it lives directly in the scene. (Hiders are in
  // third person, so they see it float above their block.)
  showLocalTaunt(emoji, ttl) {
    this._clearLocalTaunt();
    const sprite = emojiSprite(emoji);
    this.game.scene.add(sprite);
    this._localTaunt = { sprite, ttl, age: 0 };
  }

  _tickLocalTaunt(dt) {
    const lt = this._localTaunt;
    if (!lt) return;
    lt.age += dt;
    const f = lt.age / lt.ttl;
    const p = this.game.player.pos;
    lt.sprite.position.set(p.x, p.y + 2.4 + f * 0.6, p.z);
    lt.sprite.material.opacity = Math.max(0, 1 - f);
    if (f >= 1) this._clearLocalTaunt();
  }

  _clearLocalTaunt() {
    const lt = this._localTaunt;
    if (!lt) return;
    this.game.scene.remove(lt.sprite);
    lt.sprite.material.map.dispose();
    lt.sprite.material.dispose();
    this._localTaunt = null;
  }

  // Reflect every other participant's disguise onto their remote avatar so
  // hiders look like blocks to everyone but themselves. Fellow hiders keep the
  // name tag over the block (so they know which props are friends — bots
  // included); seekers never see it.
  _syncRemoteDisguises() {
    const rp = this.game.remotePlayers;
    if (!rp) return;
    const selfHider = this.state.roles[this.selfId] === 'hider';
    for (const id of Object.keys(this.state.roles)) {
      if (id === this.selfId) continue;
      const hiding = this.state.roles[id] === 'hider' && this.state.alive[id] !== false;
      rp.setDisguise(id, hiding ? (this.state.disguise[id] || 0) : 0, hiding && selfHider);
    }
  }

  _tick(dt) {
    const s = this.state;
    if (s.phase === 'lobby') return; // wait for start()
    s.timeLeft -= dt;
    // Count down any seeker stuns (stored as remaining seconds so it's
    // clock-independent across clients).
    for (const id of Object.keys(s.stun)) {
      if (s.stun[id] > 0) s.stun[id] = Math.max(0, s.stun[id] - dt);
    }
    // Count down taunt cooldowns and resolve exploding-llama timers.
    if (this._tauntCd) for (const id of Object.keys(this._tauntCd)) {
      if (this._tauntCd[id] > 0) this._tauntCd[id] = Math.max(0, this._tauntCd[id] - dt);
    }
    if (this._llamas && this._llamas.length) {
      const due = [];
      this._llamas = this._llamas.filter((l) => { l.tEnd -= dt; if (l.tEnd <= 0) { due.push(l); return false; } return true; });
      for (const l of due) {
        const pos = this._playerPos(l.id);
        if (pos) this.game.cosmeticBoom(pos.x, pos.y + 0.5, pos.z, 3.2);
      }
    }
    if (s.phase === 'countdown') {
      if (s.timeLeft <= 0) { s.phase = 'seeking'; s.timeLeft = SEEK_TIME; this._changed(); }
    } else if (s.phase === 'seeking') {
      if (s.timeLeft <= 0) this._endRound('hiders'); // time up — hiders survive
    } else if (s.phase === 'roundEnd') {
      // Carry the cumulative style score into the next lobby.
      if (s.timeLeft <= 0) { this.state = { ...this._emptyState(), round: s.round, score: s.score }; this._changed(); }
    }
    // Re-broadcast ~1 Hz so multiplayer guests keep their timers/stuns in sync.
    this._bcastT = (this._bcastT || 0) + dt;
    if (this.net && this.net.isHost && this._bcastT >= 1) { this._bcastT = 0; this._changed(); }
  }

  _checkWin() {
    const s = this.state;
    const hidersLeft = Object.keys(s.roles).some((id) => s.roles[id] === 'hider' && s.alive[id]);
    if (!hidersLeft) this._endRound('seekers');
  }

  _endRound(winner) {
    this.state.phase = 'roundEnd';
    this.state.winner = winner;
    this.state.timeLeft = END_TIME;
    if (this.game.hsBots) this.game.hsBots.endRound();
    this._changed();
  }

  // ---- Local player reconciliation (runs on every client) ----

  // Drive the local player's freeze/flight/position to match its role + phase.
  _applyLocal(dt = 0) {
    const s = this.state;
    const role = s.roles[this.selfId];
    const alive = s.alive[this.selfId] !== false;
    const player = this.game.player;

    // Teleport the local player when a fresh round begins (countdown entry).
    if (s.phase === 'countdown' && this._applied.phase !== 'countdown') {
      this._teleportLocal();
    }

    if (role === undefined || s.phase === 'lobby') {
      player.flying = false;
    } else if (!alive) {
      // Eliminated hider: free-fly spectator.
      player.flying = true;
      player.enabled = this.game.openScreen === null;
    } else if (role === 'seeker') {
      // Seekers are penned (frozen) during the hide countdown, freed to seek.
      const stunned = this._stunned(this.selfId);
      player.flying = false;
      player.enabled = s.phase !== 'countdown' && !stunned && this.game.openScreen === null;
    } else { // alive hider
      player.flying = false;
      player.enabled = this.game.openScreen === null;
    }

    // Only seekers see a hand (to swing/tag); hiders & spectators hide it.
    if (this.game.heldAnchor) this.game.heldAnchor.visible = role === 'seeker' && alive;

    this._applyLocalDisguise(role, alive, dt);
    this._applied = { phase: s.phase, role, alive };
  }

  // A hiding hider sees themselves in third person as their chosen block, so
  // they can tell what they look like to seekers.
  _applyLocalDisguise(role, alive, dt = 0) {
    const s = this.state;
    const hiding = role === 'hider' && alive && (s.phase === 'countdown' || s.phase === 'seeking');
    this.game.player.thirdPerson = hiding;
    const blockId = hiding ? (s.disguise[this.selfId] || 0) : 0;
    if (!blockId) {
      if (this._localMesh) { this.game.scene.remove(this._localMesh); this._localMesh = null; this._localDisguiseId = 0; }
      return;
    }
    if (this._localDisguiseId !== blockId) {
      if (this._localMesh) this.game.scene.remove(this._localMesh);
      // Full block size so it matches the arena's real placed blocks.
      this._localMesh = buildBlockCube(getBlock(blockId).name, 1.0, true);
      this.game.scene.add(this._localMesh);
      this._localDisguiseId = blockId;
      this._dScale = 0.86;
    }
    // Prop Hunt: when not actively walking, snap to the block centre and freeze
    // so the disguise sits perfectly still like a real placed block. Walking
    // (WASD / joystick) releases the lock until the player stops again.
    const player = this.game.player;
    const p = player.pos;
    const moving = this._hasMoveInput();
    if (!moving) {
      p.x = Math.floor(p.x) + 0.5;
      p.z = Math.floor(p.z) + 0.5;
      player.vel.x = 0;
      player.vel.z = 0;
    }
    // Ease the block to full size once settled, slightly smaller while walking,
    // so it visibly "snaps to fit" the surrounding blocks when you stop.
    const targetScale = moving ? 0.86 : 1.0;
    if (this._dScale === undefined) this._dScale = targetScale;
    this._dScale += (targetScale - this._dScale) * Math.min(1, dt * 14);
    this._localMesh.scale.setScalar(this._dScale);
    this._localMesh.position.set(p.x, p.y + 0.5, p.z);
  }

  _hasMoveInput() {
    const pl = this.game.player;
    if (pl._touchMove) return true;
    const k = pl.keys;
    return !!(k['KeyW'] || k['KeyA'] || k['KeyS'] || k['KeyD']);
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
    // The host may have given us a spawn this client doesn't know yet; positions
    // come through here implicitly via role + phase (we don't hard-teleport guests
    // beyond the local reconciliation, which the host already authored).
    this.state = s;
    this._changed(true);
  }

  // ---- Helpers ----

  _stunned(id) { return (this.state.stun[id] || 0) > 0; }

  _shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Notify React and (host) broadcast. `received` = applied from the network,
  // so don't re-broadcast it.
  _changed(received = false) {
    if (this.onChanged) this.onChanged(this.state, received);
  }
}
