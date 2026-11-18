import { skinSheet } from './MobModels.js';
import { eyes, band, cuff } from './mobSkins.js';

// The characters a player can be. Each is a box-part figure (the same build
// as the mobs — see MobModels) plus a painter that draws its clothes, face and
// hair onto the generated skin sheet at 16 pixels per block; hats, beards and
// long hair are extra parts.
//
// A player picks one in the menu (ui/Menus.jsx); it is remembered in
// localStorage, and in multiplayer its number rides in the player's state
// messages (Game._loop -> RemotePlayers.setState). A player who sends none —
// a Prop Hunt bot, someone on an older build — gets a skin from their name,
// so they still look the same to everyone.

const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0');
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
};

const WHITE = '#f4f4f2';
const INK = '#1c1c1e';

// A 32-pixel-tall figure (2 blocks); PlayerAvatar scales it to the player's
// 1.8. The first arm must be the -x (right) arm, and the head must come
// before any other `head` part (the head mesh pivots on the first of them).
function body({ legs, torso, arms, head }) {
  return [
    { id: 'legR', size: [0.25, 0.75, 0.25], pos: [-0.125, 0.375, 0], color: legs, leg: true },
    { id: 'legL', size: [0.25, 0.75, 0.25], pos: [0.125, 0.375, 0], color: legs, leg: true },
    { id: 'torso', size: [0.5, 0.75, 0.25], pos: [0, 1.125, 0], color: torso },
    { id: 'armR', size: [0.25, 0.75, 0.25], pos: [-0.375, 1.125, 0], color: arms, arm: true },
    { id: 'armL', size: [0.25, 0.75, 0.25], pos: [0.375, 1.125, 0], color: arms, arm: true },
    { id: 'head', size: [0.5, 0.5, 0.5], pos: [0, 1.75, 0], color: head, head: true },
  ];
}

// Long hair: a slab down the back from the nape to the shoulder blades,
// flush with the back of the head. Part of the body, so it stays on the
// shoulders when the head tilts.
const longHair = (color) => ({ id: 'hairLong', size: [0.5, 0.3125, 0.125], pos: [0, 1.34375, -0.1875], color });

// A Santa hat: fur band round the brow, a cap, a tip that flops to one side,
// and a bobble.
const santaHat = (red) => [
  { id: 'hatBand', size: [0.5625, 0.1875, 0.5625], pos: [0, 1.96875, 0], color: WHITE, head: true },
  { id: 'hatCap', size: [0.4375, 0.25, 0.4375], pos: [0, 2.1875, 0], color: red, head: true },
  { id: 'hatTip', size: [0.25, 0.1875, 0.25], pos: [0.0625, 2.40625, -0.0625], color: red, head: true },
  { id: 'hatBall', size: [0.1875, 0.1875, 0.1875], pos: [0.25, 2.34375, -0.15625], color: WHITE, head: true },
];

// --- Painting helpers (the head is 8x8 px a face, the torso 8x12, limbs 4x12) ---

// Hair: the crown, `fringe` rows across the brow, `locks` more down each side
// of the face, `sides` rows on the flanks and `back` rows behind.
function hair(p, { hair: c, fringe = 1, locks = 0, sides = 3, back = 4 }) {
  const dark = shade(c, 0.8);
  const top = p.face('head', 'top');
  top.rect(0, 0, top.w, top.h, c).speckle(10, dark);
  const f = p.face('head', 'front');
  f.rect(0, 0, f.w, fringe, c);
  if (locks) f.rect(0, fringe, 1, locks, c).rect(f.w - 1, fringe, 1, locks, c);
  p.sides('head', (s) => s.rect(0, 0, s.w, sides, c).speckle(4, dark));
  const b = p.face('head', 'back');
  b.rect(0, 0, b.w, back, c).speckle(6, dark);
}

function face(p, { tone, eyes: eye, brows = null, lips = null, blush = null, nose = null }) {
  const f = p.face('head', 'front');
  eyes(f, 4, 2, eye, { white: '#ffffff' });
  if (brows) f.rect(1, 3, 2, 1, brows).rect(5, 3, 2, 1, brows);
  f.rect(3, 5, 2, 1, nose || shade(tone, 0.9));
  f.rect(3, 6, 2, 1, lips || shade(tone, 0.68));
  if (blush) f.px(1, 5, blush).px(6, 5, blush);
}

// Shoes or boots: the bottom `rows` of both legs, with an optional one-row
// top (a sock, a fur trim) above them.
function shoes(p, rows, color, trim = null) {
  for (const id of ['legR', 'legL']) {
    band(p, id, 0, rows, color);
    if (trim) band(p, id, rows, 1, trim);
    p.face(id, 'bottom').rect(0, 0, 4, 4, shade(color, 0.7));
  }
}

// Hands (or gloves, mittens): the bottom `rows` of both arms and their
// undersides, with an optional cuff `cuffRows` tall above them.
function hands(p, rows, color, cuffColor = null, cuffRows = 2) {
  for (const id of ['armR', 'armL']) {
    band(p, id, 0, rows, color);
    if (cuffColor) band(p, id, rows, cuffRows, cuffColor);
    p.face(id, 'bottom').rect(0, 0, 4, 4, color);
  }
}

// Sleeves `rows` long from the shoulder, in `color`, on arms whose base coat
// is the skin tone.
function sleeves(p, rows, color) {
  for (const id of ['armR', 'armL']) {
    cuff(p, id, rows, color);
    p.face(id, 'top').rect(0, 0, 4, 4, color);
  }
}

// --- The skins -----------------------------------------------------------------
// Each: `name` for the menu; `parts`; `paint(p)`; and `hand` — what the bare
// first-person arm looks like (PlayerAvatar.appearance, read by HeldItem).

const man = (() => {
  const tone = '#e0ac7e', hairC = '#4a2f1c', shirt = '#2e6fbe', jeans = '#34405e';
  return {
    name: 'Man',
    parts: body({ legs: jeans, torso: shirt, arms: tone, head: tone }),
    hand: { skin: tone, shirt, sleeves: 0 },
    paint(p) {
      hair(p, { hair: hairC, fringe: 1, sides: 3, back: 4 });
      face(p, { tone, eyes: '#3a2a1a', brows: shade(hairC, 0.8) });
      // T-shirt: open collar, a hem, short sleeves.
      p.face('torso', 'front').px(3, 0, tone).px(4, 0, tone);
      p.around('torso', (f) => f.rect(0, f.h - 1, f.w, 1, shade(shirt, 0.72)));
      sleeves(p, 4, shirt);
      // Jeans with a belt line, and dark shoes.
      for (const id of ['legR', 'legL']) cuff(p, id, 1, shade(jeans, 0.7));
      shoes(p, 2, '#2a2420');
    },
  };
})();

const woman = (() => {
  const tone = '#f1c9a5', hairC = '#8a4a26', top = '#c0497a', jeans = '#3a4668';
  return {
    name: 'Woman',
    parts: [...body({ legs: jeans, torso: top, arms: tone, head: tone }), longHair(hairC)],
    hand: { skin: tone, shirt: top, sleeves: 0 },
    paint(p) {
      hair(p, { hair: hairC, fringe: 2, locks: 5, sides: 8, back: 8 });
      p.face('hairLong', 'back').speckle(8, shade(hairC, 0.8));
      face(p, { tone, eyes: '#3f7a44', brows: shade(hairC, 0.95), lips: '#c2566a', blush: '#f0a898' });
      // A V-necked top, short sleeves, a lighter band at the waist.
      const chest = p.face('torso', 'front');
      chest.rect(2, 0, 4, 1, tone).rect(3, 1, 2, 1, tone);
      p.around('torso', (f) => f.rect(0, 8, f.w, 1, shade(top, 1.25)).rect(0, f.h - 1, f.w, 1, shade(top, 0.75)));
      sleeves(p, 3, top);
      for (const id of ['legR', 'legL']) cuff(p, id, 1, shade(jeans, 0.7));
      shoes(p, 2, '#e9e6e0', '#c9c5bd');
    },
  };
})();

// What Santa and Ms. Santa share: red with white fur, a black belt, a buckle.
const RED = '#c62828';
function santaCoat(p, hem = true) {
  p.around('torso', (f) => {
    f.rect(0, 0, f.w, 1, WHITE);                     // fur collar
    f.rect(0, 8, f.w, 2, INK);                       // belt
    if (hem) f.rect(0, f.h - 1, f.w, 1, WHITE);      // fur hem
  });
  // Fur placket down the front, and a buckle on the belt.
  const chest = p.face('torso', 'front');
  chest.rect(3, 1, 2, 7, WHITE).rect(3, 8, 2, 2, '#e3b23c');
  if (hem) chest.rect(3, 10, 2, 1, WHITE);
  for (const id of ['hatBand', 'hatBall']) p.around(id, (f) => f.speckle(6, '#dcdcd6'));
}

const santa = (() => {
  const tone = '#f0c0a2';
  return {
    name: 'Santa',
    parts: [
      ...body({ legs: RED, torso: RED, arms: RED, head: tone }),
      ...santaHat(RED),
      // The beard hangs a few pixels below the chin, proud of the face.
      { id: 'beard', size: [0.375, 0.25, 0.0625], pos: [0, 1.5, 0.28125], color: WHITE, head: true },
    ],
    hand: { skin: INK, shirt: RED, sleeves: 1 },
    paint(p) {
      hair(p, { hair: WHITE, fringe: 0, sides: 8, back: 8 });
      face(p, { tone, eyes: '#35557e', brows: WHITE, nose: '#e39c8c', blush: '#ee9d92', lips: '#a8474a' });
      // Moustache and beard across the lower face and round to the ears.
      const f = p.face('head', 'front');
      f.rect(0, 5, 3, 1, WHITE).rect(5, 5, 3, 1, WHITE).rect(0, 6, 3, 2, WHITE).rect(5, 6, 3, 2, WHITE).rect(3, 7, 2, 1, WHITE);
      p.sides('head', (s) => { for (let i = 0; i < 3; i++) s.rect(s.fromFront(i), 5, 1, 3, WHITE); });
      // The beard part covers the mouth, so it carries one of its own.
      p.face('beard', 'front').speckle(5, '#dcdcd6').rect(2, 0, 2, 1, '#a8474a');
      santaCoat(p);
      // Fur cuffs over black mittens; black boots with fur tops.
      hands(p, 2, INK, WHITE);
      shoes(p, 4, INK, WHITE);
    },
  };
})();

const msSanta = (() => {
  const tone = '#f1c9a5', hairC = '#6a3a1e';
  return {
    name: 'Ms. Santa',
    parts: [...body({ legs: WHITE, torso: RED, arms: RED, head: tone }), longHair(hairC), ...santaHat(RED)],
    hand: { skin: tone, shirt: RED, sleeves: 1 },
    paint(p) {
      hair(p, { hair: hairC, fringe: 0, locks: 6, sides: 8, back: 8 });
      p.face('hairLong', 'back').speckle(8, shade(hairC, 0.8));
      face(p, { tone, eyes: '#4a6a3a', brows: shade(hairC, 0.95), lips: '#c2303f', blush: '#f0a090' });
      santaCoat(p, false);
      // The dress runs on down the legs to a fur hem; white stockings, black boots.
      for (const id of ['legR', 'legL']) { cuff(p, id, 5, RED); band(p, id, 6, 1, WHITE); }
      shoes(p, 3, INK);
      // Fur cuffs, bare hands.
      hands(p, 2, tone, WHITE);
    },
  };
})();

const nurse = (() => {
  const tone = '#e8b890', hairC = '#3a2418', white = '#f3f6f8', blue = '#8fc0e4', cross = '#d62b2b';
  return {
    name: 'Nurse',
    parts: [
      ...body({ legs: tone, torso: white, arms: tone, head: tone }),
      { id: 'bun', size: [0.25, 0.25, 0.1875], pos: [0, 1.8125, -0.34375], color: hairC, head: true },
      { id: 'cap', size: [0.4375, 0.1875, 0.25], pos: [0, 2.09375, 0.125], color: white, head: true },
    ],
    hand: { skin: tone, shirt: white, sleeves: 0 },
    paint(p) {
      hair(p, { hair: hairC, fringe: 1, sides: 4, back: 6 });
      face(p, { tone, eyes: '#4a3424', brows: shade(hairC, 1.1), lips: '#c05a66', blush: '#eea596' });
      // A red cross on the cap, and a blue band round it.
      p.around('cap', (f) => f.rect(0, f.h - 1, f.w, 1, blue));
      p.face('cap', 'front').rect(3, 0, 1, 3, cross).rect(2, 1, 3, 1, cross);
      // The uniform: collar, buttons, a cross on the chest, a blue belt.
      const chest = p.face('torso', 'front');
      chest.rect(3, 0, 2, 1, tone).px(2, 0, blue).px(5, 0, blue);
      chest.px(3, 3, '#b8c4ce').px(3, 5, '#b8c4ce').px(3, 10, '#b8c4ce');
      chest.rect(5, 2, 1, 3, cross).rect(4, 3, 3, 1, cross);
      p.around('torso', (f) => f.rect(0, 8, f.w, 1, blue));
      sleeves(p, 4, white);
      for (const id of ['armR', 'armL']) p.around(id, (f) => f.rect(0, 3, f.w, 1, blue));
      // The dress to mid-thigh with a hem line; white socks and shoes.
      for (const id of ['legR', 'legL']) { cuff(p, id, 5, white); band(p, id, 6, 1, '#c5d0da'); }
      shoes(p, 2, '#ffffff', '#e6ebef');
    },
  };
})();

const engineer = (() => {
  const tone = '#c68e63', hairC = '#2b1d14', shirt = '#3d5a80', vest = '#f07a1a', tape = '#e6ee52';
  const jeans = '#2f3a55', hat = '#f2c21a';
  return {
    name: 'Engineer',
    parts: [
      ...body({ legs: jeans, torso: vest, arms: shirt, head: tone }),
      // Hard hat: a shell over the crown, a ridge along the top, a peak in front.
      { id: 'hatShell', size: [0.5625, 0.1875, 0.5625], pos: [0, 2.03125, 0], color: hat, head: true },
      { id: 'hatRidge', size: [0.125, 0.0625, 0.4375], pos: [0, 2.15625, 0], color: shade(hat, 1.12), head: true },
      { id: 'hatPeak', size: [0.5625, 0.0625, 0.1875], pos: [0, 1.96875, 0.375], color: hat, head: true },
    ],
    hand: { skin: '#b98a4c', shirt, sleeves: 1 },
    paint(p) {
      hair(p, { hair: hairC, fringe: 0, sides: 3, back: 4 });
      face(p, { tone, eyes: '#2f2218', brows: hairC });
      // Stubble.
      const f = p.face('head', 'front');
      f.rect(1, 6, 2, 1, shade(tone, 0.8)).rect(5, 6, 2, 1, shade(tone, 0.8)).rect(1, 7, 6, 1, shade(tone, 0.78));
      p.face('hatShell', 'front').rect(3, 1, 3, 1, '#fff6c8'); // a badge
      // A hi-vis vest, open over a work shirt: reflective braces and a band
      // round the middle, a tool belt under it.
      const chest = p.face('torso', 'front');
      p.around('torso', (t) => {
        t.rect(0, 6, t.w, 2, tape);
        t.rect(0, t.h - 2, t.w, 2, '#5a3a1c');
      });
      for (const side of ['front', 'back']) p.face('torso', side).rect(1, 0, 1, 6, tape).rect(6, 0, 1, 6, tape);
      chest.rect(3, 0, 2, 10, shirt).px(3, 0, tone).px(4, 0, tone).px(4, 3, '#c9d3df').px(4, 5, '#c9d3df');
      chest.rect(3, 10, 2, 1, '#d0a03a');                       // buckle
      p.face('torso', 'left').rect(1, 9, 2, 2, '#8a8f98');      // something on the belt
      // Work gloves; boots with dark soles.
      hands(p, 2, '#b98a4c');
      for (const id of ['legR', 'legL']) cuff(p, id, 1, shade(jeans, 0.7));
      shoes(p, 3, '#6a4424');
      for (const id of ['legR', 'legL']) band(p, id, 0, 1, '#2a1c10');
    },
  };
})();

const SKINS = { man, woman, santa, ms_santa: msSanta, nurse, engineer };

export const DEFAULT_SKIN = 'man';
// In menu order.
export const SKIN_LIST = Object.keys(SKINS).map((id) => ({ id, name: SKINS[id].name }));

// A skin by id: { id, name, def: { parts }, paint, key, hand }. An unknown id
// gives the default.
export function getSkin(id) {
  const known = Object.prototype.hasOwnProperty.call(SKINS, id) ? id : DEFAULT_SKIN;
  const s = SKINS[known];
  return { id: known, name: s.name, def: { parts: s.parts }, paint: s.paint, key: `player:${known}`, hand: s.hand };
}
export const isSkin = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(SKINS, id);

// A skin's number on the wire (1-based; 0 = none sent). It is its place in
// SKINS, so ONLY EVER ADD SKINS AT THE END: a player on an older build would
// otherwise see everyone in the wrong clothes.
export const skinNumber = (id) => SKIN_LIST.findIndex((s) => s.id === id) + 1;
export const skinFromNumber = (n) => SKIN_LIST[(n | 0) - 1]?.id || null;

// The skin for someone who has not chosen one: always the same for a name.
export function skinForName(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return SKIN_LIST[(h >>> 0) % SKIN_LIST.length].id;
}

// The local player's choice.
const SKIN_KEY = 'apex_skin';
export function loadSkin() {
  try {
    const v = localStorage.getItem(SKIN_KEY);
    if (isSkin(v)) return v;
  } catch (_) { /* private mode */ }
  return DEFAULT_SKIN;
}
export function saveSkin(id) {
  try { localStorage.setItem(SKIN_KEY, getSkin(id).id); } catch (_) { /* private mode */ }
}

// A front view of a skin, one canvas pixel per texel, for the menu: each
// part's front face cut from the skin sheet and laid where the part stands,
// back parts first.
const portraits = new Map();
export function skinPortrait(id) {
  const skin = getSkin(id);
  let c = portraits.get(skin.id);
  if (c) return c;
  const parts = skin.def.parts;
  const { canvas, rects } = skinSheet(skin.def, skin.key, skin.paint);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of parts) {
    x0 = Math.min(x0, p.pos[0] - p.size[0] / 2); x1 = Math.max(x1, p.pos[0] + p.size[0] / 2);
    y0 = Math.min(y0, p.pos[1] - p.size[1] / 2); y1 = Math.max(y1, p.pos[1] + p.size[1] / 2);
  }
  c = document.createElement('canvas');
  c.width = Math.round((x1 - x0) * 16);
  c.height = Math.round((y1 - y0) * 16);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const order = parts.map((_, i) => i).sort((a, b) =>
    (parts[a].pos[2] + parts[a].size[2] / 2) - (parts[b].pos[2] + parts[b].size[2] / 2));
  for (const i of order) {
    const p = parts[i], q = rects[i].front;
    ctx.drawImage(canvas, q.x, q.y, q.w, q.h,
      Math.round((p.pos[0] - p.size[0] / 2 - x0) * 16), Math.round((y1 - p.pos[1] - p.size[1] / 2) * 16), q.w, q.h);
  }
  portraits.set(skin.id, c);
  return c;
}
