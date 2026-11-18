// Mob definitions: stats, loot, collision box (hw = half-width, h = height in
// blocks), and a list of box parts for the model. Part pos is the box centre
// relative to the mob's feet; mobs face +z. Sizes are kept on a 1/16-block
// grid where it matters, because the skin (see mobSkins.js) is painted at 16
// pixels per block.
//
// Part flags (all read by MobModels):
//   id           name the skin painter uses to find the part
//   head: true   rides the head, which turns to look around (pivot = the
//                first head part's centre)
//   leg: true    swings while walking (hinged at its top)
//   arm: true    shoulder-hinged, posed by the mob's `gait`
//                ('shamble' | 'run' | 'heavy' | 'raised' — see animateMob)
//   tail         'back' (sticks out behind, wags) or 'hang' (hangs, swings)
//   wing: true   flaps in the air, flutters on the run (hinged at its top)
//   pivot / rest / axis / phase / amp   override the hinge point, resting
//                rotation [x, y, z], swing axis, and swing phase / strength

const leg = (x, z, w, h, d, color, extra) => ({ size: [w, h, d], pos: [x, h / 2, z], color, leg: true, ...extra });

// Four legs at (±x, ±z), ids leg0..leg3 (front pair first).
const legs4 = (x, zf, zb, w, h, d, color) => [
  leg(-x, zf, w, h, d, color, { id: 'leg0' }), leg(x, zf, w, h, d, color, { id: 'leg1' }),
  leg(-x, zb, w, h, d, color, { id: 'leg2' }), leg(x, zb, w, h, d, color, { id: 'leg3' }),
];

// Eight spider legs: hinged at the body, splayed out and down, sweeping
// around the vertical axis. Same phase on both sides makes a pair move in
// opposite directions (the hinges mirror), and alternate pairs are half a
// cycle apart — the classic scuttle.
const spiderLegs = (color) => {
  const out = [];
  for (let k = 0; k < 4; k++) {
    const z = 0.36 - k * 0.16;
    for (const side of [1, -1]) {
      out.push({
        id: `leg${out.length}`, size: [0.8125, 0.0625, 0.0625], color, leg: true,
        pos: [side * 0.62, 0.45, z], pivot: [side * 0.22, 0.45, z],
        axis: 'y', rest: [0, -side * (1.5 - k) * 0.3, -side * 0.55],
        phase: k % 2 ? Math.PI : 0, amp: 0.7,
      });
    }
  }
  return out;
};

const catParts = (fur, dark, muzzle) => [
  { id: 'body', size: [0.3125, 0.3125, 0.75], pos: [0, 0.4, -0.05], color: fur },
  { id: 'head', size: [0.3125, 0.25, 0.25], pos: [0, 0.5, 0.45], color: fur, head: true },
  { id: 'earL', size: [0.0625, 0.125, 0.0625], pos: [0.1, 0.68, 0.42], color: dark, head: true },
  { id: 'earR', size: [0.0625, 0.125, 0.0625], pos: [-0.1, 0.68, 0.42], color: dark, head: true },
  { id: 'muzzle', size: [0.1875, 0.125, 0.0625], pos: [0, 0.45, 0.6], color: muzzle, head: true },
  { id: 'tail', size: [0.0625, 0.0625, 0.5], pos: [0, 0.48, -0.66], color: dark, tail: 'back', rest: [0.55, 0, 0] },
  ...legs4(0.1, 0.22, -0.3, 0.09, 0.25, 0.09, dark),
];

export const MOBS = {
  // ---- Passive ----
  pig: {
    category: 'passive', health: 10, speed: 1.6, hw: 0.45, h: 0.9,
    drops: [{ item: 'raw_porkchop', count: [1, 3] }],
    parts: [
      { id: 'body', size: [0.875, 0.5625, 1.125], pos: [0, 0.6, 0], color: '#eaa3a3' },
      { id: 'head', size: [0.5, 0.5, 0.5], pos: [0, 0.68, 0.72], color: '#eda9a9', head: true },
      { id: 'snout', size: [0.25, 0.1875, 0.125], pos: [0, 0.59, 1.0], color: '#dc8b8b', head: true },
      { id: 'earL', size: [0.125, 0.125, 0.0625], pos: [0.2, 0.96, 0.62], color: '#d98a8a', head: true },
      { id: 'earR', size: [0.125, 0.125, 0.0625], pos: [-0.2, 0.96, 0.62], color: '#d98a8a', head: true },
      { id: 'tail', size: [0.0625, 0.0625, 0.125], pos: [0, 0.74, -0.62], color: '#dc8b8b', tail: 'back', rest: [0.5, 0, 0] },
      ...legs4(0.28, 0.38, -0.38, 0.25, 0.375, 0.25, '#e09898'),
    ],
  },
  cow: {
    category: 'passive', health: 10, speed: 1.3, hw: 0.45, h: 1.3,
    drops: [{ item: 'raw_beef', count: [1, 3] }, { item: 'leather', count: [0, 2] }],
    parts: [
      { id: 'body', size: [0.9375, 0.6875, 1.3125], pos: [0, 0.85, 0], color: '#5a3f2a' },
      { id: 'head', size: [0.5, 0.5, 0.4375], pos: [0, 1.02, 0.82], color: '#4f3824', head: true },
      { id: 'muzzle', size: [0.375, 0.25, 0.125], pos: [0, 0.9, 1.08], color: '#d9b9ae', head: true },
      { id: 'hornL', size: [0.0625, 0.1875, 0.0625], pos: [0.28, 1.3, 0.78], color: '#e9e2cc', head: true },
      { id: 'hornR', size: [0.0625, 0.1875, 0.0625], pos: [-0.28, 1.3, 0.78], color: '#e9e2cc', head: true },
      { id: 'udder', size: [0.3125, 0.125, 0.3125], pos: [0, 0.47, -0.3], color: '#e6a8a8' },
      { id: 'tail', size: [0.0625, 0.5, 0.0625], pos: [0, 0.83, -0.69], color: '#3f2c1c', tail: 'hang' },
      ...legs4(0.3, 0.45, -0.45, 0.25, 0.5625, 0.25, '#4a3524'),
    ],
  },
  sheep: {
    category: 'passive', health: 8, speed: 1.3, hw: 0.45, h: 1.1,
    drops: [{ item: 'wool', count: [1, 1] }, { item: 'raw_mutton', count: [1, 2] }],
    parts: [
      { id: 'body', size: [1.0, 0.75, 1.125], pos: [0, 0.75, 0], color: '#f0ede6' },
      { id: 'head', size: [0.4375, 0.4375, 0.5], pos: [0, 0.86, 0.72], color: '#d8c6ae', head: true },
      { id: 'cap', size: [0.5, 0.25, 0.4375], pos: [0, 1.04, 0.62], color: '#f0ede6', head: true },
      ...legs4(0.3, 0.36, -0.36, 0.25, 0.4375, 0.25, '#f0ede6'),
    ],
  },
  chicken: {
    category: 'passive', health: 4, speed: 1.2, hw: 0.25, h: 0.7,
    drops: [{ item: 'raw_chicken', count: [1, 1] }, { item: 'feather', count: [0, 2] }],
    parts: [
      { id: 'body', size: [0.375, 0.375, 0.5], pos: [0, 0.4, 0], color: '#f4f2ee' },
      { id: 'tailfan', size: [0.3125, 0.25, 0.0625], pos: [0, 0.56, -0.27], color: '#e8e5df' },
      { id: 'head', size: [0.25, 0.375, 0.1875], pos: [0, 0.7, 0.26], color: '#f4f2ee', head: true },
      { id: 'beak', size: [0.25, 0.125, 0.125], pos: [0, 0.69, 0.41], color: '#e8a63a', head: true },
      { id: 'wattle', size: [0.125, 0.125, 0.0625], pos: [0, 0.58, 0.38], color: '#d2372c', head: true },
      { id: 'comb', size: [0.0625, 0.125, 0.1875], pos: [0, 0.94, 0.26], color: '#d2372c', head: true },
      { id: 'wingL', size: [0.0625, 0.25, 0.375], pos: [0.22, 0.42, 0], color: '#e6e2da', wing: true },
      { id: 'wingR', size: [0.0625, 0.25, 0.375], pos: [-0.22, 0.42, 0], color: '#e6e2da', wing: true },
      leg(-0.1, 0.02, 0.0625, 0.21, 0.0625, '#e8a63a', { id: 'leg0' }),
      leg(0.1, 0.02, 0.0625, 0.21, 0.0625, '#e8a63a', { id: 'leg1' }),
    ],
  },

  // ---- Tamable ----
  // Wolves and cats spawn wild through the passive pool. Right-clicking one
  // while holding its `tameItem` rolls a tame chance; once owned they follow
  // their owner, can sit, and can be healed with `petFoods` (Game._petInteract
  // + Mob._petAI). Tamed individuals are exempt from despawn/caps in
  // MobManager, so `passive` here only governs the wild ones.
  wolf: {
    category: 'passive', health: 20, speed: 1.9, attack: 4, hw: 0.4, h: 0.85,
    tamable: true, tameItem: 'bone',
    petFoods: ['raw_porkchop', 'cooked_porkchop', 'raw_beef', 'cooked_beef',
      'raw_mutton', 'cooked_mutton', 'raw_chicken', 'cooked_chicken', 'rotten_flesh'],
    drops: [],
    parts: [
      { id: 'body', size: [0.5, 0.5, 0.875], pos: [0, 0.56, -0.12], color: '#b4b0a8' },
      { id: 'mane', size: [0.5625, 0.5625, 0.375], pos: [0, 0.59, 0.32], color: '#c8c4bc' },
      { id: 'head', size: [0.4375, 0.375, 0.375], pos: [0, 0.76, 0.66], color: '#c4c0b8', head: true },
      { id: 'snout', size: [0.1875, 0.1875, 0.25], pos: [0, 0.68, 0.95], color: '#dad6ce', head: true },
      { id: 'earL', size: [0.125, 0.125, 0.0625], pos: [0.14, 1.0, 0.6], color: '#a4a098', head: true },
      { id: 'earR', size: [0.125, 0.125, 0.0625], pos: [-0.14, 1.0, 0.6], color: '#a4a098', head: true },
      { id: 'tail', size: [0.125, 0.125, 0.4375], pos: [0, 0.68, -0.76], color: '#b4b0a8', tail: 'back', rest: [-0.3, 0, 0] },
      ...legs4(0.16, 0.28, -0.34, 0.125, 0.4375, 0.125, '#a4a098'),
    ],
  },
  cat: {
    category: 'passive', health: 12, speed: 2.2, hw: 0.3, h: 0.6,
    tamable: true, tameItem: 'raw_fish', petFoods: ['raw_fish', 'raw_chicken'],
    scaresCreepers: true,
    drops: [],
    parts: catParts('#d9964e', '#c9853d', '#f0e0d0'), // ginger tabby
  },
  black_cat: {
    category: 'passive', health: 12, speed: 2.2, hw: 0.3, h: 0.6,
    tamable: true, tameItem: 'raw_fish', petFoods: ['raw_fish', 'raw_chicken'],
    scaresCreepers: true,
    drops: [],
    parts: catParts('#26252b', '#1a191f', '#3d3b44'),
  },

  villager: {
    // Own category: not in the random passive spawn pool — villagers spawn at
    // their village (MobManager) and stay leashed to it.
    category: 'villager', health: 20, speed: 1.0, hw: 0.35, h: 1.85,
    drops: [],
    parts: [
      leg(-0.11, 0, 0.1875, 0.4, 0.1875, '#4a3826', { id: 'leg0' }),
      leg(0.11, 0, 0.1875, 0.4, 0.1875, '#4a3826', { id: 'leg1' }),
      { id: 'robe', size: [0.5625, 0.875, 0.375], pos: [0, 0.84, 0], color: '#8a6d4a' },
      { id: 'arms', size: [0.625, 0.1875, 0.4375], pos: [0, 1.16, 0.06], color: '#73593b' },     // crossed arms
      { id: 'head', size: [0.5, 0.5625, 0.5], pos: [0, 1.58, 0], color: '#c8a17a', head: true },   // big head
      { id: 'nose', size: [0.125, 0.25, 0.125], pos: [0, 1.48, 0.3], color: '#b58e67', head: true },
      { id: 'brow', size: [0.5, 0.0625, 0.0625], pos: [0, 1.72, 0.26], color: '#5d4930', head: true }, // unibrow
    ],
  },

  // Village defender: ignores players, hunts hostiles, hits like a truck.
  iron_golem: {
    category: 'golem', health: 60, speed: 1.1, attack: 8, detect: 16, hw: 0.55, h: 2.4,
    drops: [{ item: 'iron_ingot', count: [1, 2] }],
    parts: [
      leg(-0.2, 0, 0.3125, 0.85, 0.3125, '#9a958c', { id: 'leg0' }),
      leg(0.2, 0, 0.3125, 0.85, 0.3125, '#9a958c', { id: 'leg1' }),
      { id: 'torso', size: [0.9375, 0.875, 0.5], pos: [0, 1.3, 0], color: '#c2bdb4' },               // broad torso
      { id: 'armL', size: [0.25, 1.0, 0.25], pos: [0.62, 1.25, 0], color: '#aaa49a' },              // long arms
      { id: 'armR', size: [0.25, 1.0, 0.25], pos: [-0.62, 1.25, 0], color: '#aaa49a' },
      { id: 'head', size: [0.4375, 0.4375, 0.4375], pos: [0, 1.98, 0], color: '#c2bdb4', head: true },
      { id: 'nose', size: [0.125, 0.25, 0.125], pos: [0, 1.9, 0.26], color: '#8a857c', head: true },
    ],
  },

  // ---- Hostile ----
  zombie: {
    category: 'hostile', health: 20, speed: 1.5, attack: 3, detect: 18, burns: true, huntsVillagers: true, gait: 'shamble', hw: 0.4, h: 1.8,
    drops: [{ item: 'rotten_flesh', count: [0, 2] }],
    parts: [
      leg(-0.13, 0, 0.25, 0.75, 0.25, '#2f3f73', { id: 'leg0' }),
      leg(0.13, 0, 0.25, 0.75, 0.25, '#2f3f73', { id: 'leg1' }),
      { id: 'torso', size: [0.5, 0.75, 0.25], pos: [0, 1.125, 0], color: '#3f8f8a' },
      { id: 'armR', size: [0.25, 0.75, 0.25], pos: [-0.375, 1.125, 0], color: '#4f8f45', arm: true },
      { id: 'armL', size: [0.25, 0.75, 0.25], pos: [0.375, 1.125, 0], color: '#4f8f45', arm: true },
      { id: 'head', size: [0.5, 0.5, 0.5], pos: [0, 1.75, 0], color: '#4f8f45', head: true },
    ],
  },
  skeleton: {
    category: 'hostile', health: 20, speed: 1.4, attack: 3, detect: 20, burns: true, ranged: true, hw: 0.4, h: 1.8,
    drops: [{ item: 'bone', count: [0, 2] }, { item: 'arrow', count: [1, 3] }],
    parts: [
      leg(-0.12, 0, 0.125, 0.75, 0.125, '#d8d4ca', { id: 'leg0' }),
      leg(0.12, 0, 0.125, 0.75, 0.125, '#d8d4ca', { id: 'leg1' }),
      { id: 'torso', size: [0.375, 0.75, 0.1875], pos: [0, 1.125, 0], color: '#d4d0c6' },
      // Arms held out ahead, as if drawing a bow. No gait, so they keep the pose.
      { id: 'armR', size: [0.125, 0.75, 0.125], pos: [-0.3, 1.125, 0], color: '#d8d4ca', arm: true, rest: [-1.35, 0, 0] },
      { id: 'armL', size: [0.125, 0.75, 0.125], pos: [0.3, 1.125, 0], color: '#d8d4ca', arm: true, rest: [-1.35, 0, 0] },
      { id: 'head', size: [0.4375, 0.4375, 0.4375], pos: [0, 1.72, 0], color: '#e2ded4', head: true },
    ],
  },
  creeper: {
    // Doesn't melee: closes in, hisses, swells, and detonates (see Mob.update).
    category: 'hostile', health: 20, speed: 1.6, attack: 0, detect: 16, burns: false, exploder: true, hw: 0.35, h: 1.6,
    drops: [{ item: 'gunpowder', count: [1, 2] }],
    parts: [
      ...legs4(0.14, 0.2, -0.2, 0.25, 0.375, 0.25, '#3f8f38'),
      { id: 'body', size: [0.5, 0.8125, 0.3125], pos: [0, 0.78, 0], color: '#4aa83f' },   // tall body
      { id: 'head', size: [0.5, 0.5, 0.5], pos: [0, 1.43, 0], color: '#4aa83f', head: true },
    ],
  },
  spider: {
    category: 'hostile', health: 16, speed: 2.0, attack: 2, detect: 16, burns: false, climbs: true, hw: 0.7, h: 0.7,
    drops: [{ item: 'string', count: [0, 2] }],
    parts: [
      { id: 'abdomen', size: [0.875, 0.5625, 0.9375], pos: [0, 0.5, -0.42], color: '#2a2622' },
      { id: 'thorax', size: [0.5, 0.375, 0.375], pos: [0, 0.45, 0.2], color: '#322d28' },
      { id: 'head', size: [0.5, 0.4375, 0.4375], pos: [0, 0.45, 0.6], color: '#3a3430', head: true },
      ...spiderLegs('#1f1c19'),
    ],
  },

  // ---- Zombies arena specials ----
  // `arenaOnly: true` keeps these out of the survival HOSTILE spawn pool —
  // the Zombies wave director spawns them by name. Category stays 'hostile'
  // so the hunt-the-player AI applies.
  sprinter: {
    category: 'hostile', arenaOnly: true, health: 12, speed: 3.2, attack: 2, detect: 20, burns: false, gait: 'run', hw: 0.35, h: 1.7,
    drops: [{ item: 'rotten_flesh', count: [0, 1] }],
    parts: [ // gaunt runner: thin legs, hunched pale torso, red eyes
      leg(-0.11, 0, 0.1875, 0.85, 0.1875, '#3a3a44', { id: 'leg0' }),
      leg(0.11, 0, 0.1875, 0.85, 0.1875, '#3a3a44', { id: 'leg1' }),
      { id: 'torso', size: [0.4375, 0.625, 0.25], pos: [0, 1.15, 0.06], color: '#8a9a72' },
      { id: 'armR', size: [0.1875, 0.625, 0.1875], pos: [-0.3, 1.1, 0.1], color: '#7d8d66', arm: true },
      { id: 'armL', size: [0.1875, 0.625, 0.1875], pos: [0.3, 1.1, 0.1], color: '#7d8d66', arm: true },
      { id: 'head', size: [0.375, 0.375, 0.375], pos: [0, 1.55, 0.12], color: '#93a37b', head: true },
    ],
  },
  brute: {
    category: 'hostile', arenaOnly: true, health: 80, speed: 1.0, attack: 8, detect: 20, burns: false, breaksBlocks: true, gait: 'heavy', hw: 0.6, h: 2.6,
    drops: [{ item: 'rotten_flesh', count: [1, 3] }],
    parts: [ // hulking mini-boss: slab torso, gorilla arms, sunken head
      leg(-0.24, 0, 0.375, 0.9, 0.375, '#4a4438', { id: 'leg0' }),
      leg(0.24, 0, 0.375, 0.9, 0.375, '#4a4438', { id: 'leg1' }),
      { id: 'torso', size: [1.125, 1.0, 0.625], pos: [0, 1.45, 0], color: '#6b7a4a' },
      { id: 'armR', size: [0.3125, 1.125, 0.3125], pos: [-0.78, 1.35, 0], color: '#5d6c40', arm: true },
      { id: 'armL', size: [0.3125, 1.125, 0.3125], pos: [0.78, 1.35, 0], color: '#5d6c40', arm: true },
      { id: 'head', size: [0.5, 0.4375, 0.5], pos: [0, 2.2, 0.08], color: '#77865a', head: true },
    ],
  },
  spitter: {
    category: 'hostile', arenaOnly: true, health: 18, speed: 1.3, attack: 4, detect: 24, burns: false, ranged: true, projectile: 'acid', gait: 'shamble', hw: 0.45, h: 1.6,
    drops: [{ item: 'rotten_flesh', count: [0, 2] }],
    parts: [ // bloated acid belly, hunched, glowing maw
      leg(-0.14, 0, 0.1875, 0.55, 0.1875, '#4c5a30', { id: 'leg0' }),
      leg(0.14, 0, 0.1875, 0.55, 0.1875, '#4c5a30', { id: 'leg1' }),
      { id: 'belly', size: [0.6875, 0.625, 0.5625], pos: [0, 0.9, 0], color: '#7fb43a' },
      { id: 'head', size: [0.375, 0.375, 0.375], pos: [0, 1.4, 0.2], color: '#5f8a2a', head: true },
      { id: 'maw', size: [0.1875, 0.1875, 0.125], pos: [0, 1.28, 0.44], color: '#b8e04a', head: true },
    ],
  },
  screamer: {
    category: 'hostile', arenaOnly: true, health: 25, speed: 1.2, attack: 1, detect: 24, burns: false, keepsDistance: true, gait: 'raised', hw: 0.4, h: 1.9,
    drops: [],
    parts: [ // tall bone-pale banshee, arms raised, huge black mouth
      leg(-0.12, 0, 0.1875, 0.8, 0.1875, '#8a8378', { id: 'leg0' }),
      leg(0.12, 0, 0.1875, 0.8, 0.1875, '#8a8378', { id: 'leg1' }),
      { id: 'torso', size: [0.4375, 0.75, 0.25], pos: [0, 1.18, 0], color: '#c9c2b8' },
      { id: 'armR', size: [0.1875, 0.6875, 0.1875], pos: [-0.34, 1.25, 0], color: '#b5aea2', arm: true },
      { id: 'armL', size: [0.1875, 0.6875, 0.1875], pos: [0.34, 1.25, 0], color: '#b5aea2', arm: true },
      { id: 'head', size: [0.4375, 0.5, 0.4375], pos: [0, 1.82, 0], color: '#d8d1c6', head: true },
    ],
  },
  charger: {
    // Winds up, then rockets in a locked straight line (sidestep to dodge!).
    // A clean hit is full damage plus a huge shove; a wall stops it cold.
    category: 'hostile', arenaOnly: true, health: 45, speed: 1.4, attack: 6, detect: 24, burns: false, charges: true, gait: 'heavy', hw: 0.5, h: 2.0,
    drops: [{ item: 'rotten_flesh', count: [0, 2] }],
    parts: [ // lopsided bruiser: one massive club arm, one withered stub
      leg(-0.18, 0, 0.25, 0.7, 0.25, '#6a5a50', { id: 'leg0' }),
      leg(0.18, 0, 0.25, 0.7, 0.25, '#6a5a50', { id: 'leg1' }),
      { id: 'torso', size: [0.8125, 0.75, 0.5], pos: [0, 1.15, 0], color: '#9a7a6a' },
      { id: 'stub', size: [0.125, 0.5, 0.125], pos: [-0.5, 1.25, 0], color: '#7a5f52', arm: true },
      { id: 'club', size: [0.4375, 1.125, 0.4375], pos: [0.62, 1.05, 0], color: '#8a6a5a', arm: true },
      { id: 'head', size: [0.3125, 0.3125, 0.3125], pos: [-0.14, 1.72, 0.08], color: '#9a7a6a', head: true },
    ],
  },
  tank: {
    // Every-10th-wave boss: a wall of meat that smashes fortifications and
    // hurls rocks at anyone out of punching range.
    category: 'hostile', arenaOnly: true, health: 250, speed: 1.9, attack: 10, detect: 28, burns: false, breaksBlocks: true, throwsRocks: true, gait: 'heavy', hw: 0.7, h: 2.8,
    drops: [{ item: 'rotten_flesh', count: [2, 5] }],
    parts: [ // top-heavy colossus: shoulder slab, ape arms, sunken little head
      leg(-0.3, 0, 0.4375, 0.85, 0.4375, '#5a5a56', { id: 'leg0' }),
      leg(0.3, 0, 0.4375, 0.85, 0.4375, '#5a5a56', { id: 'leg1' }),
      { id: 'torso', size: [1.375, 1.125, 0.75], pos: [0, 1.45, 0], color: '#8a8a80' },
      { id: 'shoulders', size: [1.625, 0.375, 0.8125], pos: [0, 2.1, 0], color: '#94948a' },
      { id: 'armR', size: [0.5, 1.375, 0.5], pos: [-1.0, 1.35, 0], color: '#7d7d74', arm: true },
      { id: 'armL', size: [0.5, 1.375, 0.5], pos: [1.0, 1.35, 0], color: '#7d7d74', arm: true },
      { id: 'head', size: [0.4375, 0.375, 0.375], pos: [0, 2.5, 0.16], color: '#8a8a80', head: true },
    ],
  },

  // ---- Cave ambient ----
  // Bats are harmless ambient creatures that flutter through dark underground
  // pockets. `category: 'ambient'` keeps them out of the surface passive
  // spawner (they spawn via the cave pass in MobManager), and `flies` swaps
  // gravity for a flapping bob in Mob physics.
  bat: {
    category: 'ambient', health: 6, speed: 3.5, hw: 0.25, h: 0.5, flies: true,
    drops: [],
    parts: [
      { id: 'body', size: [0.25, 0.25, 0.1875], pos: [0, 0.22, 0], color: '#2a2630' },
      { id: 'earL', size: [0.0625, 0.125, 0.0625], pos: [0.09, 0.4, 0], color: '#3a3040' },
      { id: 'earR', size: [0.0625, 0.125, 0.0625], pos: [-0.09, 0.4, 0], color: '#3a3040' },
      // Wings hinge at the shoulder and beat up from level.
      { id: 'wingL', size: [0.3125, 0.0625, 0.1875], pos: [0.28, 0.24, 0], pivot: [0.125, 0.24, 0], color: '#1c1a22', wing: true },
      { id: 'wingR', size: [0.3125, 0.0625, 0.1875], pos: [-0.28, 0.24, 0], pivot: [-0.125, 0.24, 0], color: '#1c1a22', wing: true },
    ],
  },
};

export const PASSIVE = Object.keys(MOBS).filter((k) => MOBS[k].category === 'passive');
// arenaOnly specials (Zombies mode) never enter the survival spawn pool.
export const HOSTILE = Object.keys(MOBS).filter((k) => MOBS[k].category === 'hostile' && !MOBS[k].arenaOnly);
// Cave-hostile pool: existing hostile types that work underground. Zombies and
// skeletons burn in daylight, but the burn check requires open sky, so a rock
// roof keeps them safe down here. Bats spawn through the same cave pass but as
// harmless ambience, outside this pool.
export const CAVE_HOSTILE = ['zombie', 'skeleton', 'creeper', 'spider'];
