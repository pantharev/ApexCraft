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
//   userData.head — a sub-group pivoted at the first `head: true` part, so the
//                   mob can look around (eyes/beak/snout ride along)
export function buildMobModel(type) {
  const def = MOBS[type];
  const group = new THREE.Group();
  const legs = [];

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
    if (part.leg) {
      // Pivot at the top of the leg so rotation looks like a hip joint.
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
      legs.push(mesh);
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
  group.userData.head = headGroup;
  return group;
}
