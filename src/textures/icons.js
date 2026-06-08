import { getItem } from '../items/ItemRegistry.js';
import { FACE_TILES, tileDataURL } from './atlas.js';

// Item icons for the HUD/inventory. Block items reuse their block tile; other
// items get a small procedural icon by category. Cached as data URLs.
const cache = new Map();

function rgb(hex) {
  const n = parseInt((hex || '#cccccc').slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function newCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  return c;
}
const set = (ctx, x, y, hex, a = 1) => { ctx.fillStyle = hexA(hex, a); ctx.fillRect(x, y, 1, 1); };
const hexA = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };
const darker = (hex, f) => { const [r, g, b] = rgb(hex); return `rgb(${(r * f) | 0},${(g * f) | 0},${(b * f) | 0})`; };

function drawPickaxe(ctx, color) {
  // Brown handle, diagonal.
  for (let i = 0; i < 8; i++) set(ctx, 5 + i, 12 - i, '#6b4f2a');
  // Head across the top.
  ctx.fillStyle = color;
  ctx.fillRect(3, 3, 10, 2);
  ctx.fillRect(3, 3, 2, 3);
  ctx.fillRect(11, 3, 2, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(3, 3, 10, 1);
}

function drawSword(ctx, color) {
  for (let i = 0; i < 4; i++) { set(ctx, 11 - i, 11 - i, '#6b4f2a'); } // handle
  ctx.fillStyle = '#888'; ctx.fillRect(8, 9, 3, 3); // guard
  ctx.fillStyle = color; // blade
  for (let i = 0; i < 8; i++) ctx.fillRect(5 - i / 2 | 0, 8 - i, 2 + (i < 2 ? 0 : 1), 1);
  ctx.fillStyle = color; ctx.fillRect(3, 2, 3, 6);
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(3, 2, 1, 6);
}

function drawAxe(ctx, color) {
  for (let i = 0; i < 9; i++) set(ctx, 6 + i * 0.3 | 0, 13 - i, '#6b4f2a'); // handle
  ctx.fillStyle = color; // head
  ctx.fillRect(6, 2, 6, 6); ctx.fillRect(4, 3, 2, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(6, 2, 6, 1);
}

function drawShovel(ctx, color) {
  for (let i = 0; i < 7; i++) set(ctx, 11 - i, 11 - i, '#6b4f2a'); // handle
  ctx.fillStyle = color; // scoop
  ctx.fillRect(2, 2, 5, 6); ctx.fillRect(3, 8, 3, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(2, 2, 5, 1);
}

function drawBow(ctx) {
  ctx.strokeStyle = '#8a6a36'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(5, 8, 7, -1.0, 1.0); ctx.stroke(); // wooden arc
  ctx.strokeStyle = '#eeeeee'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(9, 2); ctx.lineTo(9, 14); ctx.stroke(); // string
}

function drawArrow(ctx) {
  ctx.strokeStyle = '#8a7a5a'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(3, 13); ctx.lineTo(12, 4); ctx.stroke(); // shaft
  ctx.fillStyle = '#d8d8d8'; ctx.fillRect(11, 2, 3, 3);                // head
  ctx.fillStyle = '#dddddd'; ctx.fillRect(2, 11, 3, 1); ctx.fillRect(2, 12, 1, 2); // fletching
}

function drawFood(ctx, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(8, 9, 5.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(5, 5, 2, 2);
}

function drawNugget(ctx, color) {
  ctx.fillStyle = darker(color, 0.6);
  ctx.fillRect(3, 4, 11, 9);
  ctx.fillStyle = color;
  ctx.fillRect(4, 5, 9, 7);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(5, 6, 4, 2);
}

function drawItem(def) {
  const c = newCanvas();
  const ctx = c.getContext('2d');
  const color = def?.color || '#cccccc';
  if (def?.name === 'bow') drawBow(ctx);
  else if (def?.name === 'arrow') drawArrow(ctx);
  else if (def?.toolType === 'sword') drawSword(ctx, color);
  else if (def?.toolType === 'axe') drawAxe(ctx, color);
  else if (def?.toolType === 'shovel') drawShovel(ctx, color);
  else if (def?.toolType) drawPickaxe(ctx, color);
  else if (def?.food) drawFood(ctx, color);
  else drawNugget(ctx, color);
  return c.toDataURL();
}

export function itemIconURL(name) {
  if (cache.has(name)) return cache.get(name);
  const def = getItem(name);
  let url = null;
  if (def && def.placeBlock && FACE_TILES[def.placeBlock]) {
    url = tileDataURL(FACE_TILES[def.placeBlock].side);
  } else {
    url = drawItem(def);
  }
  cache.set(name, url);
  return url;
}
