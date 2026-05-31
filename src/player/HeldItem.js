import * as THREE from 'three';

// Procedural placeholder view-models for held items. Built from simple boxes so
// they can be swapped for real geometry/textures later. `item` is an item def
// from the registry (null = bare hand).
export function buildHeldModel(item) {
  const group = new THREE.Group();

  if (!item) {
    // Bare hand: a single skin-toned box (a stubby arm/fist).
    const hand = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.14, 0.42),
      new THREE.MeshLambertMaterial({ color: '#e0ac69' })
    );
    hand.position.set(0, -0.02, 0.05);
    group.add(hand);
    return group;
  }

  // Non-tool items (blocks, materials) are held as a small cube.
  if (!item.toolType) {
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.28, 0.28),
      new THREE.MeshLambertMaterial({ color: item.color || '#cccccc' })
    );
    group.add(cube);
    return group;
  }

  const stickMat = new THREE.MeshLambertMaterial({ color: '#7a5a2c' });
  const headMat = new THREE.MeshLambertMaterial({ color: item.color || '#cccccc' });

  // Handle (the stick).
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.05), stickMat);
  group.add(handle);

  // Head: a central bar plus two angled tips so it reads as a pickaxe, not a
  // hammer.
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.08), headMat);
  bar.position.y = 0.24;
  group.add(bar);

  const makeTip = (sign) => {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.06), headMat);
    tip.position.set(sign * 0.14, 0.21, 0);
    tip.rotation.z = sign * -0.5;
    return tip;
  };
  group.add(makeTip(1), makeTip(-1));

  return group;
}
