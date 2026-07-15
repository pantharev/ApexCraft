import * as THREE from 'three';
import { MOBS } from './mobTypes.js';

// Small tinted noise texture per colour so mob parts aren't flat. Cached.
const texCache = new Map();
function partTexture(hex) {
  if (texCache.has(hex)) return texCache.get(hex);
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const S = 8;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const d = (Math.random() - 0.5) * 36;
    img.data[i * 4] = Math.max(0, Math.min(255, r + d));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, g + d));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, b + d));
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(hex, tex);
  return tex;
}

function partMesh(part) {
  const [w, h, d] = part.size;
  const geo = new THREE.BoxGeometry(w, h, d);
  // A little self-illumination in the part's own colour so mobs stay readable
  // in low light (e.g. zombies at night) instead of going black.
  const mat = new THREE.MeshLambertMaterial({ map: partTexture(part.color) });
  mat.emissive = new THREE.Color(part.color);
  mat.emissiveIntensity = 0.32;
  mat.userData.baseEmissive = mat.emissive.getHex();
  return new THREE.Mesh(geo, mat);
}

// Builds a placeholder box model for a mob type. Returns a Group with:
//   userData.legs — leg meshes (pivoted at the hip) that swing while walking
//   userData.arms — arm meshes (pivoted at the shoulder) driven by the gait
//   userData.head — a sub-group pivoted at the first `head: true` part, so the
//                   mob can look around (eyes/beak/snout ride along)
export function buildMobModel(type) {
  const def = MOBS[type];
  const group = new THREE.Group();
  const legs = [];
  const arms = [];

  // Head parts get their own pivot group anchored at the first head part.
  const headParts = def.parts.filter((p) => p.head);
  let headGroup = null;
  let headPivot = null;
  if (headParts.length) {
    headPivot = headParts[0].pos;
    headGroup = new THREE.Group();
    headGroup.position.set(headPivot[0], headPivot[1], headPivot[2]);
    group.add(headGroup);
  }

  for (const part of def.parts) {
    if (part.leg || part.arm) {
      // Pivot at the top (hip / shoulder) so rotation looks like a joint.
      const [w, h, d] = part.size;
      const geo = new THREE.BoxGeometry(w, h, d);
      geo.translate(0, -h / 2, 0);
      const mat = new THREE.MeshLambertMaterial({ map: partTexture(part.color) });
      mat.emissive = new THREE.Color(part.color);
      mat.emissiveIntensity = 0.32;
      mat.userData.baseEmissive = mat.emissive.getHex();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(part.pos[0], part.pos[1] + h / 2, part.pos[2]);
      group.add(mesh);
      (part.leg ? legs : arms).push(mesh);
    } else if (part.head && headGroup) {
      const mesh = partMesh(part);
      mesh.position.set(
        part.pos[0] - headPivot[0],
        part.pos[1] - headPivot[1],
        part.pos[2] - headPivot[2]
      );
      headGroup.add(mesh);
    } else {
      const mesh = partMesh(part);
      mesh.position.set(part.pos[0], part.pos[1], part.pos[2]);
      group.add(mesh);
    }
  }

  group.userData.legs = legs;
  group.userData.arms = arms;
  group.userData.head = headGroup;
  return group;
}

// Shared walk/idle body animation, used by both the authoritative Mob and the
// guest-side GhostMobs so multiplayer mirrors move identically. `m` needs:
// group, legs, arms, walkPhase, def (and optionally attackTimer). Legs swing
// for every mob; mobs with a `gait` also get arm poses, a walking bob, torso
// sway, and (shamblers) the occasional head twitch. Bob/sway are ADDED on top
// of group.position/rotation, so the caller must sync the group to the mob's
// position each frame BEFORE calling this. Never runs on dead mobs (the death
// tip-over owns group.rotation.z).
export function animateMob(m, dt, moving) {
  const gait = m.def.gait;
  const arms = m.arms || [];
  if (moving) m.walkPhase += dt * (gait === 'heavy' ? 5.5 : gait === 'run' ? 12 : 8);
  m.idleT = (m.idleT || 0) + dt;
  const t = m.walkPhase;

  const legAmp = gait === 'heavy' ? 0.7 : gait === 'run' ? 0.95 : 0.5;
  if (moving) {
    for (let i = 0; i < m.legs.length; i++) m.legs[i].rotation.x = Math.sin(t + i * Math.PI) * legAmp;
  } else {
    for (const l of m.legs) l.rotation.x *= 0.8;
  }

  if (!gait) return; // plain mobs (pigs, bats, villagers…): legs only

  // Arms ease toward a per-gait target pose, so transitions look organic.
  const k = Math.min(1, dt * 10);
  for (let i = 0; i < arms.length; i++) {
    const a = arms[i];
    const s = i % 2 ? 1 : -1; // splay direction alternates per arm
    let rx, rz;
    if (m.attackTimer > 0) {
      // Overhead slam: raised behind the head, whipping down through the hit.
      const p = Math.max(0, m.attackTimer) / 0.25;
      rx = -0.5 - p * 1.9;
      rz = s * 0.12;
    } else if (gait === 'shamble') {
      // Classic zombie reach: both arms out level, drifting independently.
      rx = -1.35 + Math.sin(m.idleT * 1.7 + i * 2.4) * 0.12 + (moving ? Math.sin(t * 0.5 + i) * 0.1 : 0);
      rz = s * 0.06;
    } else if (gait === 'run') {
      rx = moving ? Math.sin(t + (i + 1) * Math.PI) * 0.95 : -0.25;
      rz = s * 0.05;
    } else if (gait === 'raised') {
      // Banshee wail: arms overhead, swaying.
      rx = -2.7 + Math.sin(m.idleT * 2.2 + i * 1.3) * 0.15;
      rz = s * 0.35 + Math.sin(m.idleT * 2.8 + i) * 0.1;
    } else { // heavy
      rx = moving ? Math.sin(t + (i + 1) * Math.PI) * 0.4 - 0.25
        : -0.15 + Math.sin(m.idleT * 1.4 + i * 2) * 0.05;
      rz = s * 0.1;
    }
    a.rotation.x += (rx - a.rotation.x) * k;
    a.rotation.z += (rz - a.rotation.z) * k;
  }

  // Body english: step bob + torso sway while moving, a breath at rest.
  const g = m.group;
  if (moving) {
    g.position.y += Math.abs(Math.sin(t)) * (gait === 'heavy' ? 0.06 : gait === 'run' ? 0.05 : 0.035);
    g.rotation.z = Math.sin(t * 0.5) * (gait === 'heavy' ? 0.085 : gait === 'shamble' ? 0.06 : 0.02);
    g.rotation.x = gait === 'run' ? 0.18 : gait === 'shamble' ? 0.08 : 0.05;
  } else {
    g.position.y += Math.sin(m.idleT * 1.8) * 0.012;
    g.rotation.z *= 0.85;
    g.rotation.x *= 0.85;
  }

  // Shamblers snap their head sideways every few seconds, then let it settle.
  // Uses head rotation.z only — the look-at logic owns x and y.
  const head = g.userData.head;
  if (gait === 'shamble' && head) {
    m._twitchT = (m._twitchT ?? 1 + Math.random() * 4) - dt;
    if (m._twitchT <= 0) {
      m._twitchT = 2.5 + Math.random() * 4.5;
      m._twitchV = (Math.random() < 0.5 ? 1 : -1) * (0.35 + Math.random() * 0.25);
    }
    if (m._twitchV) {
      m._twitchV *= Math.exp(-dt * 4);
      if (Math.abs(m._twitchV) < 0.02) m._twitchV = 0;
    }
    head.rotation.z += ((m._twitchV || 0) - head.rotation.z) * Math.min(1, dt * 14);
  }
}
