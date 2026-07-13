import * as THREE from 'three';
import { itemIconCanvas } from '../textures/icons.js';
import { extrudeCanvas, plateMaterial, buildBlockCube, buildTorchModel } from '../items/ItemModels.js';
import { getBlock, getBlockId } from '../blocks/BlockRegistry.js';

// First-person view-models for held items. Tools, food, and materials extrude
// their own 16x16 icon into a voxel plate (so the sword in your hand IS the
// sword icon); block items are mini cubes textured with the real atlas
// materials; the torch is a proper little torch with a glowing head.
// `item` is an item def from the registry (null = bare hand).
//
// Note: the Game disposes geometry when the held item changes, so everything
// here builds fresh geometry (materials are shared and survive disposal).
export function buildHeldModel(item) {
  const group = new THREE.Group();

  if (!item) {
    // Bare hand: forearm + fist, skin-toned.
    const skin = new THREE.MeshLambertMaterial({ color: '#e0ac69' });
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.34), skin);
    arm.position.set(0, -0.04, 0.12);
    arm.rotation.x = 0.2;
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.15, 0.16), skin);
    fist.position.set(0, 0.02, -0.08);
    group.add(arm, fist);
    return group;
  }

  // Torch: matches the placed torch (stick + glowing flame).
  if (item.placeBlock === 'torch') {
    const torch = buildTorchModel(1);
    torch.rotation.z = 0.18; // slight tilt in the grip
    group.add(torch);
    return group;
  }

  // Guns (Zombies weapons): proper box-built silhouettes, angled down-range.
  if (item.gun) {
    const gun = buildGunModel(item.name);
    gun.rotation.y = 0.06; // barrel points just left of the crosshair
    group.add(gun);
    return group;
  }

  // Other block items: textured mini cube of the actual block. Cross-plants,
  // doors, stairs, and beds fall through to the extruded icon plate — their
  // icons read far better than a cube.
  const blockDef = item.placeBlock ? getBlock(getBlockId(item.placeBlock)) : null;
  if (blockDef && !blockDef.plant && !blockDef.door && !blockDef.stair && !blockDef.bed && !blockDef.fence) {
    const cube = buildBlockCube(item.placeBlock, 0.3);
    cube.rotation.y = 0.35; // show two faces
    group.add(cube);
    return group;
  }

  // Everything else: the item's icon, extruded into a chunky plate.
  const mesh = new THREE.Mesh(extrudeCanvas(itemIconCanvas(item.name), 0.62), plateMaterial());
  mesh.rotation.y = 0.18; // slight angle so the thickness reads
  mesh.position.y = 0.06;
  group.add(mesh);
  return group;
}

// Box-built first-person gun models. -z is down-range (the camera looks down
// -z and the anchor sits bottom-right, so the barrel extends forward). Fresh
// geometry per call — the Game disposes it when the held item changes.
function buildGunModel(name) {
  const g = new THREE.Group();
  const mat = (color, emissive = null) => new THREE.MeshLambertMaterial(
    emissive ? { color, emissive, emissiveIntensity: 0.8 } : { color }
  );
  const box = (w, h, d, m, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };

  if (name === 'ray_gun') {
    // Sci-fi pistol: chunky red-brown body, glowing green core rings + muzzle.
    const body = mat('#7a2a22');
    const dark = mat('#3a1f1a');
    const glow = mat('#3ad24a', '#2aa838');
    box(0.09, 0.11, 0.30, body, 0, 0.02, -0.05);      // receiver
    box(0.07, 0.14, 0.08, dark, 0, -0.10, 0.08);      // grip
    box(0.05, 0.05, 0.26, dark, 0, 0.02, -0.30);      // barrel core
    box(0.11, 0.11, 0.04, glow, 0, 0.02, -0.18);      // energy ring
    box(0.10, 0.10, 0.03, glow, 0, 0.02, -0.30);      // energy ring
    box(0.07, 0.07, 0.05, glow, 0, 0.02, -0.44);      // muzzle emitter
    return g;
  }

  // Rifle family: shared bones, per-gun proportions/palette.
  const spec = {
    m14: { wood: '#7a5a30', metal: '#3c3a34', barrel: 0.46, mag: 0.10, stock: 0.22 },
    ak74u: { wood: '#6a4a28', metal: '#4a4438', barrel: 0.24, mag: 0.20, stock: 0.10 },
    galil: { wood: '#2f333a', metal: '#3a3f46', barrel: 0.38, mag: 0.24, stock: 0.18 },
  }[name] || { wood: '#6a5a40', metal: '#444', barrel: 0.35, mag: 0.14, stock: 0.16 };
  const wood = mat(spec.wood);
  const metal = mat(spec.metal);
  box(0.08, 0.10, 0.34, wood, 0, 0, 0);                                  // receiver/stock body
  box(0.07, 0.09, spec.stock, wood, 0, -0.03, 0.17 + spec.stock / 2);    // shoulder stock
  box(0.035, 0.035, spec.barrel, metal, 0, 0.02, -0.17 - spec.barrel / 2); // barrel
  box(0.05, spec.mag, 0.07, metal, 0, -0.05 - spec.mag / 2, -0.06);      // magazine
  box(0.06, 0.10, 0.06, metal, 0, -0.10, 0.10);                          // grip
  box(0.03, 0.03, 0.05, metal, 0, 0.065, -0.15);                         // front sight
  return g;
}
