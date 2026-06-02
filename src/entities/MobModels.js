import * as THREE from 'three';
import { MOBS } from './mobTypes.js';

// Builds a placeholder box model for a mob type. Returns a Group; leg parts are
// collected on group.userData.legs (pivoted at the top) so the Mob can swing
// them while walking. Easy to replace with real models/textures later.
export function buildMobModel(type) {
  const def = MOBS[type];
  const group = new THREE.Group();
  const legs = [];

  for (const part of def.parts) {
    const [w, h, d] = part.size;
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshLambertMaterial({ color: part.color });

    if (part.leg) {
      // Pivot at the top of the leg so rotation looks like a hip joint.
      geo.translate(0, -h / 2, 0);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(part.pos[0], part.pos[1] + h / 2, part.pos[2]);
      group.add(mesh);
      legs.push(mesh);
    } else {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(part.pos[0], part.pos[1], part.pos[2]);
      group.add(mesh);
    }
  }

  group.userData.legs = legs;
  return group;
}
