import blockData from './blocks.json';
import * as THREE from 'three';

// Central lookup for block definitions, indexed by numeric id for fast access
// during meshing. Also exposes name->id and per-face color arrays.

const byId = [];
const byName = {};

function hexToRgb(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
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
