import * as THREE from 'three';
import blockData from '../blocks/blocks.json';

// Procedural pixel-art textures generated on a canvas at load time — no binary
// assets to ship. Each tile is its own 16x16 CanvasTexture with RepeatWrapping
// so the greedy mesher can tile one tile across a merged quad (UVs run 0..w).

const TILE = 16;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const clamp = (v) => Math.max(0, Math.min(255, v | 0));

function makeCtx() {
  const c = document.createElement('canvas');
  c.width = c.height = TILE;
  return { canvas: c, ctx: c.getContext('2d') };
}

// Fill the whole tile with a base colour plus per-pixel brightness jitter.
function fillNoise(ctx, hex, jitter, rng) {
  const [r, g, b] = rgb(hex);
  const img = ctx.createImageData(TILE, TILE);
  for (let i = 0; i < TILE * TILE; i++) {
    const d = (rng() - 0.5) * 2 * jitter;
    img.data[i * 4] = clamp(r + d);
    img.data[i * 4 + 1] = clamp(g + d);
    img.data[i * 4 + 2] = clamp(b + d);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function setPx(ctx, x, y, hex, a = 1, jitter = 0, rng = null) {
  const [r, g, b] = rgb(hex);
  const d = jitter && rng ? (rng() - 0.5) * 2 * jitter : 0;
  ctx.fillStyle = `rgba(${clamp(r + d)},${clamp(g + d)},${clamp(b + d)},${a})`;
  ctx.fillRect(x, y, 1, 1);
}

function blobs(ctx, color, count, rng, size = 2) {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rng() * TILE), y = Math.floor(rng() * TILE);
    const s = 1 + Math.floor(rng() * size);
    for (let dx = 0; dx < s; dx++) for (let dy = 0; dy < s; dy++) {
      setPx(ctx, (x + dx) % TILE, (y + dy) % TILE, color, 1, 18, rng);
    }
  }
}

// --- Per-tile drawing routines (seeded so the atlas is stable) ---
const DRAW = {
  grass_top: (c, r) => { fillNoise(c, '#5d9c3c', 18, r); blobs(c, '#4f8a30', 18, r, 1); },
  grass_side: (c, r) => {
    fillNoise(c, '#7a5c3e', 16, r);
    for (let x = 0; x < TILE; x++) { const top = 3 + Math.floor(r() * 2); for (let y = 0; y < top; y++) setPx(c, x, y, '#5d9c3c', 1, 16, r); }
  },
  dirt: (c, r) => { fillNoise(c, '#7a5c3e', 18, r); blobs(c, '#6b4f33', 10, r, 1); },
  stone: (c, r) => { fillNoise(c, '#8a8a8a', 16, r); blobs(c, '#787878', 8, r, 2); },
  cobblestone: (c, r) => {
    fillNoise(c, '#8a8a8a', 14, r);
    c.strokeStyle = 'rgba(70,70,70,0.8)';
    for (const [x, y, w, h] of [[0, 0, 7, 7], [8, 0, 7, 9], [0, 8, 6, 7], [7, 10, 8, 5]]) c.strokeRect(x + 0.5, y + 0.5, w, h);
  },
  sand: (c, r) => fillNoise(c, '#dbcd9c', 12, r),
  gravel: (c, r) => { fillNoise(c, '#86807c', 18, r); blobs(c, '#5e5a57', 14, r, 1); blobs(c, '#a8a29c', 8, r, 1); },
  snow: (c, r) => fillNoise(c, '#f4f8fc', 7, r),
  bedrock: (c, r) => { fillNoise(c, '#555555', 30, r); blobs(c, '#2c2c2c', 14, r, 2); },
  andesite: (c, r) => { fillNoise(c, '#888a88', 12, r); blobs(c, '#9a9c9a', 8, r, 1); },
  log_top: (c, r) => {
    fillNoise(c, '#b3884f', 10, r);
    c.strokeStyle = 'rgba(90,67,39,0.9)';
    for (const rad of [2, 4, 6]) c.strokeRect(8 - rad + 0.5, 8 - rad + 0.5, rad * 2, rad * 2);
  },
  log_side: (c, r) => { fillNoise(c, '#6b5235', 12, r); for (let x = 2; x < TILE; x += 5) for (let y = 0; y < TILE; y++) setPx(c, x, y, '#5a4327', 0.7, 10, r); },
  leaves: (c, r) => {
    fillNoise(c, '#3f7a2c', 22, r);
    const img = c.getImageData(0, 0, TILE, TILE);
    for (let i = 0; i < TILE * TILE; i++) if (r() < 0.22) img.data[i * 4 + 3] = 0; // gaps
    c.putImageData(img, 0, 0);
  },
  planks: (c, r) => {
    fillNoise(c, '#b3884f', 10, r);
    c.strokeStyle = 'rgba(120,90,52,0.9)';
    for (let y = 0; y < TILE; y += 4) c.strokeRect(-0.5, y + 0.5, TILE + 1, 0);
    c.strokeRect(7.5, 0, 0, TILE);
  },
  clay: (c, r) => fillNoise(c, '#9aa0ac', 9, r),
  cactus: (c, r) => { fillNoise(c, '#3c7a3c', 12, r); for (let y = 0; y < TILE; y += 3) setPx(c, 8, y, '#2e5e2e', 1, 8, r); },
  water: (c, r) => { fillNoise(c, '#3a6dd1', 16, r); const img = c.getImageData(0, 0, TILE, TILE); for (let i = 0; i < TILE * TILE; i++) img.data[i * 4 + 3] = 205; c.putImageData(img, 0, 0); },
  glass: (c) => {
    c.clearRect(0, 0, TILE, TILE);
    c.strokeStyle = 'rgba(200,235,245,0.85)'; c.strokeRect(0.5, 0.5, TILE - 1, TILE - 1);
    c.fillStyle = 'rgba(220,245,255,0.5)'; c.fillRect(3, 3, 4, 1); c.fillRect(3, 3, 1, 4);
  },
  crafting_top: (c, r) => { DRAW.planks(c, r); c.strokeStyle = 'rgba(70,50,30,0.9)'; c.strokeRect(0.5, 0.5, 15, 15); c.strokeRect(8.5, 0, 0, 16); c.strokeRect(0, 8.5, 16, 0); },
  crafting_side: (c, r) => { DRAW.planks(c, r); c.fillStyle = 'rgba(90,67,39,0.8)'; c.fillRect(2, 2, 5, 5); c.fillRect(9, 9, 4, 4); },
  furnace_side: (c, r) => DRAW.cobblestone(c, r),
  furnace_front: (c, r) => { DRAW.cobblestone(c, r); c.fillStyle = '#241c14'; c.fillRect(4, 7, 8, 6); c.fillStyle = '#c2531a'; c.fillRect(5, 11, 6, 2); },
  torch: (c) => {
    c.fillStyle = '#1a1208'; c.fillRect(0, 0, TILE, TILE);
    c.fillStyle = '#6b4f2a'; c.fillRect(7, 6, 2, 9); // stick
    c.fillStyle = '#f0b030'; c.fillRect(6, 2, 4, 5);  // flame
    c.fillStyle = '#fff2a0'; c.fillRect(7, 3, 2, 2);  // hot core
  },
};

// Ores: stone base + a cluster of coloured specks.
const ORE_COLORS = {
  coal_ore: '#2b2b2b', iron_ore: '#caa07e', gold_ore: '#e8d24a',
  redstone_ore: '#d11616', lapis_ore: '#27479e', diamond_ore: '#4fd3c8', emerald_ore: '#2fbf5e',
};
for (const [name, col] of Object.entries(ORE_COLORS)) {
  DRAW[name] = (c, r) => { DRAW.stone(c, r); blobs(c, col, 7, r, 2); };
}

// Block name -> per-face tile names.
const t = (name) => ({ top: name, side: name, bottom: name });
const FACE_TILES = {
  grass: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' },
  dirt: t('dirt'), stone: t('stone'), sand: t('sand'), gravel: t('gravel'),
  snow: t('snow'), bedrock: t('bedrock'), andesite: t('andesite'),
  oak_log: { top: 'log_top', side: 'log_side', bottom: 'log_top' },
  oak_leaves: t('leaves'), cactus: t('cactus'), clay: t('clay'),
  water: t('water'), oak_planks: t('planks'), glass: t('glass'),
  crafting_table: { top: 'crafting_top', side: 'crafting_side', bottom: 'planks' },
  furnace: { top: 'furnace_side', side: 'furnace_front', bottom: 'furnace_side' },
  torch: t('torch'),
};
for (const name of Object.keys(ORE_COLORS)) FACE_TILES[name] = t(name);

const CUTOUT = new Set(['leaves', 'glass']);
const TRANSPARENT = new Set(['water']);

// --- Build textures + materials once ---
const tileNames = Object.keys(DRAW);
const tileIndex = {};
const textures = [];
const materials = [];

tileNames.forEach((name, i) => {
  tileIndex[name] = i;
  const { canvas, ctx } = makeCtx();
  DRAW[name](ctx, mulberry32(0x9e37 + i * 131));
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  textures.push(tex);

  const opts = { map: tex, vertexColors: true };
  if (CUTOUT.has(name)) { opts.transparent = true; opts.alphaTest = 0.5; opts.side = THREE.DoubleSide; }
  else if (TRANSPARENT.has(name)) { opts.transparent = true; opts.opacity = 0.85; opts.depthWrite = false; opts.side = THREE.DoubleSide; }
  else if (name === 'torch') { opts.emissive = new THREE.Color('#ffaa33'); opts.emissiveIntensity = 0.9; } // self-glow
  materials.push(new THREE.MeshLambertMaterial(opts));
});

// Per block id -> { top, side, bottom } material indices.
const faceMat = [];
for (const def of blockData) {
  const ft = FACE_TILES[def.name];
  if (!ft) continue;
  faceMat[def.id] = {
    top: tileIndex[ft.top], side: tileIndex[ft.side], bottom: tileIndex[ft.bottom],
  };
}

export const BLOCK_MATERIALS = materials; // index = material index used in geometry groups
export const WATER_MATERIAL_INDEX = tileIndex.water;

export function faceMaterialIndex(blockId, face) {
  const m = faceMat[blockId];
  if (!m) return 0;
  return face === 'top' ? m.top : face === 'bottom' ? m.bottom : m.side;
}

// Expose a tile's canvas as a data URL (for UI item icons).
export function tileDataURL(name) {
  const i = tileIndex[name];
  if (i == null) return null;
  return textures[i].image.toDataURL();
}
export { tileIndex, FACE_TILES };
