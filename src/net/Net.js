import { io } from 'socket.io-client';
import { CHUNK_SIZE } from '../config.js';

// Client-side multiplayer connection (Socket.IO). One Net instance lives for
// one session: host a world or join one by room code, then exchange player
// state, block edits, mob snapshots, and projectiles with the room.
//
// The game is host-authoritative for mobs: the hosting client simulates them
// and broadcasts snapshots; guests render ghosts and report hits back.

const ACK_TIMEOUT = 6000;

// Server URL: explicit VITE_GAME_SERVER wins; localhost dev talks to the local
// server on :3001; otherwise assume same-origin (server serving dist/).
function defaultUrl() {
  const env = import.meta.env?.VITE_GAME_SERVER;
  if (env) return env;
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    return `http://${location.hostname}:3001`;
  }
  return location.origin;
}

// Block edits travel in the same chunk-keyed form the save system uses:
// { k: "cx,cz", i: localIndex, id } — see World.serializeEdits / Chunk.index.
export function encodeEdit(x, y, z) {
  const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
  const lx = x - cx * CHUNK_SIZE, lz = z - cz * CHUNK_SIZE;
  return { k: `${cx},${cz}`, i: (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx };
}

export function decodeEdit(k, i) {
  const [cx, cz] = k.split(',').map(Number);
  const lx = i % CHUNK_SIZE;
  const lz = Math.floor(i / CHUNK_SIZE) % CHUNK_SIZE;
  const y = Math.floor(i / (CHUNK_SIZE * CHUNK_SIZE));
  return { x: cx * CHUNK_SIZE + lx, y, z: cz * CHUNK_SIZE + lz };
}

export class Net {
  constructor(url = defaultUrl()) {
    this.socket = io(url, { reconnection: true, timeout: ACK_TIMEOUT });
    this.code = null;
    this.isHost = false;   // currently simulating mobs (can change on migration)
    this.isOrigin = false; // hosted from a local world (only the origin persists saves)
    this.players = new Map(); // id -> { name } (others in the room, not self)
    this.applying = false; // true while applying a remote edit (suppresses echo)

    // Game wires these up; default no-ops so events before wiring are safe.
    this.onEdit = null;         // (x, y, z, id)
    this.onPlayerState = null;  // ({id, x, y, z, yaw, pitch})
    this.onPlayerJoined = null; // ({id, name})
    this.onPlayerLeft = null;   // ({id})
    this.onMobs = null;         // (snapshot)
    this.onProjectile = null;   // ({x,y,z,dx,dy,dz,speed,dmg,target})
    this.onBoom = null;         // ({x,y,z,r}) — explosion visuals + self-damage
    this.onChess = null;        // ({from, action, key, ...}) — host only
    this.onChessState = null;   // (view) — authoritative table state
    this.onMatch = null;        // ({from, action, ...}) — hide & seek intent, host only
    this.onMatchState = null;   // (state) — authoritative hide & seek round state
    this.onTaunt = null;        // ({id, taunt}) — a taunt to render (host -> room)
    this.onHitPlayer = null;    // (dmg)
    this.onMobHit = null;       // ({i, dmg, x, y, z}) — host only
    this.onBecomeHost = null;   // ()
    this.onTime = null;         // (t)
    this.onPeers = null;        // () — player list changed

    this.socket.on('edit', (e) => {
      if (!this.onEdit || !e) return;
      const { x, y, z } = decodeEdit(e.k, e.i);
      this.onEdit(x, y, z, e.id);
    });
    this.socket.on('playerState', (s) => this.onPlayerState && this.onPlayerState(s));
    this.socket.on('playerJoined', (p) => {
      this.players.set(p.id, { name: p.name });
      if (this.onPlayerJoined) this.onPlayerJoined(p);
      if (this.onPeers) this.onPeers();
    });
    this.socket.on('playerLeft', (p) => {
      this.players.delete(p.id);
      if (this.onPlayerLeft) this.onPlayerLeft(p);
      if (this.onPeers) this.onPeers();
    });
    this.socket.on('mobs', (snap) => this.onMobs && this.onMobs(snap));
    this.socket.on('projectile', (p) => this.onProjectile && this.onProjectile(p));
    this.socket.on('boom', (b) => this.onBoom && this.onBoom(b));
    this.socket.on('chess', (m) => this.onChess && this.onChess(m));
    this.socket.on('chessState', (v) => this.onChessState && this.onChessState(v));
    this.socket.on('match', (m) => this.onMatch && this.onMatch(m));
    this.socket.on('matchState', (s) => this.onMatchState && this.onMatchState(s));
    this.socket.on('taunt', (m) => this.onTaunt && this.onTaunt(m));
    this.socket.on('hitPlayer', (m) => this.onHitPlayer && this.onHitPlayer(m.dmg, m.kx || 0, m.kz || 0));
    this.socket.on('mobHit', (m) => this.onMobHit && this.onMobHit(m));
    this.socket.on('time', (t) => this.onTime && this.onTime(t));
    this.socket.on('becomeHost', () => {
      this.isHost = true;
      if (this.onBecomeHost) this.onBecomeHost();
    });
  }

  _ack(event, payload) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Multiplayer server not reachable.')), ACK_TIMEOUT);
      this.socket.emit(event, payload, (res) => {
        clearTimeout(t);
        if (res?.error) reject(new Error(res.error));
        else resolve(res);
      });
    });
  }

  // Host the given world. Resolves with the shareable room code.
  async host({ name, seed, edits, time, mode, map }) {
    const res = await this._ack('host', { name, seed, edits, time, mode, map });
    this.code = res.code;
    this.isHost = true;
    this.isOrigin = true;
    return res.code;
  }

  // Join a room by code. Resolves with { seed, edits, time } to build the world.
  async join(code, name) {
    const res = await this._ack('join', { code, name });
    this.code = res.code;
    for (const p of res.players) this.players.set(p.id, { name: p.name });
    if (this.onPeers) this.onPeers();
    return res;
  }

  sendState(s) { this.socket.volatile.emit('state', s); }

  sendEdit(x, y, z, id) {
    const { k, i } = encodeEdit(x, y, z);
    this.socket.emit('edit', { k, i, id });
  }

  sendMobs(snap) { this.socket.volatile.emit('mobs', snap); }
  sendProjectile(p) { this.socket.emit('projectile', p); }
  sendBoom(x, y, z, r) { this.socket.emit('boom', { x, y, z, r }); }
  sendChess(msg) { this.socket.emit('chess', msg); }          // guest -> host
  sendChessState(view) { this.socket.emit('chessState', view); } // host -> room
  sendMatch(msg) { this.socket.emit('match', msg); }            // guest -> host
  sendMatchState(state) { this.socket.emit('matchState', state); } // host -> room
  sendTaunt(msg) { this.socket.emit('taunt', msg); }            // host -> room

  get id() { return this.socket.id; }
  sendTime(t) { this.socket.emit('time', t); }
  sendHitPlayer(to, dmg, kdir = null) {
    this.socket.emit('hitPlayer', { to, dmg, kx: kdir ? kdir.x : 0, kz: kdir ? kdir.z : 0 });
  }
  sendMobHit(m) { this.socket.emit('mobHit', m); }

  get peerCount() { return this.players.size; }

  close() {
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }
}
