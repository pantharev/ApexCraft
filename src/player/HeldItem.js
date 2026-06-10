import * as THREE from 'three';
import { itemIconCanvas } from '../textures/icons.js';
import { extrudeCanvas, plateMaterial, buildBlockCube, buildTorchModel } from '../items/ItemModels.js';

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

  // Other block items: textured mini cube of the actual block.
  if (item.placeBlock) {
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
