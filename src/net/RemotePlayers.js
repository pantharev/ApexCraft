import * as THREE from 'three';

// Renders the other players in a multiplayer room: a blocky humanoid avatar
// per peer with a floating name tag, interpolated between network snapshots
// (~15 Hz) so movement looks smooth at render rate.

const LERP = 12; // snap speed toward the latest snapshot (higher = tighter)

// Distinct shirt colours, picked by a stable hash of the socket id.
const SHIRTS = ['#2e6fbe', '#b8442e', '#3f9e4d', '#8a4dbe', '#c2902e', '#2e9e96', '#be4d8a', '#6d7a2e'];
const hashColor = (id) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return SHIRTS[Math.abs(h) % SHIRTS.length];
};

function noiseTexture(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const S = 8;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const d = (Math.random() - 0.5) * 30;
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
  return tex;
}

function box(w, h, d, color, x, y, z, legPivot = false) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (legPivot) geo.translate(0, -h / 2, 0);
  const mat = new THREE.MeshLambertMaterial({ map: noiseTexture(color) });
  mat.emissive = new THREE.Color(color);
  mat.emissiveIntensity = 0.3;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, legPivot ? y + h / 2 : y, z);
  return mesh;
}

function nameTag(name) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 8, 256, 48);
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.y = 2.25;
  return sprite;
}

function buildAvatar(id, name) {
  const shirt = hashColor(id);
  const group = new THREE.Group();
  const legs = [
    box(0.24, 0.75, 0.24, '#3a3f55', -0.14, 0.0, 0, true),
    box(0.24, 0.75, 0.24, '#3a3f55', 0.14, 0.0, 0, true),
  ];
  for (const l of legs) group.add(l);
  group.add(box(0.52, 0.7, 0.3, shirt, 0, 1.1, 0));        // torso
  group.add(box(0.18, 0.66, 0.24, shirt, -0.36, 1.1, 0));  // arms
  group.add(box(0.18, 0.66, 0.24, shirt, 0.36, 1.1, 0));
  group.add(box(0.46, 0.46, 0.46, '#caa17e', 0, 1.72, 0)); // head
  group.add(nameTag(name));
  group.userData.legs = legs;
  return group;
}

export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    this.map = new Map(); // id -> peer
  }

  add(id, name) {
    if (this.map.has(id)) return;
    const group = buildAvatar(id, name || 'Player');
    group.visible = false; // until the first state arrives
    this.scene.add(group);
    this.map.set(id, {
      id, group,
      legs: group.userData.legs,
      cur: { x: 0, y: 0, z: 0, yaw: 0 },
      target: null,
      walkPhase: 0,
    });
  }

  remove(id) {
    const p = this.map.get(id);
    if (!p) return;
    this.scene.remove(p.group);
    p.group.traverse((o) => o.geometry && o.geometry.dispose());
    this.map.delete(id);
  }

  setState(s) {
    const p = this.map.get(s.id);
    if (!p) return;
    if (!p.target) { // first snapshot: snap straight there
      p.cur.x = s.x; p.cur.y = s.y; p.cur.z = s.z; p.cur.yaw = s.yaw;
      p.group.visible = true;
    }
    p.target = { x: s.x, y: s.y, z: s.z, yaw: s.yaw };
  }

  update(dt) {
    const k = Math.min(1, dt * LERP);
    for (const p of this.map.values()) {
      if (!p.target) continue;
      const c = p.cur, t = p.target;
      const dx = t.x - c.x, dy = t.y - c.y, dz = t.z - c.z;
      c.x += dx * k; c.y += dy * k; c.z += dz * k;
      // Shortest-path yaw lerp.
      let dyaw = t.yaw - c.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      c.yaw += dyaw * k;

      p.group.position.set(c.x, c.y, c.z);
      p.group.rotation.y = c.yaw;

      // Swing legs while the avatar is moving horizontally.
      const speed = Math.hypot(dx, dz) / Math.max(dt, 1e-4);
      if (speed > 0.6) {
        p.walkPhase += dt * 9;
        for (let i = 0; i < p.legs.length; i++) {
          p.legs[i].rotation.x = Math.sin(p.walkPhase + i * Math.PI) * 0.55;
        }
      } else {
        for (const l of p.legs) l.rotation.x *= 0.8;
      }
    }
  }

  // Positions for mob targeting on the host: [{ id, pos: Vector3-like }].
  list() {
    const out = [];
    for (const p of this.map.values()) {
      if (p.target) out.push({ id: p.id, pos: new THREE.Vector3(p.cur.x, p.cur.y, p.cur.z) });
    }
    return out;
  }

  clear() {
    for (const id of [...this.map.keys()]) this.remove(id);
  }
}
