import * as THREE from 'three';
import { buildModel } from './MobModels.js';
import { getSkin, isSkin, skinForName } from './playerSkins.js';
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
// What it looks like is a skin from playerSkins.js: the one the player chose
// in the menu, or — for a bot, or a player whose choice has not arrived — one
// picked from the name, so they still look the same to everyone.

const SCALE = 0.9; // 2.0-block model -> 1.8-block player

export class PlayerAvatar {
  constructor(name, skinId = null) {
    const skin = getSkin(isSkin(skinId) ? skinId : skinForName(name || 'Player'));
    this.skin = skin.id;
    // What the bare first-person arm looks like (HeldItem.buildHeldModel).
    this.appearance = skin.hand;
    this.model = buildModel(skin.def, skin.key, skin.paint);
    this.model.scale.setScalar(SCALE);
    // How tall it stands, hat included (blocks) — name tags float above this.
    this.height = SCALE * Math.max(...skin.def.parts.map((p) => p.pos[1] + p.size[1] / 2));
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
