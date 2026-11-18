import * as THREE from 'three';
import { buildBlockCube } from '../items/ItemModels.js';
import { getBlock } from '../blocks/BlockRegistry.js';
import { PlayerAvatar } from '../entities/PlayerAvatar.js';
import { skinFromNumber } from '../entities/playerSkins.js';

// Renders the other players in a multiplayer room: a painted, animated avatar
// per peer (see PlayerAvatar) with a floating name tag, interpolated between
// network snapshots (~15 Hz) so movement looks smooth at render rate. In Prop
// Hunt a hider's avatar is swapped for a textured block cube (setDisguise) so
// they blend into the arena's real props.

const LERP = 12; // snap speed toward the latest snapshot (higher = tighter)
const TAG_GAP = 0.45; // name tag height above the top of the avatar (hat included)

// Exported: pets reuse this for their owner tag (smaller, lower over the mob).
export function nameTag(name, { y = 2.25, scale = 1 } = {}) {
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
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false }));
  sprite.scale.set(1.6 * scale, 0.4 * scale, 1);
  sprite.position.y = y;
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
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false }));
  sprite.scale.set(0.9, 0.9, 1);
  return sprite;
}

function disposeTaunt(t, group) {
  if (!t) return;
  group.remove(t.sprite);
  t.sprite.material.map.dispose();
  t.sprite.material.dispose();
}

export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    this.map = new Map(); // id -> peer
  }

  add(id, name) {
    if (this.map.has(id)) return;
    name = name || 'Player';
    // Dressed from the name to begin with (which is all a Prop Hunt bot ever
    // has); a real player's first state says which skin they chose — see
    // setState — and it arrives before the peer is shown.
    const avatar = new PlayerAvatar(name);
    const group = new THREE.Group();
    const tag = nameTag(name, { y: avatar.height + TAG_GAP });
    group.add(avatar.group, tag);
    group.visible = false; // until the first state arrives
    this.scene.add(group);
    this.map.set(id, {
      id, name, group, avatar, tag,
      body: [avatar.group, tag], // hidden when disguised
      disguiseMesh: null,
      disguiseId: 0,
      tagShown: false,
      cur: { x: 0, y: 0, z: 0, yaw: 0 },
      target: null,
      pitch: 0,     // look pitch, for the head
      held: null,   // held item name, shown in the hand
      action: 0,    // bit 0: swinging (mining / attacking)
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
      // Real blocks throw and catch shadows; a prop that didn't would be an
      // instant tell for seekers.
      p.disguiseMesh.castShadow = true;
      p.disguiseMesh.receiveShadow = true;
      p.group.add(p.disguiseMesh);
    }
    for (const b of p.body) b.visible = !blockId || (showTag && b === p.tag);
    p.tag.position.y = blockId ? 1.5 : p.avatar.height + TAG_GAP; // hover just over the block
  }

  // Prop Hunt: float a taunt emoji above a peer's head for `ttl` seconds. Kept
  // outside `p.body`, so it shows even over a disguise block.
  showTaunt(id, emoji, ttl = 2) {
    const p = this.map.get(id);
    if (!p) return;
    disposeTaunt(p.taunt, p.group);
    const sprite = emojiSprite(emoji);
    // Above the name tag, wherever this peer's hat puts that.
    const y = p.avatar.height + TAG_GAP + 0.65;
    sprite.position.y = y;
    p.group.add(sprite);
    p.taunt = { sprite, ttl, age: 0, y };
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
    // The avatar frees its own geometry + material (its skin textures, the
    // held item, and the disguise cube are shared caches). The name tag owns a
    // canvas texture; bot churn builds a fresh one every round.
    p.avatar.dispose();
    p.tag.material.map.dispose();
    p.tag.material.dispose();
    this.map.delete(id);
  }

  // Change what a peer wears: a new avatar in the old one's place.
  _setSkin(p, skin) {
    const old = p.avatar;
    const avatar = new PlayerAvatar(p.name, skin);
    avatar.group.visible = old.group.visible; // hidden while disguised
    avatar.group.rotation.y = old.group.rotation.y;
    p.group.remove(old.group);
    old.dispose();
    p.group.add(avatar.group);
    p.avatar = avatar;
    p.body[0] = avatar.group;
    if (!p.disguiseId) p.tag.position.y = avatar.height + TAG_GAP;
  }

  // Latest network state for a peer: position, look yaw (the player
  // convention — yaw 0 looks down -z), and optionally pitch, held item `h`,
  // and action bits `a` (bit 0 swinging; bits 4 up, the skin's number — 0
  // from a bot or an older client, who keep the skin their name gave them).
  setState(s) {
    const p = this.map.get(s.id);
    if (!p) return;
    const skin = skinFromNumber((s.a >> 4) & 0xff);
    if (skin && skin !== p.avatar.skin) this._setSkin(p, skin);
    if (!p.target) { // first snapshot: snap straight there
      p.cur.x = s.x; p.cur.y = s.y; p.cur.z = s.z; p.cur.yaw = s.yaw;
      p.group.visible = true;
    }
    p.target = { x: s.x, y: s.y, z: s.z, yaw: s.yaw };
    if (Number.isFinite(s.pitch)) p.pitch = s.pitch;
    p.held = typeof s.h === 'string' ? s.h : null;
    p.action = s.a | 0;
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
      // The avatar model faces +z; look yaw 0 faces -z, hence the half turn.
      // The disguise cube sits on the outer group, which never rotates — a
      // cube turned to the player's yaw would stick out of the grid instantly.
      p.avatar.group.rotation.y = c.yaw + Math.PI;

      if (!p.disguiseId) {
        // Remaining distance to the snapshot, eased the same way as the
        // position, is the speed the avatar is actually moving at on screen.
        const speed = (Math.hypot(dx, dz) * k) / Math.max(dt, 1e-4);
        p.avatar.setHeld(p.held);
        p.avatar.update(dt, { speed, pitch: p.pitch, swinging: (p.action & 1) === 1 });
      }

      // Advance any floating taunt: drift up and fade, then remove.
      if (p.taunt) {
        p.taunt.age += dt;
        const f = p.taunt.age / p.taunt.ttl;
        p.taunt.sprite.position.y = p.taunt.y + f * 0.6;
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
