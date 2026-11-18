import blockData from './blocks.json';

// Central lookup for block definitions, indexed by numeric id for fast access
// during meshing. Also exposes name->id and per-face color arrays.
//
// This module is loaded by the chunk workers as well as the page, so it must
// stay free of three.js and the DOM (see core/chunkWorker.js).

const byId = [];
const byName = {};

// '#rrggbb' -> linear-light [r, g, b] in 0..1 (what THREE.Color would hold).
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function hexToRgb(hex) {
  if (!hex) return [1, 1, 1]; // blocks without a colour (they are textured) default to white
  const n = parseInt(hex.slice(1), 16);
  return [toLinear(((n >> 16) & 255) / 255), toLinear(((n >> 8) & 255) / 255), toLinear((n & 255) / 255)];
}

for (const def of blockData) {
  const top = hexToRgb(def.color);
  const side = def.sideColor ? hexToRgb(def.sideColor) : top;
  const bottom = def.bottomColor ? hexToRgb(def.bottomColor) : side;
  const entry = {
    ...def,
    solid: def.solid !== false,
    transparent: def.transparent === true,
    colors: { top, side, bottom },
  };
  byId[def.id] = entry;
  byName[def.name] = entry;
}

export const Blocks = Object.fromEntries(
  blockData.map((d) => [d.name.toUpperCase(), d.id])
);

export function getBlock(id) {
  return byId[id] || byId[0];
}

export function getBlockId(name) {
  return byName[name] ? byName[name].id : 0;
}

export function isSolid(id) {
  const b = byId[id];
  return b ? b.solid : false;
}

export function isTransparent(id) {
  const b = byId[id];
  return b ? b.transparent : true;
}

export function isOpaque(id) {
  const b = byId[id];
  return b ? b.solid && !b.transparent : false;
}

// 'water' | 'lava' for any liquid block (source or flowing), else null.
export function liquidKind(id) {
  const b = byId[id];
  return b && b.liquidType ? b.liquidType : null;
}

export function isLiquid(id) {
  const b = byId[id];
  return b ? b.liquid === true : false;
}
