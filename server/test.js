// Integration test for the multiplayer server: spins up the server on a test
// port, connects a host + a guest with socket.io-client, and exercises the
// whole protocol (host, join, state, edits, mobs, projectiles, hits, time,
// host migration). Run: node server/test.js
import { spawn } from 'child_process';
import { io } from 'socket.io-client';
import { fileURLToPath } from 'url';
import path from 'path';

const PORT = 3199;
const URL = `http://localhost:${PORT}`;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0, failed = 0;
const ok = (cond, msg) => {
  if (cond) { passed++; console.log(`  ok - ${msg}`); }
  else { failed++; console.error(`  FAIL - ${msg}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (sock, ev, ms = 3000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timeout waiting for '${ev}'`)), ms);
  sock.once(ev, (d) => { clearTimeout(t); resolve(d); });
});
const ack = (sock, ev, payload) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`ack timeout for '${ev}'`)), 3000);
  sock.emit(ev, payload, (res) => { clearTimeout(t); resolve(res); });
});

const server = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => console.error('server:', String(d)));

try {
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 5000);
    server.stdout.on('data', (d) => { if (String(d).includes('multiplayer server')) { clearTimeout(t); resolve(); } });
  });

  const host = io(URL);
  const guest = io(URL);

  // --- host a room ---
  const h = await ack(host, 'host', { name: 'Hosty', seed: 12345, time: 0.4, edits: { '0,0': { 7: 3 } } });
  ok(/^[A-Z2-9]{5}$/.test(h.code || ''), `host gets a 5-char room code (${h.code})`);

  // --- join: bad code rejected, good code returns world state ---
  const bad = await ack(guest, 'join', { code: 'XXXXX', name: 'G' });
  ok(!!bad.error, 'joining a bad code returns an error');
  const joinedNotify = once(host, 'playerJoined');
  const j = await ack(guest, 'join', { code: h.code, name: 'Guesty' });
  ok(j.seed === 12345, 'guest receives the world seed');
  ok(j.time === 0.4, 'guest receives the world clock');
  ok(j.edits && j.edits['0,0'] && j.edits['0,0'][7] === 3, 'guest receives existing edits');
  ok(j.players.length === 1 && j.players[0].name === 'Hosty', 'guest receives the player list');
  const jn = await joinedNotify;
  ok(jn.name === 'Guesty', 'host is notified of the join');

  // --- player state relay ---
  const stateP = once(host, 'playerState');
  guest.emit('state', { x: 1.5, y: 70, z: -3, yaw: 0.5, pitch: 0.1 });
  const st = await stateP;
  ok(st.x === 1.5 && st.yaw === 0.5 && st.id === guest.id, 'player state relays with sender id');

  // --- edits relay + accumulate for late joiners ---
  const editP = once(host, 'edit');
  guest.emit('edit', { k: '1,2', i: 999, id: 4 });
  const ed = await editP;
  ok(ed.k === '1,2' && ed.i === 999 && ed.id === 4, 'block edit relays to the room');

  const late = io(URL);
  const j2 = await ack(late, 'join', { code: h.code, name: 'Late' });
  ok(j2.edits['1,2'] && j2.edits['1,2'][999] === 4, 'late joiner receives accumulated edits');
  ok(j2.players.length === 2, 'late joiner sees both players');

  // --- mob snapshots: host-only, relayed to guests ---
  const mobP = once(guest, 'mobs');
  guest.emit('mobs', [{ i: 1, t: 'fake' }]); // guests must NOT be able to broadcast
  host.emit('mobs', [{ i: 9, t: 'zombie', x: 1, y: 2, z: 3, yaw: 0, h: 20 }]);
  const mobs = await mobP;
  ok(mobs.length === 1 && mobs[0].i === 9, 'host mob snapshot relays (guest snapshots ignored)');

  // --- projectiles relay ---
  const projP = once(host, 'projectile');
  guest.emit('projectile', { x: 0, y: 70, z: 0, dx: 1, dy: 0, dz: 0, speed: 30, dmg: 0, target: 'none' });
  ok((await projP).speed === 30, 'projectile spawn relays');

  // --- hit routing: host -> specific player, guest -> host ---
  const hitP = once(guest, 'hitPlayer');
  host.emit('hitPlayer', { to: guest.id, dmg: 3, kx: 0.6, kz: -0.8 });
  const hp = await hitP;
  ok(hp.dmg === 3 && hp.kx === 0.6 && hp.kz === -0.8, 'mob hit routes to the targeted player with knockback');

  const mobHitP = once(host, 'mobHit');
  guest.emit('mobHit', { i: 9, dmg: 5, x: 1, y: 2, z: 3 });
  const mh = await mobHitP;
  ok(mh.i === 9 && mh.dmg === 5, 'guest mob hit routes to the host');

  // --- time sync (host only) ---
  const timeP = once(guest, 'time');
  host.emit('time', 0.77);
  ok(Math.abs((await timeP) - 0.77) < 1e-9, 'world clock relays from host');

  // --- host migration ---
  const becomeHostP = once(guest, 'becomeHost');
  const leftP = once(guest, 'playerLeft');
  host.disconnect();
  await leftP;
  await becomeHostP;
  ok(true, 'oldest guest becomes host when the host leaves');

  // New host's authority works: its mob snapshot now relays.
  const mobP2 = once(late, 'mobs');
  guest.emit('mobs', [{ i: 2, t: 'cow', x: 0, y: 64, z: 0, yaw: 0, h: 10 }]);
  ok((await mobP2)[0].i === 2, 'migrated host can broadcast mob snapshots');

  guest.disconnect();
  late.disconnect();
  await wait(200);
} catch (e) {
  failed++;
  console.error('  FAIL -', e.message);
} finally {
  server.kill();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
