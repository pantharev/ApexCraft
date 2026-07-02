import * as THREE from 'three';
import { buildBlockCube } from '../items/ItemModels.js';
import { getBlock } from '../blocks/BlockRegistry.js';

// Renders the other players in a multiplayer room: a blocky humanoid avatar
// per peer with a floating name tag, interpolated between network snapshots
// (~15 Hz) so movement looks smooth at render rate. In Prop Hunt a hider's
// avatar is swapped for a textured block cube (setDisguise) so they blend into
// the arena's real props.

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

// A camera-facing emoji sprite, drawn to a canvas (color emoji glyph). Used for
// Prop Hunt taunts floating above a player's head.
export function emojiSprite(emoji) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.font = '96px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 64, 72);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(0.9, 0.9, 1);
  return sprite;
}

function disposeTaunt(t, group) {
  if (!t) return;
  group.remove(t.sprite);
  t.sprite.material.map.dispose();
  t.sprite.material.dispose();
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
  const tag = nameTag(name);
  group.add(tag);
  group.userData.legs = legs;
  group.userData.tag = tag;
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
      tag: group.userData.tag,
      body: group.children.slice(), // humanoid parts + name tag (hidden when disguised)
      disguiseMesh: null,
      disguiseId: 0,
      tagShown: false,
      cur: { x: 0, y: 0, z: 0, yaw: 0 },
      target: null,
      walkPhase: 0,
    });
  }

  // Prop Hunt: swap a peer's humanoid avatar for a textured block cube (or back
  // when blockId is 0/null). Cheap to call every frame — only rebuilds on change.
  // `showTag` keeps the name tag floating over the disguise block: fellow hiders
  // get it (so they know which props are friends); seekers never do.
  setDisguise(id, blockId, showTag = false) {
    const p = this.map.get(id);
    if (!p) return;
    blockId = blockId || 0;
    showTag = !!showTag;
    if (p.disguiseId === blockId && p.tagShown === showTag) return;
    p.disguiseId = blockId;
    p.tagShown = showTag;
    if (p.disguiseMesh) { p.group.remove(p.disguiseMesh); p.disguiseMesh = null; }
    if (blockId) {
      // Full block size so it matches the arena's real placed blocks.
      p.disguiseMesh = buildBlockCube(getBlock(blockId).name, 1.0, true);
      p.disguiseMesh.position.y = 0.5; // sit the block on the ground
      p.group.add(p.disguiseMesh);
    }
    for (const b of p.body) b.visible = !blockId || (showTag && b === p.tag);
    p.tag.position.y = blockId ? 1.5 : 2.25; // hover just over the block
  }

  // Prop Hunt: float a taunt emoji above a peer's head for `ttl` seconds. Kept
  // outside `p.body`, so it shows even over a disguise block.
  showTaunt(id, emoji, ttl = 2) {
    const p = this.map.get(id);
    if (!p) return;
    disposeTaunt(p.taunt, p.group);
    const sprite = emojiSprite(emoji);
    sprite.position.y = 2.9;
    p.group.add(sprite);
    p.taunt = { sprite, ttl, age: 0 };
  }

  // Ray vs. each peer (sphere test) for seeker tagging: nearest hit id or null.
  raycast(origin, dir, maxDist = 5) {
    let bestId = null, bestT = Infinity;
    for (const p of this.map.values()) {
      if (!p.target) continue;
      const cx = p.cur.x - origin.x, cy = (p.cur.y + 0.9) - origin.y, cz = p.cur.z - origin.z;
      const t = cx * dir.x + cy * dir.y + cz * dir.z; // projection onto the ray
      if (t < 0 || t > maxDist) continue;
      const dx = p.cur.x - (origin.x + dir.x * t);
      const dy = (p.cur.y + 0.9) - (origin.y + dir.y * t);
      const dz = p.cur.z - (origin.z + dir.z * t);
      const r = p.disguiseId ? 0.75 : 0.6; // disguised blocks are a touch wider
      if (Math.hypot(dx, dy, dz) <= r && t < bestT) { bestT = t; bestId = p.id; }
    }
    return bestId;
  }

  remove(id) {
    const p = this.map.get(id);
    if (!p) return;
    disposeTaunt(p.taunt, p.group);
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
      // Disguised hiders render axis-aligned like a real placed block — a cube
      // rotated to the player's yaw would stick out of the grid instantly.
      p.group.rotation.y = p.disguiseId ? 0 : c.yaw;

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

      // Advance any floating taunt: drift up and fade, then remove.
      if (p.taunt) {
        p.taunt.age += dt;
        const f = p.taunt.age / p.taunt.ttl;
        p.taunt.sprite.position.y = 2.9 + f * 0.6;
        p.taunt.sprite.material.opacity = Math.max(0, 1 - f);
        if (f >= 1) { disposeTaunt(p.taunt, p.group); p.taunt = null; }
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
