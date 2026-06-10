import * as THREE from 'three';

// Break-progress overlay: 5 stages of procedural crack texture, drawn once at
// load. Cracks are jagged random walks radiating from the centre — more, and
// longer, each stage. Applied to a unit box over the targeted block.

const S = 16;
const STAGES = 5;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function crackTexture(stage) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  // Same seed every stage: earlier cracks persist and new ones join in, so the
  // pattern grows instead of jumping around.
  const rng = mulberry32(0xcaac);
  const walks = 2 + stage * 2;
  for (let w = 0; w < walks; w++) {
    let x = 5 + rng() * 6;
    let y = 5 + rng() * 6;
    let dir = rng() * Math.PI * 2;
    const len = 5 + stage * 2 + rng() * 3;
    for (let i = 0; i < len; i++) {
      const dark = rng() < 0.75;
      ctx.fillStyle = dark ? 'rgba(16,12,8,0.9)' : 'rgba(48,40,30,0.8)';
      ctx.fillRect(((x | 0) % S + S) % S, ((y | 0) % S + S) % S, 1, 1);
      dir += (rng() - 0.5) * 1.2;
      x += Math.cos(dir);
      y += Math.sin(dir);
      // Branch occasionally on later stages.
      if (stage >= 2 && rng() < 0.08) {
        ctx.fillRect((((x + 1) | 0) % S + S) % S, ((y | 0) % S + S) % S, 1, 1);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}

// One material per stage; swap by progress. polygonOffset keeps the overlay
// from z-fighting with the block faces beneath it.
export const CRACK_MATERIALS = Array.from({ length: STAGES }, (_, i) =>
  new THREE.MeshBasicMaterial({
    map: crackTexture(i),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
);

export const CRACK_STAGES = STAGES;
