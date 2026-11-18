// Skin painters: one function per mob type that details the base-coated skin
// sheet MobModels lays out (see buildSkin there). A painter gets `p`:
//
//   p.face(id, side)   one face of the part with that `id` (mobTypes.js);
//                      side = 'front' | 'back' | 'left' | 'right' | 'top' |
//                      'bottom', from the mob's own point of view
//   p.sides(id, fn)    fn(face) on the part's two flanks
//   p.around(id, fn)   fn(face) on its four upright faces
//   p.rng              seeded random, stable per mob type
//
// and each face offers px / rect / speckle / blotches / fromFront, with the
// origin at the face's top-left as seen from outside (x right, y down) and
// `w` × `h` in pixels (16 per block). Passing `true` as the last argument of
// px/rect makes those pixels glow in the dark — that is how eyes shine at
// night. Addressing a part the mob doesn't have is a harmless no-op.
//
// A type with no painter still gets the mottled base coat in its part colours.

const INK = '#141414';

// A pair of eyes on a face: row `y`, each `inset` pixels in from its side
// edge, `size` = [wide, tall]. `white` adds a pixel of white outboard of each.
export function eyes(f, y, inset, hex, { white = null, glow = false, size = [1, 1] } = {}) {
  const [wide, tall] = size;
  for (let j = 0; j < tall; j++) {
    for (let i = 0; i < wide; i++) {
      f.px(inset + i, y + j, hex, glow);
      f.px(f.w - 1 - inset - i, y + j, hex, glow);
    }
    if (white) {
      f.px(inset - 1, y + j, white);
      f.px(f.w - inset, y + j, white);
    }
  }
}

// A band `rows` tall around a limb, `up` pixels above its bottom edge:
// hooves, boots, cuffs, socks.
export const band = (p, id, up, rows, hex) => p.around(id, (f) => f.rect(0, f.h - up - rows, f.w, rows, hex));
// …or measured down from its top edge: sleeves, wool leggings.
export const cuff = (p, id, rows, hex) => p.around(id, (f) => f.rect(0, 0, f.w, rows, hex));

const LEGS4 = ['leg0', 'leg1', 'leg2', 'leg3'];
const ALL = ['front', 'back', 'left', 'right', 'top', 'bottom'];

// Rotting-flesh treatment shared by the zombie family: sunken sockets with a
// glowing pupil, a slack mouth, and blotchy skin.
function undeadFace(f, { eye = '#e8f07a', socket = '#1b2a1b', mouth = '#263a22', y = 2 } = {}) {
  const s = f.w >= 8 ? 2 : 1; // socket size scales with the head
  eyes(f, y, 1, socket, { size: [s, s] });
  eyes(f, y + s - 1, s, eye, { glow: true });
  f.rect(2, f.h - 2, f.w - 4, 1, mouth);
}

function catSkin(p, { eye, nose, stripe, socks }) {
  const head = p.face('head', 'front');
  eyes(head, 1, 1, eye, { glow: true });
  p.face('muzzle', 'front').px(1, 0, nose);
  p.face('earL', 'front').px(0, 1, nose);
  p.face('earR', 'front').px(0, 1, nose);
  if (stripe) {
    const top = p.face('body', 'top');
    for (let y = 1; y < top.h; y += 3) top.rect(0, y, top.w, 1, stripe);
    p.sides('body', (f) => { for (let x = 1; x < f.w; x += 3) f.rect(x, 0, 1, f.h - 1, stripe); });
    p.around('tail', (f) => { for (let x = 1; x < f.w; x += 3) f.rect(x, 0, 1, f.h, stripe); });
    p.face('head', 'top').rect(1, 1, 1, 2, stripe).rect(3, 1, 1, 2, stripe);
  }
  if (socks) for (const id of LEGS4) band(p, id, 0, 1, socks);
}

export const SKINS = {
  pig(p) {
    eyes(p.face('head', 'front'), 2, 1, INK, { white: '#ffffff' });
    p.face('snout', 'front').px(0, 1, '#9a5555').px(3, 1, '#9a5555');
    p.sides('body', (f) => f.rect(0, f.h - 2, f.w, 2, '#f2bcbc')); // pale belly
    p.face('body', 'top').blotches(2, 2, '#e09292');
    for (const id of LEGS4) band(p, id, 0, 2, '#8a6464'); // trotters
  },

  cow(p) {
    const WHITE = '#efe9df';
    p.face('body', 'top').blotches(3, 3.5, WHITE);
    p.sides('body', (f) => f.blotches(2, 3.5, WHITE));
    p.face('body', 'back').blotches(1, 2.5, WHITE);
    const face = p.face('head', 'front');
    face.rect(3, 0, 2, 5, WHITE); // blaze
    eyes(face, 2, 1, INK, { white: '#ffffff' });
    p.face('head', 'top').rect(3, 2, 2, 5, WHITE);
    p.face('muzzle', 'front').px(1, 1, '#8a6a66').px(4, 1, '#8a6a66').rect(1, 3, 4, 1, '#b99b92');
    for (const id of LEGS4) band(p, id, 0, 2, '#2a2018'); // hooves
    band(p, 'leg1', 2, 3, WHITE); // one white sock
    band(p, 'tail', 0, 2, '#1f150d'); // tuft
  },

  sheep(p) {
    // Fleece: curls of shadow and highlight on every woolly face.
    const fleece = (id) => {
      for (const s of ALL) {
        const f = p.face(id, s);
        f.speckle((f.w * f.h) / 5, '#d6d1c7').speckle((f.w * f.h) / 7, '#ffffff');
      }
    };
    fleece('body');
    fleece('cap');
    const face = p.face('head', 'front');
    eyes(face, 3, 1, INK, { white: '#ffffff' });
    face.px(3, 5, '#d89a9a'); // nose
    for (const id of LEGS4) {
      band(p, id, 0, 3, '#cbb89f'); // bare shank under the wool
      band(p, id, 0, 1, '#5a4a3a'); // hoof
    }
  },

  chicken(p) {
    p.sides('head', (f) => f.px(f.fromFront(1), 1, INK));
    p.sides('body', (f) => f.speckle(6, '#dedad2'));
    for (const [id, side] of [['wingL', 'left'], ['wingR', 'right']]) {
      const f = p.face(id, side);
      f.rect(0, 1, f.w, 1, '#d3cec4').rect(0, 3, f.w, 1, '#d3cec4'); // feather rows
    }
    const fan = p.face('tailfan', 'back');
    for (let x = 0; x < fan.w; x += 2) fan.rect(x, 0, 1, fan.h, '#d6d2c9');
  },

  wolf(p) {
    const face = p.face('head', 'front');
    face.rect(0, 1, face.w, 1, '#aaa69e'); // brow
    eyes(face, 2, 1, '#e0a83a');
    const snout = p.face('snout', 'front');
    snout.px(1, 0, INK).rect(0, 2, 3, 1, '#8a8680');
    const bridge = p.face('snout', 'top');
    bridge.px(1, bridge.h - 1, INK);
    p.face('earL', 'front').px(1, 1, '#c09a92');
    p.face('earR', 'front').px(0, 1, '#c09a92');
    const back = p.face('body', 'top');
    back.rect(1, 0, back.w - 2, back.h, '#96928a'); // dark saddle
    p.face('mane', 'front').rect(1, 3, 7, 5, '#e6e2da'); // pale chest
    for (const id of LEGS4) band(p, id, 0, 1, '#d4d0c8'); // paws
    p.face('tail', 'back').rect(0, 0, 2, 2, '#e6e2da'); // tail tip
  },

  cat(p) { catSkin(p, { eye: '#8fd24a', nose: '#d98a8a', stripe: '#b0702c', socks: '#f0e0d0' }); },
  black_cat(p) { catSkin(p, { eye: '#d8e63a', nose: '#55525c', stripe: null, socks: null }); },

  villager(p) {
    const face = p.face('head', 'front');
    eyes(face, 4, 2, '#2f7a3a', { white: '#ffffff' });
    face.rect(3, 7, 2, 1, '#8a5f45'); // mouth
    const robe = p.face('robe', 'front');
    robe.rect(4, 0, 1, robe.h, '#73593b'); // front seam
    p.around('robe', (f) => f.rect(0, f.h - 2, f.w, 2, '#6d5639').rect(0, 0, f.w, 1, '#a5855c'));
    const arms = p.face('arms', 'front');
    arms.rect(0, arms.h - 1, arms.w, 1, '#5f4930');
    for (const id of ['leg0', 'leg1']) band(p, id, 0, 2, '#2e2318'); // shoes
  },

  iron_golem(p) {
    const face = p.face('head', 'front');
    face.rect(0, 1, face.w, 1, '#9a958c'); // heavy brow
    eyes(face, 2, 1, '#d8483a', { glow: true });
    const chest = p.face('torso', 'front');
    chest.rect(0, 5, chest.w, 1, '#a39e95').rect(7, 0, 1, 5, '#a39e95'); // plate seams
    // A vine creeping up the chest and one leg.
    for (let y = 2; y < chest.h; y++) chest.px(3 + ((y * 5) % 3), y, y % 3 ? '#4f8a3a' : '#6aa84a');
    const shin = p.face('leg0', 'front');
    for (let y = 3; y < shin.h; y += 1) shin.px(1 + (y % 2), y, '#4f8a3a');
    for (const id of ['torso', 'armL', 'armR', 'leg0', 'leg1']) {
      p.around(id, (f) => f.speckle((f.w * f.h) / 14, '#8f8a80')); // pitting
    }
  },

  zombie(p) {
    const SKIN = '#4f8f45', SHIRT = '#3f8f8a';
    undeadFace(p.face('head', 'front'));
    p.face('head', 'front').rect(3, 4, 2, 1, '#3f7a38'); // nose
    p.face('head', 'top').blotches(2, 2, '#3a7033');
    p.around('torso', (f) => {
      for (let x = 0; x < f.w; x++) if (p.rng() < 0.4) f.px(x, f.h - 1, SKIN); // torn hem
      f.blotches(1, 1.5, '#357a75');
    });
    p.face('torso', 'front').px(3, 0, SKIN).px(4, 0, SKIN); // open collar
    for (const id of ['armL', 'armR']) cuff(p, id, 5, SHIRT);   // sleeves
    for (const id of ['leg0', 'leg1']) band(p, id, 0, 2, '#2a2a30'); // shoes
  },

  skeleton(p) {
    const GAP = '#1c1c1c', SHADE = '#a8a49a';
    const face = p.face('head', 'front');
    eyes(face, 2, 1, GAP, { size: [2, 2] });
    face.px(3, 4, '#2a2a2a'); // nose hole
    for (let x = 1; x < face.w - 1; x++) face.px(x, 5, x % 2 ? '#f6f2ea' : '#8a8680'); // teeth
    for (const side of ['front', 'back']) {
      const f = p.face('torso', side);
      for (let y = 1; y < 8; y += 2) f.rect(0, y, 2, 1, GAP).rect(f.w - 2, y, 2, 1, GAP); // rib gaps
      f.rect(0, 9, f.w, 1, GAP); // waist
    }
    for (const id of ['armL', 'armR', 'leg0', 'leg1']) {
      p.around(id, (f) => f.rect(0, f.h >> 1, f.w, 1, SHADE)); // joints
    }
  },

  creeper(p) {
    // Leafy camouflage: two-by-two patches of light and dark over everything.
    for (const id of ['body', 'head', ...LEGS4]) {
      for (const s of ALL) {
        const f = p.face(id, s);
        for (let i = 0; i < (f.w * f.h) / 9; i++) {
          f.rect(p.rng() * (f.w - 1), p.rng() * (f.h - 1), 2, 2, p.rng() < 0.5 ? '#6cc45e' : '#2f7d2c');
        }
      }
    }
    // The face.
    const f = p.face('head', 'front');
    f.rect(1, 2, 2, 2, '#101010').rect(5, 2, 2, 2, '#101010');
    f.rect(3, 4, 2, 1, '#101010').rect(2, 5, 4, 2, '#101010');
    f.px(2, 7, '#101010').px(5, 7, '#101010');
    for (const id of LEGS4) band(p, id, 0, 1, '#1f1f1f'); // feet
  },

  spider(p) {
    const RED = '#e02a22';
    const f = p.face('head', 'front');
    f.rect(1, 2, 2, 2, RED, true).rect(5, 2, 2, 2, RED, true);          // main eyes
    f.px(3, 1, RED, true).px(4, 1, RED, true).px(0, 4, RED, true).px(7, 4, RED, true); // the rest
    f.px(2, 6, '#e8e0d0').px(5, 6, '#e8e0d0'); // fangs
    const back = p.face('abdomen', 'top');
    for (let y = 3; y < back.h - 2; y += 3) back.rect((back.w >> 1) - 2, y, 4, 1, '#6a2a22'); // chevrons
    for (const s of ALL) { const a = p.face('abdomen', s); a.speckle((a.w * a.h) / 8, '#463e36'); }
  },

  sprinter(p) {
    const f = p.face('head', 'front');
    eyes(f, 2, 1, '#ff3a2a', { glow: true });
    f.rect(1, 1, 1, 1, '#4a4a3a').rect(4, 1, 1, 1, '#4a4a3a'); // sunken brow
    f.rect(1, 4, 4, 1, '#2a1f1a'); // gaping mouth
    const chest = p.face('torso', 'front');
    for (let y = 2; y < 8; y += 2) chest.rect(1, y, chest.w - 2, 1, '#6f7f5a'); // ribs
    for (const id of ['leg0', 'leg1']) band(p, id, 0, 2, '#22222a');
  },

  brute(p) {
    const f = p.face('head', 'front');
    f.rect(1, 2, 6, 1, '#1f1f1a'); // brow slit…
    eyes(f, 2, 2, '#f0d040', { glow: true }); // …with eyes burning inside it
    f.rect(2, 5, 4, 1, '#3a3a2a');
    const chest = p.face('torso', 'front');
    chest.blotches(3, 3, '#5a6a3c');
    for (let y = 3; y < 12; y += 2) chest.px(9, y, '#2a2a22'); // stitched scar
    for (const id of ['armL', 'armR']) band(p, id, 0, 3, '#4a5832'); // bruised fists
  },

  spitter(p) {
    const ACID = '#d4f65a';
    eyes(p.face('head', 'front'), 1, 1, ACID, { glow: true });
    for (const s of ALL) { const m = p.face('maw', s); m.rect(0, 0, m.w, m.h, ACID, true); }
    // Veins of acid glowing through the stretched belly.
    const belly = p.face('belly', 'front');
    for (let x = 1; x < belly.w - 1; x++) belly.px(x, 3 + ((x * 3) % 4), ACID, true);
    for (let y = 2; y < belly.h - 1; y++) belly.px(5 + (y % 2), y, ACID, true);
    p.sides('belly', (f) => f.blotches(2, 2, '#9ad048'));
  },

  screamer(p) {
    const VOID = '#0d0d0d';
    const f = p.face('head', 'front');
    eyes(f, 2, 1, VOID, { size: [2, 2] });
    f.rect(2, 5, 3, 3, VOID); // the mouth
    const chest = p.face('torso', 'front');
    for (let y = 2; y < 8; y += 2) chest.rect(1, y, chest.w - 2, 1, '#aaa39a');
  },

  charger(p) {
    const f = p.face('head', 'front');
    f.px(1, 1, '#f0d040', true).px(2, 1, '#f0d040', true); // one good eye
    f.rect(3, 1, 1, 2, '#5a3f36'); // a scar where the other was
    f.rect(1, 3, 3, 1, '#3a2a24');
    p.around('club', (c) => c.rect(0, c.h - 5, c.w, 5, '#6a4f44').speckle(8, '#b08a7a')); // calloused fist
    p.face('torso', 'front').blotches(2, 2.5, '#84675a');
  },

  tank(p) {
    const f = p.face('head', 'front');
    f.rect(1, 2, 5, 1, '#1f1f1c');
    eyes(f, 2, 2, '#ff4030', { glow: true });
    const chest = p.face('torso', 'front');
    chest.blotches(4, 3.5, '#75756c');
    for (let x = 4; x < 18; x += 2) chest.px(x, 6 + ((x >> 1) % 2), '#3a3a34'); // old wound
    p.around('shoulders', (s) => s.speckle((s.w * s.h) / 10, '#6f6f66'));
    for (const id of ['armL', 'armR']) band(p, id, 0, 5, '#63635b');
  },

  bat(p) {
    const f = p.face('body', 'front');
    f.px(0, 1, '#ffd84a', true).px(3, 1, '#ffd84a', true);
    f.px(1, 3, '#e8e0d0').px(2, 3, '#e8e0d0'); // fangs
  },
};
