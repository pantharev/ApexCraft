import * as THREE from 'three';
import blockData from '../blocks/blocks.json';

// Procedural pixel-art textures generated on a canvas at load time — no binary
// assets to ship. Each tile is its own 16x16 CanvasTexture with RepeatWrapping
// so the greedy mesher can tile one tile across a merged quad (UVs run 0..w).
//
// Tiles are built from a few primitives that all tile seamlessly:
//   • value noise (wrapped lattice)  -> soft organic patches
//   • toroidal voronoi               -> stones/cells with mortar seams
//   • per-pixel painters             -> ripples, rings, grain, cracks

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
const mix = (a, b, t) => a + (b - a) * t;

function makeCtx() {
  const c = document.createElement('canvas');
  c.width = c.height = TILE;
  return { canvas: c, ctx: c.getContext('2d') };
}

// Smooth value noise on a wrapped lattice — seamless across tile repeats.
// Returns fn(x, y) -> 0..1 for x,y in pixel space.
function valueNoise(rng, cells = 4) {
  const n = cells;
  const g = [];
  for (let i = 0; i < n; i++) { g.push([]); for (let j = 0; j < n; j++) g[i].push(rng()); }
  const at = (i, j) => g[((i % n) + n) % n][((j % n) + n) % n];
  return (x, y) => {
    const fx = (x / TILE) * n, fy = (y / TILE) * n;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = mix(at(ix, iy), at(ix + 1, iy), sx);
    const b = mix(at(ix, iy + 1), at(ix + 1, iy + 1), sx);
    return mix(a, b, sy);
  };
}

// Per-pixel painter: base colour modulated by brighten(x, y) (in colour steps,
// ±) plus white jitter. Writes a full ImageData in one pass.
function paint(ctx, hex, brighten, jitter, rng) {
  const [r, g, b] = rgb(hex);
  const img = ctx.createImageData(TILE, TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const i = (y * TILE + x) * 4;
      const d = (brighten ? brighten(x, y) : 0) + (jitter ? (rng() - 0.5) * 2 * jitter : 0);
      img.data[i] = clamp(r + d);
      img.data[i + 1] = clamp(g + d);
      img.data[i + 2] = clamp(b + d);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Backwards-compatible simple fill (kept for a few tiles).
function fillNoise(ctx, hex, jitter, rng) { paint(ctx, hex, null, jitter, rng); }

function setPx(ctx, x, y, hex, a = 1, jitter = 0, rng = null) {
  const [r, g, b] = rgb(hex);
  const d = jitter && rng ? (rng() - 0.5) * 2 * jitter : 0;
  ctx.fillStyle = `rgba(${clamp(r + d)},${clamp(g + d)},${clamp(b + d)},${a})`;
  ctx.fillRect(x, y, 1, 1);
}

// Toroidal voronoi cells: k seed stones, each with its own brightness; pixels
// near a boundary between two cells become mortar. Tiles seamlessly.
function voronoi(ctx, baseHex, mortarHex, k, rng, vary = 26, mortarW = 1.1) {
  const seeds = [];
  for (let i = 0; i < k; i++) seeds.push([rng() * TILE, rng() * TILE, (rng() - 0.5) * 2 * vary]);
  const [br, bg, bb] = rgb(baseHex);
  const [mr, mg, mb] = rgb(mortarHex);
  const img = ctx.createImageData(TILE, TILE);
  const wrapD = (a, b) => { const d = Math.abs(a - b); return Math.min(d, TILE - d); };
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let d1 = 1e9, d2 = 1e9, s1 = 0;
      for (const [sx, sy, sb] of seeds) {
        const d = wrapD(x + 0.5, sx) ** 2 + wrapD(y + 0.5, sy) ** 2;
        if (d < d1) { d2 = d1; d1 = d; s1 = sb; }
        else if (d < d2) d2 = d;
      }
      const i = (y * TILE + x) * 4;
      const edge = Math.sqrt(d2) - Math.sqrt(d1); // small near boundaries
      if (edge < mortarW) {
        img.data[i] = mr; img.data[i + 1] = mg; img.data[i + 2] = mb;
      } else {
        const j = (rng() - 0.5) * 14;
        // Stones get a soft 3D feel: brighter at their centre.
        const dome = Math.max(0, 1 - Math.sqrt(d1) / 6) * 10;
        img.data[i] = clamp(br + s1 + j + dome);
        img.data[i + 1] = clamp(bg + s1 + j + dome);
        img.data[i + 2] = clamp(bb + s1 + j + dome);
      }
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// A meandering 1px crack with occasional highlight on its sunward side.
function crack(ctx, rng, dark, light) {
  let x = Math.floor(rng() * TILE), y = Math.floor(rng() * 4);
  const len = 8 + Math.floor(rng() * 5);
  for (let i = 0; i < len; i++) {
    setPx(ctx, ((x % TILE) + TILE) % TILE, ((y % TILE) + TILE) % TILE, dark, 0.9);
    if (rng() < 0.4) setPx(ctx, (((x + 1) % TILE) + TILE) % TILE, ((y % TILE) + TILE) % TILE, light, 0.5);
    y += 1;
    if (rng() < 0.45) x += rng() < 0.5 ? -1 : 1;
  }
}

// --- Per-tile drawing routines (seeded so the atlas is stable) ---
const DRAW = {
  grass_top: (c, r) => {
    const vn = valueNoise(r, 4);
    paint(c, '#5b9c3a', (x, y) => (vn(x, y) - 0.5) * 34, 9, r);
    for (let i = 0; i < 20; i++) setPx(c, (r() * TILE) | 0, (r() * TILE) | 0, '#477e2c', 1, 14, r); // dark blades
    for (let i = 0; i < 10; i++) setPx(c, (r() * TILE) | 0, (r() * TILE) | 0, '#79bd4e', 1, 14, r); // light blades
  },
  grass_side: (c, r) => {
    DRAW.dirt(c, r);
    // Grass band with a wavy lower edge and hanging drips.
    for (let x = 0; x < TILE; x++) {
      const top = 2 + ((x * 7 + 3) % 3 === 0 ? 1 : 0) + (r() < 0.3 ? 1 : 0);
      for (let y = 0; y < top; y++) setPx(c, x, y, y === top - 1 ? '#4d8531' : '#5b9c3a', 1, 12, r);
      if (r() < 0.22) setPx(c, x, top, '#4d8531', 1, 10, r); // drip
    }
  },
  dirt: (c, r) => {
    const vn = valueNoise(r, 4);
    paint(c, '#7a5a3c', (x, y) => (vn(x, y) - 0.5) * 30, 11, r);
    for (let i = 0; i < 6; i++) { // little stones with a shadow pixel
      const x = (r() * TILE) | 0, y = (r() * TILE) | 0;
      setPx(c, x, y, '#9b8259', 1, 10, r);
      setPx(c, x, (y + 1) % TILE, '#5e4429', 0.8, 10, r);
    }
    for (let i = 0; i < 5; i++) setPx(c, (r() * TILE) | 0, (r() * TILE) | 0, '#65482c', 1, 10, r);
  },
  stone: (c, r) => {
    const vn = valueNoise(r, 3);
    paint(c, '#8b8b8f', (x, y) => (vn(x, y) - 0.5) * 22, 7, r);
    crack(c, r, '#6c6c70', '#a2a2a6');
    crack(c, r, '#707074', '#9e9ea2');
  },
  cobblestone: (c, r) => voronoi(c, '#8d8d8d', '#585858', 7, r, 24),
  sand: (c, r) => {
    const vn = valueNoise(r, 3);
    // Wind ripples: soft horizontal waves bent by the noise field.
    paint(c, '#dccf9f', (x, y) => Math.sin((y + vn(x, y) * 5) * 1.15) * 9 + (vn(x, y) - 0.5) * 10, 6, r);
    for (let i = 0; i < 5; i++) setPx(c, (r() * TILE) | 0, (r() * TILE) | 0, '#bda97a', 1, 8, r);
  },
  gravel: (c, r) => voronoi(c, '#85807b', '#55504c', 13, r, 30, 0.8),
  snow: (c, r) => {
    const vn = valueNoise(r, 4);
    paint(c, '#f3f7fb', (x, y) => (vn(x, y) - 0.6) * 16, 3, r);
    for (let i = 0; i < 4; i++) setPx(c, (r() * TILE) | 0, (r() * TILE) | 0, '#ffffff', 1);
  },
  bedrock: (c, r) => voronoi(c, '#4e4e52', '#222226', 6, r, 44),
  andesite: (c, r) => {
    const vn = valueNoise(r, 5);
    paint(c, '#888d88', (x, y) => (vn(x, y) - 0.5) * 18, 9, r);
    crack(c, r, '#6f746f', '#9da29d');
  },
  log_top: (c, r) => {
    const vn = valueNoise(r, 3);
    paint(c, '#c0935a', (x, y) => {
      const dx = x - 7.5, dy = y - 7.5;
      const d = Math.sqrt(dx * dx + dy * dy) + vn(x, y) * 1.6;
      const edge = Math.max(Math.abs(dx), Math.abs(dy));
      if (edge > 6.4) return -54; // bark rim
      return Math.sin(d * 2.1) * 16 - d * 1.5; // growth rings
    }, 6, r);
  },
  log_side: (c, r) => {
    // Vertical bark strips with per-column relief and a knot.
    const colShade = [];
    for (let x = 0; x < TILE; x++) colShade.push((r() - 0.5) * 26 - (x % 5 === 0 ? 22 : 0));
    const vn = valueNoise(r, 4);
    paint(c, '#6e5536', (x, y) => colShade[x] + (vn(x, y) - 0.5) * 14, 8, r);
    const kx = 3 + ((r() * 10) | 0), ky = 4 + ((r() * 8) | 0);
    setPx(c, kx, ky, '#3f2e1a', 1); setPx(c, kx, ky + 1, '#3f2e1a', 1);
    setPx(c, kx, ky - 1, '#8a6b42', 1); setPx(c, kx, ky + 2, '#8a6b42', 1);
  },
  leaves: (c, r) => {
    const vn = valueNoise(r, 4);
    paint(c, '#3f7a2c', (x, y) => (vn(x, y) - 0.5) * 44, 15, r);
    const img = c.getImageData(0, 0, TILE, TILE);
    for (let i = 0; i < TILE * TILE; i++) {
      if (r() < 0.16) img.data[i * 4 + 3] = 0;            // sky gaps
      else if (r() < 0.12) {                              // deep shadow leaves
        img.data[i * 4] = clamp(img.data[i * 4] * 0.6);
        img.data[i * 4 + 1] = clamp(img.data[i * 4 + 1] * 0.6);
        img.data[i * 4 + 2] = clamp(img.data[i * 4 + 2] * 0.6);
      }
    }
    c.putImageData(img, 0, 0);
  },
  planks: (c, r) => {
    // Four planks with their own tone, grain streaks, gaps, and nails.
    const tones = [0, 0, 0, 0].map(() => (r() - 0.5) * 22);
    const vn = valueNoise(r, 5);
    paint(c, '#b3884f', (x, y) => {
      const row = (y / 4) | 0;
      const gap = y % 4 === 3 ? -46 : 0;
      const grain = Math.sin(x * 1.6 + row * 2 + vn(x, y) * 5) * 6;
      return tones[row] + gap + grain;
    }, 5, r);
    for (let row = 0; row < 4; row++) {
      const nx = row % 2 === 0 ? 1 : 9;
      setPx(c, nx, row * 4 + 1, '#5e4626', 1);
      setPx(c, nx + 6, row * 4 + 1, '#5e4626', 1);
    }
  },
  clay: (c, r) => {
    const vn = valueNoise(r, 3);
    paint(c, '#9aa0ac', (x, y) => Math.sin(x * 0.55 + vn(x, y) * 4.5) * 6 + (vn(x, y) - 0.5) * 8, 4, r);
  },
  cactus: (c, r) => {
    // Ribbed body: bright ridges and dark grooves, with pale spines.
    paint(c, '#3c7a3c', (x) => Math.sin(x * 1.6 + 0.8) * 14, 7, r);
    for (let x = 1; x < TILE; x += 4) {
      for (let y = 1; y < TILE; y += 4) setPx(c, x, (y + ((x * 3) % 4)) % TILE, '#d8e8c0', 0.9);
    }
  },
  water: (c, r) => {
    const vn = valueNoise(r, 3);
    paint(c, '#3567c9', (x, y) => Math.sin((y + vn(x, y) * 6) * 0.82) * 14 + (vn(x, y) - 0.5) * 18, 5, r);
    const img = c.getImageData(0, 0, TILE, TILE);
    for (let i = 0; i < TILE * TILE; i++) img.data[i * 4 + 3] = 205;
    c.putImageData(img, 0, 0);
  },
  lava: (c, r) => {
    // Molten rock: dark crust veins broken by glowing cracks and hot pools.
    const vn = valueNoise(r, 3);
    paint(c, '#d8480c', (x, y) => Math.sin((x + vn(x, y) * 7) * 0.9) * 22 + (vn(x, y) - 0.5) * 40, 8, r);
    const img = c.getImageData(0, 0, TILE, TILE);
    const vn2 = valueNoise(r, 5);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const i = (y * TILE + x) * 4;
      const n = vn2(x, y);
      if (n < 0.34) { // cooled crust patches go dark
        img.data[i] = clamp(img.data[i] * 0.4);
        img.data[i + 1] = clamp(img.data[i + 1] * 0.3);
        img.data[i + 2] = clamp(img.data[i + 2] * 0.3);
      }
    }
    c.putImageData(img, 0, 0);
    // Bright bubbling hot spots punched through the crust.
    for (let i = 0; i < 7; i++) {
      const x = (r() * TILE) | 0, y = (r() * TILE) | 0;
      setPx(c, x, y, '#ffd23a', 1, 12, r);
      if (r() < 0.6) setPx(c, (x + 1) % TILE, y, '#ff8a1e', 0.9, 12, r);
    }
  },
  glass: (c) => {
    c.clearRect(0, 0, TILE, TILE);
    c.fillStyle = 'rgba(215,240,250,0.10)'; c.fillRect(0, 0, TILE, TILE);
    c.strokeStyle = 'rgba(200,235,245,0.9)'; c.strokeRect(0.5, 0.5, TILE - 1, TILE - 1);
    c.fillStyle = 'rgba(235,250,255,0.55)';
    for (let i = 0; i < 5; i++) { c.fillRect(3 + i, 8 - i, 1, 1); c.fillRect(8 + i, 13 - i, 1, 1); }
  },
  crafting_top: (c, r) => {
    DRAW.planks(c, r);
    c.strokeStyle = 'rgba(60,42,22,0.95)'; c.strokeRect(0.5, 0.5, 15, 15);
    c.strokeRect(8.5, 0, 0, 16); c.strokeRect(0, 8.5, 16, 0);
  },
  crafting_side: (c, r) => {
    DRAW.planks(c, r);
    c.fillStyle = 'rgba(80,58,32,0.9)'; c.fillRect(2, 2, 5, 5); c.fillRect(9, 9, 4, 4);
    c.fillStyle = 'rgba(150,150,158,0.9)'; c.fillRect(3, 3, 2, 1); c.fillRect(10, 10, 1, 2); // tool glints
  },
  furnace_side: (c, r) => voronoi(c, '#828282', '#525252', 7, r, 22),
  furnace_front: (c, r) => {
    voronoi(c, '#828282', '#525252', 7, r, 22);
    // Arched mouth with embers glowing inside.
    c.fillStyle = '#1c150e';
    c.fillRect(5, 7, 6, 1); c.fillRect(4, 8, 8, 6);
    c.fillStyle = '#7a2d08'; c.fillRect(5, 11, 6, 3);
    c.fillStyle = '#c2531a'; c.fillRect(5, 12, 6, 2);
    c.fillStyle = '#f0a040'; c.fillRect(6, 13, 4, 1);
    c.fillStyle = '#ffe080'; c.fillRect(7, 13, 2, 1);
  },
  torch: (c) => {
    c.fillStyle = '#1a1208'; c.fillRect(0, 0, TILE, TILE);
    c.fillStyle = '#6b4f2a'; c.fillRect(7, 6, 2, 9); // stick
    c.fillStyle = '#f0b030'; c.fillRect(6, 2, 4, 5);  // flame
    c.fillStyle = '#fff2a0'; c.fillRect(7, 3, 2, 2);  // hot core
  },
  chest_top: (c, r) => {
    const vn = valueNoise(r, 4);
    paint(c, '#9c7038', (x, y) => (vn(x, y) - 0.5) * 18 + Math.sin(x * 1.7) * 4, 5, r);
    c.strokeStyle = 'rgba(62,42,20,0.95)'; c.strokeRect(0.5, 0.5, 15, 15);
    c.fillStyle = '#9aa0a8'; c.fillRect(7, 0, 2, 4);
    c.fillStyle = '#5a6068'; c.fillRect(7, 3, 2, 1);
  },
  chest_side: (c, r) => {
    const vn = valueNoise(r, 4);
    paint(c, '#8a6230', (x, y) => (vn(x, y) - 0.5) * 18 + Math.sin(x * 1.7) * 4, 5, r);
    c.strokeStyle = 'rgba(62,42,20,0.95)';
    c.strokeRect(0.5, 0.5, 15, 15); c.strokeRect(0, 5.5, 16, 0);
    c.fillStyle = '#9aa0a8'; c.fillRect(7, 4, 2, 3);   // clasp
    c.fillStyle = '#3a2a14'; c.fillRect(7, 6, 2, 1);   // keyhole
  },
  // Door panels (rendered as thin slabs by the mesher's special pass).
  door_bottom: (c, r) => {
    const vn = valueNoise(r, 5);
    paint(c, '#9c7a44', (x, y) => (vn(x, y) - 0.5) * 14 + Math.sin(x * 1.5) * 4, 5, r);
    c.strokeStyle = 'rgba(70,50,26,0.95)';
    c.strokeRect(0.5, 0.5, 15, 15);
    c.strokeRect(2.5, 1.5, 11, 6);          // upper inset panel
    c.strokeRect(2.5, 9.5, 11, 5);          // lower inset panel
    c.fillStyle = '#3a2a14'; c.fillRect(12, 7, 2, 2); // handle
    c.fillStyle = '#d8b878'; c.fillRect(12, 7, 1, 1);
  },
  door_top: (c, r) => {
    const vn = valueNoise(r, 5);
    paint(c, '#9c7a44', (x, y) => (vn(x, y) - 0.5) * 14 + Math.sin(x * 1.5) * 4, 5, r);
    c.strokeStyle = 'rgba(70,50,26,0.95)';
    c.strokeRect(0.5, 0.5, 15, 15);
    c.strokeRect(2.5, 8.5, 11, 6);          // lower inset panel
    // Window: 2x2 holes with a cross frame.
    c.clearRect(4, 2, 8, 5);
    c.fillStyle = '#5d4023';
    c.fillRect(3, 1, 10, 1); c.fillRect(3, 7, 10, 1);
    c.fillRect(3, 1, 1, 7); c.fillRect(12, 1, 1, 7);
    c.fillRect(7, 1, 2, 7); c.fillRect(3, 4, 10, 1);
  },
  bed_top: (c, r) => {
    // Foot half: red blanket with a fold stripe.
    const vn = valueNoise(r, 4);
    paint(c, '#b03028', (x, y) => (vn(x, y) - 0.5) * 16 + (y % 4 === 0 ? -8 : 0), 5, r);
    for (let x = 1; x < 15; x++) setPx(c, x, 3, '#d8554a', 1, 8, r); // fold
    c.strokeStyle = 'rgba(90,20,16,0.8)'; c.strokeRect(0.5, 0.5, 15, 15);
  },
  bed_top_head: (c, r) => {
    // Head half: blanket edge with a big centred pillow.
    const vn = valueNoise(r, 4);
    paint(c, '#b03028', (x, y) => (vn(x, y) - 0.5) * 16, 5, r);
    for (let y = 3; y <= 12; y++) {
      for (let x = 3; x <= 12; x++) {
        setPx(c, x, y, y > 10 || x > 11 ? '#cfd4da' : '#eef1f5', 1, 5, r);
      }
    }
    c.strokeStyle = 'rgba(90,20,16,0.8)'; c.strokeRect(0.5, 0.5, 15, 15);
  },
  bed_side: (c, r) => {
    const vn = valueNoise(r, 4);
    paint(c, '#7a5733', (x, y) => (vn(x, y) - 0.5) * 14, 6, r); // wooden frame
    for (let y = 0; y < 7; y++) for (let x = 0; x < 16; x++) {
      setPx(c, x, y, '#a82c24', 1, 10, r); // blanket overhang
    }
    c.strokeStyle = 'rgba(60,40,20,0.85)'; c.strokeRect(0.5, 0.5, 15, 15);
  },
  tnt_side: (c, r) => {
    paint(c, '#c43c2a', (x, y) => (y < 3 || y > 12 ? -20 : 0), 10, r);
    c.fillStyle = '#e8e2d4'; c.fillRect(0, 5, 16, 5);          // label band
    c.fillStyle = '#1a1a1a';                                    // T N T
    c.fillRect(2, 6, 3, 1); c.fillRect(3, 6, 1, 3);
    c.fillRect(6, 6, 1, 3); c.fillRect(9, 6, 1, 3); c.fillRect(6, 6, 4, 1); c.fillRect(9, 8, 1, 1);
    c.fillRect(11, 6, 3, 1); c.fillRect(12, 6, 1, 3);
  },
  tnt_top: (c, r) => {
    paint(c, '#d8c694', null, 10, r);
    c.fillStyle = '#c43c2a';
    for (const [x, y] of [[2, 2], [9, 2], [2, 9], [9, 9]]) c.fillRect(x, y, 5, 5);
    c.fillStyle = '#3a2a14'; c.fillRect(7, 7, 2, 2); // fuse
  },
  mega_tnt_side: (c, r) => {
    paint(c, '#6e1212', (x, y) => (y < 3 || y > 12 ? -22 : 0), 12, r);
    c.fillStyle = '#f2c200'; c.fillRect(0, 5, 16, 6);                 // yellow hazard band
    c.fillStyle = '#141414';                                          // black hazard blocks
    for (let x = 0; x < 16; x += 4) c.fillRect(x, 5, 2, 6);
    c.fillStyle = '#2c0808'; c.fillRect(0, 4, 16, 1); c.fillRect(0, 11, 16, 1); // trim
  },
  mega_tnt_top: (c, r) => {
    paint(c, '#6e1212', null, 12, r);
    c.fillStyle = '#f2c200'; c.fillRect(3, 3, 10, 10);                // warning cap
    c.fillStyle = '#141414'; c.fillRect(5, 5, 6, 6);
    c.fillStyle = '#f2c200'; c.fillRect(7, 7, 2, 2);                  // fuse glow
  },
  nuke_side: (c, r) => {
    paint(c, '#16261a', (x, y) => (y < 3 || y > 12 ? -22 : 0), 12, r);
    c.fillStyle = '#2fbf4a'; c.fillRect(0, 5, 16, 6);                 // radioactive green band
    c.fillStyle = '#0c160f';                                         // dark trefoil blades
    for (const [x, y] of [[8, 4], [4, 11], [12, 11]]) {              // three blades around center
      c.beginPath(); c.moveTo(8, 8); c.lineTo(x, y); c.lineTo(x + (x === 8 ? 0 : (x < 8 ? 2 : -2)), y + (y < 8 ? 1 : -1)); c.closePath(); c.fill();
    }
    c.fillStyle = '#0c160f'; c.fillRect(7, 7, 2, 2);                  // hub
    c.fillStyle = '#0a120c'; c.fillRect(0, 4, 16, 1); c.fillRect(0, 11, 16, 1); // trim
  },
  nuke_top: (c, r) => {
    paint(c, '#16261a', null, 12, r);
    c.fillStyle = '#2fbf4a'; c.fillRect(3, 3, 10, 10);               // warning cap
    c.fillStyle = '#0c160f'; c.fillRect(5, 5, 6, 6);
    c.fillStyle = '#7dff9a'; c.fillRect(7, 7, 2, 2);                 // glowing fuse
  },
  wool_block: (c, r) => {
    const vn = valueNoise(r, 4);
    // Soft weave: gentle diagonal crosshatch.
    paint(c, '#e8e4dc', (x, y) => (vn(x, y) - 0.5) * 14 + ((x + y) % 4 === 0 ? -10 : 0) + ((x - y & 3) === 2 ? -5 : 0), 4, r);
  },
  pumpkin_side: (c, r) => {
    paint(c, '#d8821e', (x) => Math.sin(x * 1.35 + 0.6) * 18, 6, r); // ribs
    for (let x = 0; x < 16; x++) { setPx(c, x, 0, '#a85f12', 1, 8, r); setPx(c, x, 15, '#a85f12', 1, 8, r); }
  },
  pumpkin_top: (c, r) => {
    const vn = valueNoise(r, 3);
    paint(c, '#c87718', (x, y) => { const d = Math.hypot(x - 7.5, y - 7.5); return Math.sin(Math.atan2(y - 7.5, x - 7.5) * 6) * 8 - d + (vn(x, y) - 0.5) * 8; }, 6, r);
    c.fillStyle = '#5d7a23'; c.fillRect(7, 6, 2, 3); c.fillRect(8, 5, 1, 2); // curled stem
  },
  melon_side: (c, r) => {
    paint(c, '#5da831', (x) => ((x % 4) < 2 ? 12 : -14) + Math.sin(x) * 3, 7, r); // stripes
  },
  hay_side: (c, r) => {
    const vn = valueNoise(r, 5);
    paint(c, '#d8b34a', (x, y) => (vn(x, y) - 0.5) * 20 + (x % 3 === 0 ? -12 : 0), 9, r); // strands
    for (let x = 0; x < 16; x++) { setPx(c, x, 4, '#a8842c', 1, 8, r); setPx(c, x, 11, '#a8842c', 1, 8, r); } // ties
  },
  hay_top: (c, r) => {
    const vn = valueNoise(r, 3);
    paint(c, '#c9a43e', (x, y) => { const d = Math.hypot(x - 7.5, y - 7.5); return Math.sin(d * 2.2 + vn(x, y) * 3) * 12 - d; }, 8, r); // cut swirl
  },
  sandstone: (c, r) => {
    const vn = valueNoise(r, 4);
    // Horizontal strata with subtle pocking.
    paint(c, '#d8c694', (x, y) => (y % 5 === 0 ? -16 : 0) + Math.sin(y * 0.8) * 6 + (vn(x, y) - 0.5) * 10, 5, r);
  },
  mossy_cobblestone: (c, r) => {
    voronoi(c, '#8d8d8d', '#585858', 7, r, 24);
    const vn = valueNoise(r, 3);
    const img = c.getImageData(0, 0, TILE, TILE);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      if (vn(x, y) < 0.58) continue; // moss creeps over the high-noise patches
      const i = (y * TILE + x) * 4;
      img.data[i] = img.data[i] * 0.45 + 40;
      img.data[i + 1] = img.data[i + 1] * 0.5 + 80;
      img.data[i + 2] = img.data[i + 2] * 0.4 + 30;
    }
    c.putImageData(img, 0, 0);
  },
  ladder: (c, r) => {
    c.clearRect(0, 0, TILE, TILE);
    c.fillStyle = '#9a7d4e';
    c.fillRect(2, 0, 2, 16); c.fillRect(12, 0, 2, 16);           // rails
    for (const y of [2, 7, 12]) { c.fillRect(2, y, 12, 2); }     // rungs
    c.fillStyle = '#7a5f38';
    for (const y of [3, 8, 13]) c.fillRect(2, y, 12, 1);         // rung shading
  },
  chess_top: (c, r) => {
    // An 8x8 board (2px squares) inlaid on a wooden rim.
    paint(c, '#7a5733', null, 8, r);
    for (let by = 0; by < 8; by++) {
      for (let bx = 0; bx < 8; bx++) {
        const light = (bx + by) % 2 === 0;
        const col = light ? '#e8d8b8' : '#5a4028';
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          setPx(c, bx * 2 + dx, by * 2 + dy, col, 1, 6, r);
        }
      }
    }
  },
  // Cross-plants (transparent background; rendered as X-quads in the world).
  tall_grass: (c, r) => {
    c.clearRect(0, 0, TILE, TILE);
    for (let i = 0; i < 8; i++) {
      const x = 1 + ((r() * 14) | 0);
      const h = 6 + ((r() * 8) | 0);
      const lean = r() < 0.5 ? -1 : 1;
      const col = ['#4f8a30', '#5d9c3c', '#6aae46'][(r() * 3) | 0];
      for (let k = 0; k < h; k++) {
        const bx = x + (k > h * 0.55 ? lean : 0);
        setPx(c, Math.max(0, Math.min(15, bx)), 15 - k, k >= h - 2 ? '#86c45e' : col, 1, 14, r);
      }
    }
  },
  poppy: (c, r) => {
    c.clearRect(0, 0, TILE, TILE);
    for (let y = 7; y <= 15; y++) setPx(c, 8, y, y % 3 === 0 ? '#3f7a2c' : '#4f8a30'); // stem
    setPx(c, 6, 11, '#4f8a30'); setPx(c, 7, 10, '#4f8a30');  // leaf
    setPx(c, 10, 12, '#4f8a30'); setPx(c, 9, 11, '#3f7a2c'); // leaf
    // Bloom: red petals around a dark heart.
    for (const [x, y] of [[7, 4], [8, 4], [9, 4], [6, 5], [7, 5], [9, 5], [10, 5], [7, 6], [8, 6], [9, 6]]) {
      setPx(c, x, y, '#d23227', 1, 16, r);
    }
    setPx(c, 8, 3, '#e8564a'); setPx(c, 6, 4, '#a82318'); setPx(c, 10, 6, '#a82318');
    setPx(c, 8, 5, '#33150c'); // heart
  },
  dandelion: (c, r) => {
    c.clearRect(0, 0, TILE, TILE);
    for (let y = 8; y <= 15; y++) setPx(c, 8, y, y % 3 === 0 ? '#3f7a2c' : '#4f8a30'); // stem
    setPx(c, 6, 12, '#4f8a30'); setPx(c, 7, 11, '#4f8a30'); // leaf
    setPx(c, 10, 13, '#4f8a30');
    // Puff: yellow ball with ray petals.
    for (const [x, y] of [[7, 4], [8, 4], [9, 4], [7, 5], [8, 5], [9, 5], [7, 6], [8, 6], [9, 6]]) {
      setPx(c, x, y, '#e8c93a', 1, 14, r);
    }
    for (const [x, y] of [[8, 2], [6, 3], [10, 3], [5, 5], [11, 5], [6, 7], [10, 7], [8, 7]]) {
      setPx(c, x, y, '#f4dd6a', 1, 10, r);
    }
    setPx(c, 8, 5, '#fff2a8'); // bright core
  },
  // Glow mushroom: a bioluminescent cave fungus. Thin pale-green stalk with a
  // cyan-teal domed cap rimmed in bright aqua. The emissive material in atlas.js
  // makes it self-illuminate regardless of cave darkness. Cap pixels are bright
  // so the texture reads even at the DARK_FLOOR vertex colour multiplier.
  glow_mushroom: (c, r) => {
    c.clearRect(0, 0, TILE, TILE);
    // Stalk: pale seafoam, slightly translucent-looking.
    for (let y = 10; y <= 15; y++) {
      setPx(c, 7, y, '#a0e8d8', 1, 8, r);
      setPx(c, 8, y, '#b8f0e4', 1, 8, r);
      setPx(c, 9, y, '#a0e8d8', 1, 8, r);
    }
    // Root flare at the base.
    setPx(c, 6, 15, '#88ccbc'); setPx(c, 10, 15, '#88ccbc');
    // Cap underside (gills): rows of alternating teal/dark-teal below the dome.
    for (let x = 5; x <= 11; x++) {
      for (let y = 7; y <= 9; y++) {
        setPx(c, x, y, (x + y) % 2 === 0 ? '#28b4a0' : '#1c8a78', 1, 6, r);
      }
    }
    // Cap dome: bright cyan-teal, brighter at the crown, with a glint spot.
    for (const [x, y] of [[8,3],[7,4],[8,4],[9,4],[6,5],[7,5],[8,5],[9,5],[10,5],
                            [5,6],[6,6],[7,6],[8,6],[9,6],[10,6],[11,6],[5,7],[11,7]]) {
      const dist = Math.abs(x - 8) + Math.abs(y - 4.5);
      const col = dist < 2 ? '#78ffee' : '#40d8be';
      setPx(c, x, y, col, 1, 10, r);
    }
    // Crown hotspot: near-white so the emissive glow reads even when vertex-dark.
    setPx(c, 8, 3, '#c0fff8'); setPx(c, 7, 4, '#a8f8f0'); setPx(c, 9, 4, '#a8f8f0');
    // Cap rim: slightly darker teal ring.
    for (const [x, y] of [[5,7],[6,7],[7,7],[8,7],[9,7],[10,7],[11,7]]) {
      setPx(c, x, y, '#2aaa96', 1, 8, r);
    }
  },
};

// Ores: stone base + crystal clusters with a bright facet and dark outline.
const ORE_COLORS = {
  coal_ore: ['#2b2b2b', '#101010', '#4a4a4a'],
  iron_ore: ['#caa07e', '#8a6a4e', '#e8c8a8'],
  gold_ore: ['#e8d24a', '#a8921e', '#fff0a0'],
  redstone_ore: ['#d11616', '#7a0c0c', '#ff6a5a'],
  lapis_ore: ['#27479e', '#142a66', '#5a7ad8'],
  diamond_ore: ['#4fd3c8', '#23837c', '#b0fff4'],
  emerald_ore: ['#2fbf5e', '#157a36', '#8af0ae'],
};
for (const [name, [col, dark, lite]] of Object.entries(ORE_COLORS)) {
  DRAW[name] = (c, r) => {
    DRAW.stone(c, r);
    const clusters = 3 + ((r() * 2) | 0);
    for (let i = 0; i < clusters; i++) {
      const x = 2 + ((r() * 12) | 0), y = 2 + ((r() * 12) | 0);
      // Diamond-shaped crystal: dark outline, body, bright facet.
      setPx(c, x, y - 1, dark, 0.85); setPx(c, x, y + 1, dark, 0.85);
      setPx(c, x - 1, y, dark, 0.85); setPx(c, x + 1, y, dark, 0.85);
      setPx(c, x, y, col, 1, 14, r);
      setPx(c, x + (r() < 0.5 ? 0 : 1), y, lite, 0.95);
      if (r() < 0.6) setPx(c, x + 1, y + 1, col, 1, 18, r);
    }
  };
}

// Block name -> per-face tile names.
const t = (name) => ({ top: name, side: name, bottom: name });
const FACE_TILES = {
  grass: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' },
  dirt: t('dirt'), stone: t('stone'), sand: t('sand'), gravel: t('gravel'),
  snow: t('snow'), bedrock: t('bedrock'), andesite: t('andesite'),
  oak_log: { top: 'log_top', side: 'log_side', bottom: 'log_top' },
  oak_leaves: t('leaves'), cactus: t('cactus'), clay: t('clay'),
  water: t('water'), lava: t('lava'), oak_planks: t('planks'), glass: t('glass'),
  crafting_table: { top: 'crafting_top', side: 'crafting_side', bottom: 'planks' },
  furnace: { top: 'furnace_side', side: 'furnace_front', bottom: 'furnace_side' },
  torch: t('torch'),
  chest: { top: 'chest_top', side: 'chest_side', bottom: 'chest_top' },
  tall_grass: t('tall_grass'), poppy: t('poppy'), dandelion: t('dandelion'),
  // Doors: 'top' face = upper half tile (window), 'side' = lower half tile.
  door: { top: 'door_top', side: 'door_bottom', bottom: 'door_bottom' },
  door_open: { top: 'door_top', side: 'door_bottom', bottom: 'door_bottom' },
  oak_stairs_px: t('planks'), oak_stairs_nx: t('planks'),
  oak_stairs_pz: t('planks'), oak_stairs_nz: t('planks'),
  bed: { top: 'bed_top', side: 'bed_side', bottom: 'planks' },
  bed_head: { top: 'bed_top_head', side: 'bed_side', bottom: 'planks' },
  fence: t('planks'),
  tnt: { top: 'tnt_top', side: 'tnt_side', bottom: 'tnt_top' },
  mega_tnt: { top: 'mega_tnt_top', side: 'mega_tnt_side', bottom: 'mega_tnt_top' },
  nuke: { top: 'nuke_top', side: 'nuke_side', bottom: 'nuke_top' },
  wool: t('wool_block'),
  pumpkin: { top: 'pumpkin_top', side: 'pumpkin_side', bottom: 'pumpkin_top' },
  melon: { top: 'melon_side', side: 'melon_side', bottom: 'melon_side' },
  hay_bale: { top: 'hay_top', side: 'hay_side', bottom: 'hay_top' },
  sandstone: t('sandstone'),
  mossy_cobblestone: t('mossy_cobblestone'),
  oak_slab: t('planks'), stone_slab: t('stone'),
  ladder: t('ladder'), glass_pane: t('glass'),
  chess_table: { top: 'chess_top', side: 'crafting_side', bottom: 'planks' },
  // Cave flora: rendered as crossed quads (PLANTS set in ChunkMesher).
  glow_mushroom: t('glow_mushroom'),
};
for (const name of Object.keys(ORE_COLORS)) FACE_TILES[name] = t(name);

const CUTOUT = new Set(['leaves', 'glass', 'tall_grass', 'poppy', 'dandelion', 'door_top', 'ladder', 'glow_mushroom']);
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
  if (CUTOUT.has(name)) {
    opts.transparent = true; opts.alphaTest = 0.5; opts.side = THREE.DoubleSide;
    // Glow mushroom self-illuminates so it reads in dark caves even though its
    // vertex colours are darkened by the skylight pass.  The emissive colour
    // matches its cap (cyan-teal) to reinforce the bioluminescent feel.
    if (name === 'glow_mushroom') { opts.emissive = new THREE.Color('#20c8b0'); opts.emissiveIntensity = 0.85; }
  } else if (TRANSPARENT.has(name)) { opts.transparent = true; opts.opacity = 0.85; opts.depthWrite = false; opts.side = THREE.DoubleSide; }
  else if (name === 'torch') { opts.emissive = new THREE.Color('#ffaa33'); opts.emissiveIntensity = 0.9; } // self-glow
  else if (name === 'lava') { opts.emissive = new THREE.Color('#ff6a14'); opts.emissiveIntensity = 0.85; } // molten glow
  materials.push(new THREE.MeshLambertMaterial(opts));
});

// Per block id -> { top, side, bottom } material indices (+ name for lookups).
const faceMat = [];
const blockName = [];
for (const def of blockData) {
  blockName[def.id] = def.name;
  const ft = FACE_TILES[def.name];
  if (!ft) continue;
  faceMat[def.id] = {
    top: tileIndex[ft.top], side: tileIndex[ft.side], bottom: tileIndex[ft.bottom],
  };
}

export const BLOCK_MATERIALS = materials; // index = material index used in geometry groups
export const WATER_MATERIAL_INDEX = tileIndex.water;
export const LAVA_MATERIAL_INDEX = tileIndex.lava; // exported for optional texture animation later

export function faceMaterialIndex(blockId, face) {
  const m = faceMat[blockId];
  if (!m) return 0;
  return face === 'top' ? m.top : face === 'bottom' ? m.bottom : m.side;
}

// Average colour of a block's side tile (0..1 rgb) — used for break particles.
const avgCache = new Map();
export function blockAverageColor(blockId) {
  if (avgCache.has(blockId)) return avgCache.get(blockId);
  const name = blockName[blockId];
  const ft = FACE_TILES[name];
  let out = [0.6, 0.6, 0.6];
  if (ft) {
    const img = textures[tileIndex[ft.side]].image;
    const ctx = img.getContext('2d');
    const d = ctx.getImageData(0, 0, TILE, TILE).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < TILE * TILE; i++) {
      if (d[i * 4 + 3] < 100) continue;
      r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; n++;
    }
    if (n > 0) out = [r / n / 255, g / n / 255, b / n / 255];
  }
  avgCache.set(blockId, out);
  return out;
}

// Expose a tile's canvas (for UI icons and extruded item models).
export function tileCanvas(name) {
  const i = tileIndex[name];
  if (i == null) return null;
  return textures[i].image;
}

// Expose a tile's canvas as a data URL (for UI item icons).
export function tileDataURL(name) {
  const i = tileIndex[name];
  if (i == null) return null;
  return textures[i].image.toDataURL();
}
export { tileIndex, FACE_TILES };
