import { getItem } from '../items/ItemRegistry.js';
import { FACE_TILES, tileCanvas } from './atlas.js';

// Item icons for the HUD/inventory, drawn as 16x16 pixel art. Block items
// reuse their block tile; everything else gets a hand-shaped silhouette by
// name/category, finished with shared outline + bevel passes so the whole set
// reads consistently. The same canvases are extruded into the 3D held-item
// and dropped-item models (see items/ItemModels.js), so this art IS the model.

const S = 16;
const canvasCache = new Map(); // name -> canvas
const urlCache = new Map();    // name -> dataURL

function rgb(hex) {
  const n = parseInt((hex || '#cccccc').slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const hexOf = (r, g, b) =>
  `#${((1 << 24) | (Math.max(0, Math.min(255, r | 0)) << 16) | (Math.max(0, Math.min(255, g | 0)) << 8) | Math.max(0, Math.min(255, b | 0))).toString(16).slice(1)}`;
const shade = (hex, f) => { const [r, g, b] = rgb(hex); return hexOf(r * f, g * f, b * f); };
const lighten = (hex, t) => { const [r, g, b] = rgb(hex); return hexOf(r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t); };

function newCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  return c;
}
const px = (ctx, x, y, hex) => { ctx.fillStyle = hex; ctx.fillRect(x | 0, y | 0, 1, 1); };

const alphaAt = (data, x, y) =>
  x >= 0 && x < S && y >= 0 && y < S ? data[(y * S + x) * 4 + 3] : 0;

// Bevel: lighten pixels whose top/left neighbour is empty, darken those whose
// bottom/right neighbour is empty — instant chunky-pixel depth.
function bevelPass(ctx) {
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  const src = new Uint8ClampedArray(d); // read from a copy
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      if (src[i + 3] < 120) continue;
      const lit = alphaAt(src, x, y - 1) < 120 || alphaAt(src, x - 1, y) < 120;
      const dim = alphaAt(src, x, y + 1) < 120 || alphaAt(src, x + 1, y) < 120;
      if (lit && !dim) { d[i] = Math.min(255, src[i] * 1.28 + 18); d[i + 1] = Math.min(255, src[i + 1] * 1.28 + 18); d[i + 2] = Math.min(255, src[i + 2] * 1.28 + 18); }
      else if (dim && !lit) { d[i] = src[i] * 0.72; d[i + 1] = src[i + 1] * 0.72; d[i + 2] = src[i + 2] * 0.72; }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Outline: dark rim on every empty pixel that touches the silhouette.
function outlinePass(ctx, hex = '#241a10') {
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  const src = new Uint8ClampedArray(d);
  const [r, g, b] = rgb(hex);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      if (src[i + 3] >= 120) continue;
      if (alphaAt(src, x - 1, y) >= 120 || alphaAt(src, x + 1, y) >= 120 ||
          alphaAt(src, x, y - 1) >= 120 || alphaAt(src, x, y + 1) >= 120) {
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 230;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

const WOOD = '#7a5733', WOOD_D = '#5d4023';

// ---- Tools (handle runs ↗ bottom-left to top-right; head at the top) ----

function drawSword(ctx, color) {
  const edge = lighten(color, 0.5), dark = shade(color, 0.7);
  // Blade: 2px-wide diagonal from the guard to the tip.
  for (let i = 0; i < 9; i++) {
    px(ctx, 6 + i, 9 - i, dark);       // spine
    px(ctx, 7 + i, 9 - i, color);      // body
    px(ctx, 7 + i, 8 - i, edge);       // bright cutting edge
  }
  px(ctx, 15, 0, edge); // tip
  // Guard: short perpendicular bar.
  px(ctx, 4, 9, '#8a8f96'); px(ctx, 5, 10, '#8a8f96'); px(ctx, 6, 11, '#8a8f96');
  px(ctx, 5, 8, '#b9bec4'); px(ctx, 6, 9, '#b9bec4'); px(ctx, 7, 10, '#b9bec4');
  // Handle + pommel.
  px(ctx, 4, 11, WOOD); px(ctx, 3, 12, WOOD); px(ctx, 2, 13, WOOD_D);
  px(ctx, 1, 14, '#3c2c16'); px(ctx, 2, 14, '#3c2c16'); px(ctx, 1, 13, '#3c2c16');
}

function drawPickaxe(ctx, color) {
  const dark = shade(color, 0.72);
  // Handle.
  for (let i = 0; i < 9; i++) px(ctx, 4 + i, 13 - i, i > 6 ? WOOD_D : WOOD);
  // Curved head: a bar arcing across the top with prongs dipping down.
  const head = [
    [4, 5], [4, 6], [4, 7], [5, 4], [5, 5], [6, 3], [6, 4], [7, 3], [8, 2], [9, 2],
    [10, 2], [11, 3], [12, 3], [12, 4], [13, 5], [13, 6],
  ];
  for (const [x, y] of head) px(ctx, x, y, color);
  px(ctx, 4, 8, dark); px(ctx, 13, 7, dark); // prong tips
  px(ctx, 8, 3, dark); px(ctx, 9, 3, dark);  // underside of the arc
}

function drawAxe(ctx, color) {
  const edge = lighten(color, 0.45), dark = shade(color, 0.72);
  for (let i = 0; i < 10; i++) px(ctx, 3 + i, 14 - i, i > 7 ? WOOD_D : WOOD); // handle
  // Head: blade hanging left of the handle top.
  for (let y = 2; y <= 7; y++) {
    for (let x = 6; x <= 10; x++) {
      if (y === 2 && x < 8) continue;       // shoulder cut
      if (y === 7 && x < 7) continue;
      px(ctx, x, y, x >= 10 ? dark : color);
    }
  }
  for (let y = 3; y <= 6; y++) px(ctx, 5, y, edge); // cutting edge
  px(ctx, 6, 2, edge);
}

function drawShovel(ctx, color) {
  const edge = lighten(color, 0.4);
  for (let i = 0; i < 8; i++) px(ctx, 6 + i, 13 - i, i > 5 ? WOOD_D : WOOD); // handle
  // Scoop at the top-left.
  for (let y = 2; y <= 6; y++) {
    for (let x = 2; x <= 6; x++) {
      if ((x === 2 || x === 6) && y > 4) continue; // round the bottom
      if (x === 2 && y === 2) continue;            // round the corners
      if (x === 6 && y === 2) continue;
      px(ctx, x, y, color);
    }
  }
  px(ctx, 3, 7, color); px(ctx, 4, 7, color); px(ctx, 5, 7, color);
  px(ctx, 4, 8, color);
  px(ctx, 3, 2, edge); px(ctx, 4, 2, edge); px(ctx, 5, 2, edge); // top lip
}

function drawBow(ctx) {
  const wood = '#8a6a36', dark = '#6b4f24', grip = '#4a3018';
  // Upper and lower limbs: a recurve opening to the right.
  const limb = [
    [4, 1], [5, 1], [6, 2], [7, 3], [7, 4], [8, 5], [8, 6],
  ];
  for (const [x, y] of limb) { px(ctx, x, y, wood); px(ctx, x, 15 - y, wood); }
  px(ctx, 8, 7, grip); px(ctx, 8, 8, grip); // wrapped grip
  px(ctx, 3, 2, dark); px(ctx, 3, 13, dark); // nocks
  for (let y = 2; y <= 13; y++) px(ctx, 3, y, y <= 2 || y >= 13 ? dark : '#e8e8e8'); // string
}

// tip: optional head tint for special ammo (exploding / venom arrows).
function drawArrow(ctx, tip) {
  for (let i = 0; i < 8; i++) px(ctx, 4 + i, 11 - i, '#9a7d4e'); // shaft
  const head = tip || '#d8dde2';
  px(ctx, 13, 2, head); px(ctx, 12, 2, head); px(ctx, 13, 3, head); // head
  px(ctx, 14, 1, tip || '#eef2f6');
  px(ctx, 3, 12, '#e8e8e8'); px(ctx, 2, 13, '#e8e8e8'); px(ctx, 4, 13, '#cfcfcf'); // fletching
  px(ctx, 3, 14, '#cfcfcf'); px(ctx, 2, 12, '#cfcfcf');
}

// ---- Food & materials ----

function drawApple(ctx, color) {
  const body = color || '#d63a2e';
  const dark = shade(body, 0.78);
  for (let y = 5; y <= 12; y++) {
    for (let x = 4; x <= 11; x++) {
      const dx = x - 7.5, dy = y - 8.5;
      if (dx * dx / 16 + dy * dy / 13 > 1) continue;
      px(ctx, x, y, x > 8 ? dark : body);
    }
  }
  px(ctx, 7, 4, body); px(ctx, 8, 4, dark);      // shoulders
  px(ctx, 8, 3, '#5d4023'); px(ctx, 8, 2, '#5d4023'); // stem
  px(ctx, 9, 2, '#4f8a30'); px(ctx, 10, 2, '#6aa83e'); // leaf
  px(ctx, 5, 6, lighten(body, 0.55)); px(ctx, 6, 6, lighten(body, 0.4)); px(ctx, 5, 7, lighten(body, 0.35)); // shine
}

function drawMeat(ctx, color) {
  const body = color, fat = lighten(color, 0.55), dark = shade(color, 0.75);
  // Chop: rounded slab with a fat cap along the top edge.
  for (let y = 4; y <= 12; y++) {
    for (let x = 3; x <= 12; x++) {
      const dx = x - 7.5, dy = y - 8;
      if (dx * dx / 24 + dy * dy / 18 > 1) continue;
      px(ctx, x, y, y > 9 ? dark : body);
    }
  }
  for (let x = 4; x <= 11; x++) { const dy = Math.abs(x - 7.5) > 2.5 ? 5 : 4; px(ctx, x, dy, fat); }
  px(ctx, 6, 8, dark); px(ctx, 7, 8, dark); // marbling
}

function drawDrumstick(ctx, color) {
  const body = color, dark = shade(color, 0.75);
  // Meaty end at the top-left.
  for (let y = 3; y <= 9; y++) {
    for (let x = 3; x <= 9; x++) {
      const dx = x - 6, dy = y - 6;
      if (dx * dx + dy * dy > 11) continue;
      px(ctx, x, y, dx > 1 ? dark : body);
    }
  }
  px(ctx, 9, 9, '#e8e2d4'); px(ctx, 10, 10, '#e8e2d4'); px(ctx, 11, 11, '#e8e2d4'); // bone
  px(ctx, 12, 12, '#f4f0e6'); px(ctx, 13, 11, '#f4f0e6'); // knob
  px(ctx, 11, 13, '#f4f0e6'); px(ctx, 12, 13, '#ffffff');
}

function drawFeather(ctx) {
  // Quill spine with barbs sweeping up-right.
  for (let i = 0; i < 10; i++) px(ctx, 3 + i, 13 - i, i < 3 ? '#caa86a' : '#e8ecf2');
  for (let i = 2; i < 9; i++) {
    px(ctx, 3 + i, 12 - i, '#f4f7fb');
    px(ctx, 4 + i, 13 - i + 1, '#cdd4dd');
    if (i > 3) px(ctx, 2 + i, 12 - i, '#dfe5ec');
  }
  px(ctx, 13, 2, '#ffffff');
}

function drawBone(ctx) {
  const b = '#ece8da', d = '#c9c4b2';
  for (let i = 0; i < 7; i++) px(ctx, 5 + i, 10 - i, i % 2 ? b : '#f6f3e9'); // shaft
  // Knobs at both ends.
  px(ctx, 3, 11, b); px(ctx, 4, 11, b); px(ctx, 3, 12, b); px(ctx, 4, 12, d);
  px(ctx, 4, 10, b); px(ctx, 5, 12, d); px(ctx, 3, 10, '#f6f3e9');
  px(ctx, 12, 3, b); px(ctx, 13, 3, '#f6f3e9'); px(ctx, 12, 4, d); px(ctx, 13, 4, b);
  px(ctx, 11, 3, b); px(ctx, 13, 2, '#f6f3e9'); px(ctx, 12, 2, b); px(ctx, 11, 5, d);
}

function drawIngot(ctx, color) {
  const top = lighten(color, 0.45), side = shade(color, 0.7);
  // Classic trapezoid bar.
  for (let y = 6; y <= 10; y++) {
    const inset = 10 - y; // wider at the bottom
    for (let x = 2 + inset; x <= 13 - Math.floor(inset / 2); x++) px(ctx, x, y, color);
  }
  for (let x = 6; x <= 13; x++) px(ctx, x, 6, top);     // lit top face
  for (let x = 2; x <= 12; x++) px(ctx, x, 10, side);   // base shadow
  px(ctx, 7, 7, top); px(ctx, 8, 7, top);               // glint
}

function drawGem(ctx, color) {
  const lite = lighten(color, 0.55), dark = shade(color, 0.7);
  for (let y = 4; y <= 12; y++) {
    for (let x = 4; x <= 12; x++) {
      const d = Math.abs(x - 8) + Math.abs(y - 8);
      if (d > 4) continue;
      px(ctx, x, y, d <= 1 ? lite : x + y < 16 ? color : dark);
    }
  }
  px(ctx, 7, 6, '#ffffff'); // sparkle
}

function drawLump(ctx, color) {
  const dark = shade(color, 0.7), lite = lighten(color, 0.25);
  const blobs = [[6, 7, 2.6], [9, 9, 2.2], [8, 6, 1.8]];
  for (const [cx, cy, r] of blobs) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        px(ctx, x, y, x < cx ? color : dark);
      }
    }
  }
  px(ctx, 5, 6, lite); px(ctx, 6, 5, lite);
}

function drawString(ctx) {
  const s = '#e8e4da', d = '#c4beae';
  // Loose coil with a trailing end.
  const ring = [[6, 4], [7, 3], [8, 3], [9, 4], [10, 5], [10, 6], [10, 7], [9, 8], [8, 9], [7, 9], [6, 8], [5, 7], [5, 6], [5, 5]];
  for (const [x, y] of ring) px(ctx, x, y, s);
  px(ctx, 7, 6, d); px(ctx, 8, 6, d);
  px(ctx, 8, 10, s); px(ctx, 9, 11, d); px(ctx, 10, 12, s); px(ctx, 11, 13, d);
}

function drawWool(ctx, color) {
  const body = color || '#eeeeee', dark = shade(body, 0.82);
  for (let y = 4; y <= 12; y++) {
    for (let x = 3; x <= 12; x++) {
      // Scalloped fluffy edges.
      const e = (x === 3 || x === 12 || y === 4 || y === 12) && (x + y) % 2 === 0;
      if (e) continue;
      px(ctx, x, y, (x + y) % 3 === 0 ? dark : body);
    }
  }
}

function drawLeather(ctx, color) {
  const body = color || '#a3683c', dark = shade(body, 0.75);
  // A hide: rounded square with notched corners.
  for (let y = 4; y <= 12; y++) {
    for (let x = 3; x <= 12; x++) {
      if ((x <= 4 && y <= 5) || (x >= 11 && y <= 5)) continue; // shoulder notches
      if ((x <= 3 && y >= 11) || (x >= 12 && y >= 11)) continue;
      px(ctx, x, y, y > 9 ? dark : body);
    }
  }
  px(ctx, 6, 7, dark); px(ctx, 9, 8, dark); // creases
}

function drawStick(ctx) {
  for (let i = 0; i < 9; i++) {
    px(ctx, 4 + i, 12 - i, WOOD);
    if (i % 3 === 1) px(ctx, 5 + i, 12 - i, WOOD_D);
  }
}

function drawDoor(ctx) {
  // Tall panel with inset panes, a window, and a handle.
  ctx.fillStyle = '#9c7a44'; ctx.fillRect(4, 1, 8, 14);
  ctx.fillStyle = '#7a5e33'; ctx.fillRect(5, 8, 6, 3);
  ctx.fillStyle = '#7a5e33'; ctx.fillRect(5, 12, 6, 2);
  ctx.fillStyle = '#bfe6ee'; ctx.fillRect(6, 2, 4, 3); // window
  ctx.fillStyle = '#5d4023'; ctx.fillRect(7, 2, 1, 3); ctx.fillRect(6, 3, 4, 1);
  px(ctx, 11, 8, '#3a2a14'); px(ctx, 11, 9, '#d8b878'); // handle
}

function drawStairs(ctx) {
  // Three-step profile in plank tones.
  const body = '#b3884f', top = lighten(body, 0.35), side = shade(body, 0.72);
  const steps = [[2, 10, 12, 4], [6, 6, 8, 4], [10, 2, 4, 4]]; // x, y, w, h
  for (const [x, y, w, h] of steps) {
    ctx.fillStyle = body; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = top; ctx.fillRect(x, y, w, 1);
    ctx.fillStyle = side; ctx.fillRect(x, y + h - 1, w, 1);
  }
}

function drawBed(ctx) {
  // Side view: red blanket, white pillow, wooden frame + legs.
  ctx.fillStyle = '#7a5733'; ctx.fillRect(2, 9, 12, 3);  // frame
  ctx.fillStyle = '#5d4023'; ctx.fillRect(2, 12, 2, 2); ctx.fillRect(12, 12, 2, 2); // legs
  ctx.fillStyle = '#b03028'; ctx.fillRect(2, 6, 12, 3);  // blanket
  ctx.fillStyle = '#8a201a'; ctx.fillRect(2, 8, 12, 1);
  ctx.fillStyle = '#eef1f5'; ctx.fillRect(2, 5, 4, 3);   // pillow
}

function drawFence(ctx) {
  // Two posts with two rails.
  ctx.fillStyle = '#7a5733';
  ctx.fillRect(3, 3, 2, 11); ctx.fillRect(11, 3, 2, 11); // posts
  ctx.fillStyle = '#b3884f';
  ctx.fillRect(1, 5, 14, 2); ctx.fillRect(1, 10, 14, 2); // rails
  ctx.fillStyle = '#5d4023';
  ctx.fillRect(3, 13, 2, 1); ctx.fillRect(11, 13, 2, 1); // post feet
}

function drawChessTable(ctx) {
  // A tilted tabletop with the board inlay.
  ctx.fillStyle = '#7a5733'; ctx.fillRect(1, 3, 14, 10);
  for (let by = 0; by < 4; by++) {
    for (let bx = 0; bx < 5; bx++) {
      ctx.fillStyle = (bx + by) % 2 === 0 ? '#e8d8b8' : '#5a4028';
      ctx.fillRect(3 + bx * 2, 4 + by * 2, 2, 2);
    }
  }
  ctx.fillStyle = '#5d4023'; ctx.fillRect(2, 13, 2, 2); ctx.fillRect(12, 13, 2, 2); // legs
}

function drawNugget(ctx, color) {
  const dark = shade(color, 0.65);
  for (let y = 5; y <= 11; y++) for (let x = 4; x <= 11; x++) px(ctx, x, y, y > 8 ? dark : color);
  px(ctx, 5, 6, lighten(color, 0.4)); px(ctx, 6, 6, lighten(color, 0.3));
}

// Vinyl music disc: dark platter, groove ring, coloured label at the centre.
function drawDisc(ctx, color) {
  for (let y = 2; y <= 13; y++) {
    for (let x = 2; x <= 13; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 6) continue;
      px(ctx, x, y, d > 5.2 ? '#101014' : '#1c1c22'); // rim slightly darker
    }
  }
  px(ctx, 5, 4, '#3a3a44'); px(ctx, 4, 5, '#3a3a44'); px(ctx, 6, 3, '#3a3a44'); // shine
  for (let y = 6; y <= 9; y++) for (let x = 6; x <= 9; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d <= 2) px(ctx, x, y, d > 1.2 ? color : shade(color, 0.7)); // label + spindle
  }
}

// Tapered tin pail with a handle arc; fillHex tops it up with liquid.
function drawBucket(ctx, fillHex) {
  const tin = '#b8bcc4', dark = shade(tin, 0.68), lite = lighten(tin, 0.3);
  for (let y = 6; y <= 13; y++) {
    const inset = y >= 10 ? 1 : 0; // body tapers toward the base
    for (let x = 3 + inset; x <= 12 - inset; x++) {
      px(ctx, x, y, x <= 4 + inset ? lite : x >= 11 - inset ? dark : tin);
    }
  }
  for (let x = 3; x <= 12; x++) px(ctx, x, 5, lite); // rim
  // Handle arc over the top.
  px(ctx, 3, 4, dark); px(ctx, 4, 3, dark); px(ctx, 5, 2, dark);
  for (let x = 6; x <= 9; x++) px(ctx, x, 2, dark);
  px(ctx, 10, 2, dark); px(ctx, 11, 3, dark); px(ctx, 12, 4, dark);
  if (fillHex) {
    for (let x = 4; x <= 11; x++) px(ctx, x, 6, fillHex);
    for (let x = 5; x <= 10; x++) px(ctx, x, 7, shade(fillHex, 0.85));
  }
}

const MEATS = new Set(['raw_porkchop', 'cooked_porkchop', 'raw_beef', 'cooked_beef', 'raw_mutton', 'cooked_mutton', 'rotten_flesh']);
const GEMS = new Set(['diamond', 'emerald', 'lapis', 'redstone']);
const LUMPS = new Set(['coal', 'charcoal', 'raw_iron', 'raw_gold', 'clay_ball', 'gunpowder']);

function drawItem(def) {
  const c = newCanvas();
  const ctx = c.getContext('2d');
  const color = def?.color || '#cccccc';
  const name = def?.name || '';

  if (name === 'bow') drawBow(ctx);
  else if (name === 'door') drawDoor(ctx);
  else if (name === 'oak_stairs') drawStairs(ctx);
  else if (name === 'bed') drawBed(ctx);
  else if (name === 'fence') drawFence(ctx);
  else if (name === 'chess_table') drawChessTable(ctx);
  else if (name === 'arrow') drawArrow(ctx);
  else if (name === 'arrow_explosive') drawArrow(ctx, '#ff5a2a');
  else if (name === 'arrow_venom') drawArrow(ctx, '#5ac83a');
  else if (name === 'stick') drawStick(ctx);
  else if (name === 'apple') drawApple(ctx, color);
  else if (name === 'raw_chicken' || name === 'cooked_chicken') drawDrumstick(ctx, color);
  else if (MEATS.has(name)) drawMeat(ctx, color);
  else if (name === 'feather') drawFeather(ctx);
  else if (name === 'bone') drawBone(ctx);
  else if (name === 'string') drawString(ctx);
  else if (name.startsWith('music_disc')) drawDisc(ctx, color);
  else if (name === 'bucket') drawBucket(ctx, null);
  else if (name === 'water_bucket') drawBucket(ctx, '#3a6dd1');
  else if (name === 'lava_bucket') drawBucket(ctx, '#ff7a1e');
  else if (name === 'wool') drawWool(ctx, color);
  else if (name === 'leather') drawLeather(ctx, color);
  else if (name.endsWith('_ingot')) drawIngot(ctx, color);
  else if (GEMS.has(name)) drawGem(ctx, color);
  else if (LUMPS.has(name)) drawLump(ctx, color);
  else if (def?.toolType === 'sword') drawSword(ctx, color);
  else if (def?.toolType === 'axe') drawAxe(ctx, color);
  else if (def?.toolType === 'shovel') drawShovel(ctx, color);
  else if (def?.toolType) drawPickaxe(ctx, color);
  else if (def?.food) drawApple(ctx, color);
  else drawNugget(ctx, color);

  bevelPass(ctx);
  outlinePass(ctx);
  return c;
}

// Block items that look better with a hand-drawn icon than their block tile.
const CUSTOM_BLOCK_ICONS = new Set(['door', 'oak_stairs', 'bed', 'fence', 'chess_table']);

// The icon as a canvas — also the source the 3D item models are extruded from.
export function itemIconCanvas(name) {
  if (canvasCache.has(name)) return canvasCache.get(name);
  const def = getItem(name);
  let canvas;
  if (def && def.placeBlock && FACE_TILES[def.placeBlock] && !CUSTOM_BLOCK_ICONS.has(name)) {
    canvas = tileCanvas(FACE_TILES[def.placeBlock].side);
  } else {
    canvas = drawItem(def);
  }
  canvasCache.set(name, canvas);
  return canvas;
}

export function itemIconURL(name) {
  if (urlCache.has(name)) return urlCache.get(name);
  const url = itemIconCanvas(name).toDataURL();
  urlCache.set(name, url);
  return url;
}
