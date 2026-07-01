import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

// ApexCraft multiplayer server: Express + Socket.IO room relay.
//
// The game is host-authoritative: the player who hosts a world runs the mob
// simulation; this server only manages rooms and relays messages. It also
// accumulates block edits per room so late joiners receive the full world
// state (seed + edits) on join.
//
// Run: `npm run server` (port 3001, override with PORT). The client connects
// to VITE_GAME_SERVER, or http://<host>:3001 on localhost.

const PORT = process.env.PORT || 3001;
const MAX_PLAYERS = 8;
const MAX_ROOMS = 200;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, '..', 'dist');

const app = express();
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
// Serve the built client when present, so one deploy can host both.
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true },
  maxHttpBufferSize: 1e7, // hosting sends the world's full edit set
});

// code -> { seed, time, edits: { "cx,cz": { index: blockId } }, host, players: Map<id, {name}> }
const rooms = new Map();

// Room codes avoid ambiguous characters (0/O, 1/I).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (let tries = 0; tries < 50; tries++) {
    let code = '';
    for (let i = 0; i < 5; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  return null;
}

const cleanName = (n) => String(n || 'Player').slice(0, 16).replace(/[<>]/g, '');

io.on('connection', (socket) => {
  let code = null; // room this socket is in

  const room = () => (code ? rooms.get(code) : null);

  socket.on('host', (data, ack) => {
    if (typeof ack !== 'function' || code) return;
    if (rooms.size >= MAX_ROOMS) return ack({ error: 'Server is full, try again later.' });
    const c = newCode();
    if (!c) return ack({ error: 'Could not allocate a room code.' });
    rooms.set(c, {
      seed: data?.seed ?? 0,
      time: data?.time ?? 0.3,
      mode: ['creative', 'hideseek'].includes(data?.mode) ? data.mode : 'survival',
      edits: data?.edits && typeof data.edits === 'object' ? data.edits : {},
      host: socket.id,
      match: null, // hide & seek round state (host-authoritative, see 'matchState')
      players: new Map([[socket.id, { name: cleanName(data?.name) }]]),
    });
    code = c;
    socket.join(c);
    ack({ code: c });
  });

  socket.on('join', (data, ack) => {
    if (typeof ack !== 'function' || code) return;
    const c = String(data?.code || '').toUpperCase().trim();
    const r = rooms.get(c);
    if (!r) return ack({ error: 'Room not found. Check the code (and that the host is online).' });
    if (r.players.size >= MAX_PLAYERS) return ack({ error: 'Room is full.' });
    const name = cleanName(data?.name);
    code = c;
    socket.join(c);
    socket.to(c).emit('playerJoined', { id: socket.id, name });
    const players = [...r.players].map(([id, p]) => ({ id, name: p.name }));
    r.players.set(socket.id, { name });
    ack({ code: c, seed: r.seed, time: r.time, mode: r.mode, edits: r.edits, match: r.match, players });
  });

  // Player transform at ~15 Hz. Volatile: drop frames rather than queue them.
  socket.on('state', (s) => {
    if (!code || !s) return;
    socket.volatile.to(code).emit('playerState', {
      id: socket.id, x: +s.x, y: +s.y, z: +s.z, yaw: +s.yaw, pitch: +s.pitch,
    });
  });

  // Block edit: record for late joiners, then relay.
  socket.on('edit', (e) => {
    const r = room();
    if (!r || !e || typeof e.k !== 'string') return;
    const i = e.i | 0, id = e.id | 0;
    if (!r.edits[e.k]) r.edits[e.k] = {};
    r.edits[e.k][i] = id;
    socket.to(code).emit('edit', { k: e.k, i, id });
  });

  // Mob snapshots (host only) at ~10 Hz.
  socket.on('mobs', (snap) => {
    const r = room();
    if (!r || r.host !== socket.id) return;
    socket.volatile.to(code).emit('mobs', snap);
  });

  // Projectile spawns (visuals + skeleton arrows) relayed to everyone else.
  socket.on('projectile', (p) => {
    if (code && p) socket.to(code).emit('projectile', p);
  });

  // Explosions: the originator applies block edits (synced separately);
  // receivers replay the blast for visuals and their own damage.
  socket.on('boom', (b) => {
    if (code && b) socket.to(code).emit('boom', { x: +b.x, y: +b.y, z: +b.z, r: +b.r || 3 });
  });

  // World clock from the host so day/night stays in sync.
  socket.on('time', (t) => {
    const r = room();
    if (!r || r.host !== socket.id) return;
    r.time = +t || 0;
    socket.to(code).emit('time', r.time);
  });

  // A mob (simulated on the host) hit a specific player. kx/kz carry the
  // knockback direction so the victim is shoved away from the attacker.
  socket.on('hitPlayer', (m) => {
    const r = room();
    if (!r || r.host !== socket.id || !m?.to) return;
    io.to(String(m.to)).emit('hitPlayer', { dmg: +m.dmg || 0, kx: +m.kx || 0, kz: +m.kz || 0 });
  });

  // Chess: actions route to the host (who owns the boards); authoritative
  // state broadcasts from the host to the whole room.
  socket.on('chess', (m) => {
    const r = room();
    if (!r || !m) return;
    io.to(r.host).emit('chess', { ...m, from: socket.id });
  });
  socket.on('chessState', (v) => {
    const r = room();
    if (!r || r.host !== socket.id || !v) return;
    socket.to(code).emit('chessState', v);
  });

  // Hide & seek (Prop Hunt): intents route to the host; authoritative round
  // state broadcasts from the host and is stored on the room so late joiners
  // and a migrated host pick up the round in progress.
  socket.on('match', (m) => {
    const r = room();
    if (!r || !m) return;
    io.to(r.host).emit('match', { ...m, from: socket.id });
  });
  socket.on('matchState', (s) => {
    const r = room();
    if (!r || r.host !== socket.id || !s) return;
    r.match = s;
    socket.to(code).emit('matchState', s);
  });

  // A guest hit a mob; route to the host who owns the simulation.
  socket.on('mobHit', (m) => {
    const r = room();
    if (!r || !m) return;
    io.to(r.host).emit('mobHit', {
      i: m.i | 0, dmg: +m.dmg || 0, x: +m.x || 0, y: +m.y || 0, z: +m.z || 0,
    });
  });

  socket.on('disconnect', () => {
    const r = room();
    if (!r) return;
    r.players.delete(socket.id);
    if (r.players.size === 0) {
      rooms.delete(code);
      return;
    }
    socket.to(code).emit('playerLeft', { id: socket.id });
    // Host migration: the longest-connected remaining player takes over the
    // mob simulation (Map preserves insertion order).
    if (r.host === socket.id) {
      r.host = r.players.keys().next().value;
      io.to(r.host).emit('becomeHost');
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`ApexCraft multiplayer server on http://localhost:${PORT}`);
});
