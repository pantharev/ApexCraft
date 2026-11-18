import * as THREE from 'three';
import { buildModel } from './MobModels.js';
import { eyes, band, cuff } from './mobSkins.js';
import { getItem } from '../items/ItemRegistry.js';
import { getBlock, getBlockId } from '../blocks/BlockRegistry.js';
import { dropPlateGeometry, plateMaterial, buildBlockCube, buildTorchModel } from '../items/ItemModels.js';

// The player's body: a painted humanoid built with the same skin system as the
// mobs (MobModels), so players and creatures share one pixel-art style.
//
// Used three ways:
//   • other players in multiplayer, and Prop Hunt bots (RemotePlayers);
//   • the local player in third person;
//   • the local player in first person, where it is drawn only into the
//     shadow map — you never see your own body, but you do cast a shadow.
//
// Appearance (skin tone, hair, clothes) is derived from the player's name, so
// someone looks the same to everyone, every session, with no extra netcode.

const SKIN_TONES = ['#f1c9a5', '#e0ac7e', '#c68e63', '#a8744c', '#8a5a3a', '#6b452c'];
const HAIR = ['#2b1d14', '#4a2f1c', '#7a4a24', '#b07a3a', '#d8b46a', '#8a2f1e', '#3a3a3e', '#c9c5bd'];
const SHIRTS = ['#2e6fbe', '#b8442e', '#3f9e4d', '#8a4dbe', '#c2902e', '#2e9e96', '#be4d8a', '#5a6470'];
const PANTS = ['#34405e', '#4a3b2c', '#2f3338', '#5a5148', '#28384a'];
const EYES = ['#3a2a1a', '#2f6a9a', '#3f7a44', '#5a5a62'];

export function appearanceFor(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  h >>>= 0;
  const pick = (list, shift) => list[(h >>> shift) % list.length];
  return {
    skin: pick(SKIN_TONES, 0),
    hair: pick(HAIR, 4),
    shirt: pick(SHIRTS, 9),
    pants: pick(PANTS, 14),
    eyes: pick(EYES, 18),
    hairStyle: (h >>> 22) % 3,   // 0 cropped, 1 full, 2 long
    sleeves: (h >>> 25) % 2,     // 0 short, 1 long
    stripe: (h >>> 27) % 3 === 0, // a band across the chest
    key: `player:${h.toString(36)}`,
  };
}

const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
};

// A 32-pixel-tall figure (2 blocks). The avatar group is scaled to the
// player's real 1.8-block height. Index 0 of the arms must be the -x arm.
function playerDef(a) {
  return {
    parts: [
      { id: 'legR', size: [0.25, 0.75, 0.25], pos: [-0.125, 0.375, 0], color: a.pants, leg: true },
      { id: 'legL', size: [0.25, 0.75, 0.25], pos: [0.125, 0.375, 0], color: a.pants, leg: true },
      { id: 'torso', size: [0.5, 0.75, 0.25], pos: [0, 1.125, 0], color: a.shirt },
      { id: 'armR', size: [0.25, 0.75, 0.25], pos: [-0.375, 1.125, 0], color: a.skin, arm: true },
      { id: 'armL', size: [0.25, 0.75, 0.25], pos: [0.375, 1.125, 0], color: a.skin, arm: true },
      { id: 'head', size: [0.5, 0.5, 0.5], pos: [0, 1.75, 0], color: a.skin, head: true },
    ],
  };
}

function playerPainter(a) {
  return (p) => {
    const hairDark = shade(a.hair, 0.8);
    // Hair: the crown, a fringe, and as far down the sides and back as the
    // style goes.
    const down = [2, 3, 6][a.hairStyle];
    const top = p.face('head', 'top');
    top.rect(0, 0, top.w, top.h, a.hair).speckle(10, hairDark);
    const face = p.face('head', 'front');
    face.rect(0, 0, face.w, a.hairStyle === 0 ? 1 : 2, a.hair);
    if (a.hairStyle === 2) face.rect(0, 2, 1, 4, a.hair).rect(face.w - 1, 2, 1, 4, a.hair);
    p.sides('head', (f) => f.rect(0, 0, f.w, down, a.hair).speckle(4, hairDark));
    const back = p.face('head', 'back');
    back.rect(0, 0, back.w, Math.min(back.h, down + 2), a.hair).speckle(6, hairDark);
    // Face.
    eyes(face, 4, 2, a.eyes, { white: '#ffffff' });
    face.rect(1, 3, 2, 1, hairDark).rect(5, 3, 2, 1, hairDark); // brows
    face.rect(3, 5, 2, 1, shade(a.skin, 0.9));                  // nose
    face.rect(3, 6, 2, 1, shade(a.skin, 0.68));                 // mouth

    // Shirt: open collar, hem, an optional chest stripe, and sleeves.
    const chest = p.face('torso', 'front');
    chest.px(3, 0, a.skin).px(4, 0, a.skin);
    p.around('torso', (f) => {
      f.rect(0, f.h - 1, f.w, 1, shade(a.shirt, 0.72));
      if (a.stripe) f.rect(0, 4, f.w, 2, shade(a.shirt, 1.28));
    });
    for (const id of ['armR', 'armL']) {
      cuff(p, id, a.sleeves ? 10 : 4, a.shirt);
      p.face(id, 'top').rect(0, 0, 4, 4, a.shirt);
    }
    // Trousers: belt line and shoes.
    for (const id of ['legR', 'legL']) {
      cuff(p, id, 1, shade(a.pants, 0.7));
      band(p, id, 0, 2, '#2a2420');
    }
  };
}

const SCALE = 0.9; // 2.0-block model -> 1.8-block player

export class PlayerAvatar {
  constructor(name) {
    this.appearance = appearanceFor(name || 'Player');
    const a = this.appearance;
    this.model = buildModel(playerDef(a), a.key, playerPainter(a));
    this.model.scale.setScalar(SCALE);
    this.group = new THREE.Group(); // feet at the origin, facing +z
    this.group.add(this.model);

    const u = this.model.userData;
    this.legs = u.legs;
    this.armR = u.arms[0];
    this.armL = u.arms[1];
    this.head = u.head;
    this.meshes = [];
    this.model.traverse((o) => { if (o.isMesh) this.meshes.push(o); });

    // The held item hangs off the right hand (the arm mesh's origin is the
    // shoulder; the hand is 0.75 down).
    this.hand = new THREE.Group();
    this.hand.position.set(0, -0.72, 0.04);
    this.armR.add(this.hand);
    this.heldName = null;
    this._held = null;
    this._layer = 0;

    this._phase = 0;
    this._t = 0;
  }

  // Show `itemName` in the hand (null = empty). Cheap to call every frame.
  setHeld(itemName) {
    itemName = itemName || null;
    if (itemName === this.heldName) return;
    this.heldName = itemName;
    this._clearHeld();
    const item = itemName && getItem(itemName);
    if (!item) return;
    let model;
    const block = item.placeBlock ? getBlock(getBlockId(item.placeBlock)) : null;
    if (item.placeBlock === 'torch') {
      model = buildTorchModel(0.9);
      model.position.set(0, 0.02, 0.1);
      model.rotation.x = 0.5;
      this._ownsHeld = true;
    } else if (block && !block.plant && !block.door && !block.stair && !block.bed && !block.fence) {
      model = buildBlockCube(item.placeBlock, 0.3, true); // shared geometry + materials
      model.position.set(0, -0.02, 0.14);
      this._ownsHeld = false;
    } else {
      // The item's icon as a plate, gripped at its lower end and pointing
      // forward out of the fist.
      model = new THREE.Mesh(dropPlateGeometry(item.name, 0.55), plateMaterial()); // shared
      model.rotation.set(Math.PI / 2 - 0.5, 0, 0);
      model.position.set(0, 0.06, 0.2);
      this._ownsHeld = false;
    }
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.layers.set(this._layer);
    });
    this._held = model;
    this.hand.add(model);
  }

  _clearHeld() {
    if (!this._held) return;
    this.hand.remove(this._held);
    if (this._ownsHeld) {
      this._held.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    this._held = null;
  }

  // Put every mesh on one render layer. The local player's body lives on the
  // shadow-caster layer in first person (shadow only) and on layer 0 in
  // third person.
  setLayer(layer) {
    if (layer === this._layer) return;
    this._layer = layer;
    this.group.traverse((o) => { if (o.isMesh) o.layers.set(layer); });
  }

  // Pose for this frame. `speed` is horizontal blocks/s, `pitch` the look
  // angle (up positive), `swinging` true while mining or attacking.
  update(dt, { speed = 0, pitch = 0, swinging = false } = {}) {
    this._t += dt;
    const moving = speed > 0.5;
    if (moving) this._phase += dt * Math.min(13, 5 + speed * 1.2);
    const reach = moving ? Math.min(0.95, 0.3 + speed * 0.1) : 0;
    const stride = Math.sin(this._phase) * reach;
    const k = Math.min(1, dt * 14);
    const ease = (obj, axis, target) => { obj.rotation[axis] += (target - obj.rotation[axis]) * k; };

    ease(this.legs[0], 'x', stride);
    ease(this.legs[1], 'x', -stride);

    // Arms swing against the legs; at rest they hang with a slow sway. A held
    // item lifts the right forearm; mining/attacking chops it.
    const sway = Math.sin(this._t * 1.6) * 0.03;
    let right = -stride * 0.85;
    if (swinging) right = -1.15 + Math.sin(this._t * 17) * 0.75;
    else if (this.heldName) right = right * 0.5 - 0.32;
    ease(this.armR, 'x', right);
    ease(this.armL, 'x', stride * 0.85);
    this.armR.rotation.z = -0.05 - sway;
    this.armL.rotation.z = 0.05 + sway;

    // Head follows the look pitch (nose down is +x).
    ease(this.head, 'x', -Math.max(-1.2, Math.min(1.2, pitch)));
    // A little bounce in the step.
    this.model.position.y = moving ? Math.abs(Math.sin(this._phase)) * 0.035 : 0;
  }

  // Frees this avatar's own geometry and material. The skin textures and the
  // held item's plate/cube are shared caches and are left alone.
  dispose() {
    this._clearHeld();
    for (const m of this.meshes) m.geometry.dispose();
    if (this.meshes[0]) this.meshes[0].material.dispose();
  }
}
